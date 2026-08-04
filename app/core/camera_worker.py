"""CameraWorker — low-latency RTSP/HTTP/video capture, per-frame counter publish, thread-safe line reload."""
from __future__ import annotations
import json
import os
import threading
import time
from typing import Optional, List

import asyncio
import cv2
import numpy as np

try:
    import yt_dlp as _yt_dlp
    _YT_DLP_AVAILABLE = True
except ImportError:
    _YT_DLP_AVAILABLE = False

from app.config.logging import get_logger
from app.core.vision import (
    DetectorInterface, EntryExitCounter, MultiLineCounter, LineConfig, CrossingEvent
)
from app.core.frame_broker import FrameBroker
from app.core.events import EventBus, CounterUpdateEvent, CameraStatusEvent
from app.data.models import Camera, CameraStatus
from app.security import decrypt_credential

logger = get_logger(__name__)

_RECONNECT_DELAY_MIN = 2    # seconds
_RECONNECT_DELAY_MAX = 60
_RECONNECT_BACKOFF   = 1.5

# Supported source types: rtsp, rtmp, http (MJPEG/HLS), file path
# YouTube/social media URLs are NOT supported — use a real IP camera or RTSP stream.


def _draw_overlay(
    frame: np.ndarray,
    detections,
    lines: list,
    count_in: int,
    count_out: int,
    camera_name: str,
) -> np.ndarray:
    h, w = frame.shape[:2]

    for det in detections:
        x1, y1, x2, y2 = int(det.x1), int(det.y1), int(det.x2), int(det.y2)
        # Green bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        # Foot point marker for debugging line crossing
        fx, fy = int((x1 + x2) / 2), y2
        cv2.circle(frame, (fx, fy), 3, (0, 255, 255), -1)
        label = f"ID:{det.track_id} {det.confidence:.2f}"
        cv2.putText(frame, label, (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

    # Draw each virtual line in a distinct colour
    line_colours = [
        (0, 0, 255),    # red
        (255, 128, 0),  # orange
        (255, 0, 255),  # magenta
        (0, 255, 255),  # cyan
        (128, 0, 255),  # purple
    ]
    for idx, line in enumerate(lines or []):
        colour = line_colours[idx % len(line_colours)]
        pt1, pt2 = line.to_pixel(w, h)
        cv2.line(frame, pt1, pt2, colour, 2)
        label_text = getattr(line, 'label', None) or f"L{idx + 1}"
        cv2.putText(frame, label_text, (pt1[0] + 4, pt1[1] - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1)

    net = count_in - count_out
    # Semi-transparent HUD background
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (300, 66), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
    cv2.putText(frame, camera_name[:30], (6, 17),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(frame, f"IN:{count_in}  OUT:{count_out}  NET:{net}", (6, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    return frame


_YOUTUBE_DOMAINS = (
    "youtube.com/", "youtu.be/", "www.youtube.com/",
    "youtube.com/shorts/",
)

# Phrases in yt-dlp error messages that indicate auth/bot-detection failure.
# These are permanent errors — retrying without fixing cookies will never help.
_BOT_DETECTION_PHRASES = (
    "sign in to confirm",
    "bot detection",
    "--cookies-from-browser",
    "--cookies for the authentication",
)


class YouTubeBotDetectionError(RuntimeError):
    """Raised when YouTube blocks yt-dlp with a bot-detection / sign-in error.

    This is a permanent failure for the current session — the worker should
    stop retrying until the operator configures cookies and manually restarts
    the camera.
    """


def _resolve_yt_dlp(url: str) -> str:
    """
    Resolve a YouTube (or other yt-dlp-supported) URL to a direct stream URL.
    Picks the best format ≤1080p with both video and audio.
    Raises RuntimeError if yt-dlp is unavailable or extraction fails.

    Authentication (required to bypass YouTube bot-detection):
      - Set YT_DLP_COOKIES_FILE to a Netscape-format cookies.txt path, OR
      - Set YT_DLP_COOKIES_FROM_BROWSER to a browser name (chrome/firefox/edge/…)
    """
    if not _YT_DLP_AVAILABLE:
        raise RuntimeError("yt-dlp is not installed; cannot open YouTube URL.")

    from app.config.settings import get_settings
    settings = get_settings()

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
        "noplaylist": True,
    }

    cookies_file = (settings.yt_dlp_cookies_file or "").strip()
    cookies_browser = (settings.yt_dlp_cookies_from_browser or "").strip()

    if cookies_file:
        if not os.path.isfile(cookies_file):
            logger.warning("YT_DLP_COOKIES_FILE does not exist, ignoring",
                           path=cookies_file)
        else:
            ydl_opts["cookiefile"] = cookies_file
            logger.debug("yt-dlp using cookies file", path=cookies_file)
    elif cookies_browser:
        # yt-dlp accepts a tuple (browser, profile, keyring, container) or just a string
        ydl_opts["cookiesfrombrowser"] = (cookies_browser,)
        logger.debug("yt-dlp extracting cookies from browser", browser=cookies_browser)
    else:
        logger.warning(
            "No YouTube cookies configured — requests may be blocked by bot-detection. "
            "Set YT_DLP_COOKIES_FILE or YT_DLP_COOKIES_FROM_BROWSER in your .env."
        )

    try:
        with _yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            # For playlists/channels yt-dlp wraps entries; take first entry
            if "entries" in info:
                info = info["entries"][0]
            # Prefer a direct url field; fall back to requested_formats[0]
            direct_url = info.get("url")
            if not direct_url:
                fmts = info.get("requested_formats") or info.get("formats") or []
                if fmts:
                    direct_url = fmts[0].get("url")
            if not direct_url:
                raise RuntimeError(f"yt-dlp could not extract a stream URL for: {url}")
            return direct_url
    except YouTubeBotDetectionError:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if any(phrase in msg for phrase in _BOT_DETECTION_PHRASES):
            raise YouTubeBotDetectionError(
                f"YouTube bot-detection triggered for {url}. "
                "Configure YT_DLP_COOKIES_FILE or YT_DLP_COOKIES_FROM_BROWSER in your "
                ".env and restart the camera."
            ) from exc
        raise


def _is_yt_dlp_url(url: str) -> bool:
    lower = url.lower()
    return any(d in lower for d in _YOUTUBE_DOMAINS)


def _open_capture(url: str) -> cv2.VideoCapture:
    """
    Open a video capture with low-latency settings appropriate for the URL type.
    Supports: RTSP, RTMP, HTTP MJPEG/HLS, local file/device index, YouTube (via yt-dlp).
    """
    stream_url = url
    lower = url.lower()

    if _is_yt_dlp_url(url):
        # Resolve YouTube URL to a direct stream before handing to OpenCV
        stream_url = _resolve_yt_dlp(url)
        lower = stream_url.lower()

    cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)

    if lower.startswith("rtsp://") or lower.startswith("rtmp://"):
        # RTSP/RTMP: minimal buffer, TCP transport, fast open
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10_000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10_000)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*'H264'))
    elif lower.startswith("http://") or lower.startswith("https://"):
        # HTTP MJPEG / HLS / YouTube direct CDN: slightly larger buffer
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 15_000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 15_000)
    else:
        # Local file or device index
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    return cap


class CameraWorker:
    """
    Background thread: capture → detect → count → annotate → push.

    Supports RTSP, RTMP, HTTP MJPEG/HLS, local video files, and YouTube (via yt-dlp).

    Accuracy features:
    - YOLOv8s with ByteTrack (configured in YoloV8Detector)
    - Crossing guard in EntryExitCounter (3-frame confirmation)
    - Foot-point line crossing (more stable than centroid)
    - Minimum bounding box size filter

    YouTube note: yt-dlp resolves the URL to a direct CDN stream before OpenCV opens it.
    The resolved URL expires (typically ~6 hours); the worker's reconnect loop will
    re-resolve on the next reconnect automatically.
    """

    def __init__(
        self,
        camera: Camera,
        detector: DetectorInterface,
        frame_broker: FrameBroker,
        event_bus: EventBus,
        loop: asyncio.AbstractEventLoop,
        on_crossing,
        on_status,
    ):
        self._camera = camera
        self._detector = detector
        self._broker = frame_broker
        self._event_bus = event_bus
        self._loop = loop
        self._on_crossing = on_crossing
        self._on_status = on_status

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # RLock protects counter + line so reload is safe mid-frame
        self._counter_lock = threading.RLock()
        self._counter: Optional[MultiLineCounter] = None
        self._lines: List[LineConfig] = []
        self._reconnect_delay = _RECONNECT_DELAY_MIN

    # ------------------------------------------------------------------

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f"cam-{self._camera.id}",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=15)

    @property
    def camera_id(self) -> int:
        return self._camera.id

    # ------------------------------------------------------------------

    def _run(self) -> None:
        logger.info("CameraWorker starting", camera_id=self._camera.id)
        while not self._stop_event.is_set():
            cap: Optional[cv2.VideoCapture] = None
            try:
                url = decrypt_credential(self._camera.url_encrypted)
                logger.info("Opening stream", camera_id=self._camera.id,
                            url=url[:60] if url else "")

                cap = _open_capture(url)
                if not cap.isOpened():
                    raise RuntimeError(f"Cannot open stream: {url[:60]}")

                self._set_status(CameraStatus.active)
                self._reconnect_delay = _RECONNECT_DELAY_MIN  # reset on success

                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))  or 640
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480

                with self._counter_lock:
                    self._lines = self._parse_lines()
                    if self._lines:
                        self._counter = MultiLineCounter(
                            camera_id=self._camera.id,
                            lines=self._lines,
                            frame_w=w, frame_h=h,
                        )

                consecutive_failures = 0
                is_video_file = getattr(self._camera, 'source_type', '') == 'video'
                last_frame_pos = -1.0
                frame_count = 0
                # Process detection every N frames to maintain smooth stream FPS.
                # Crossing logic is unaffected — guards require multiple frames anyway.
                detect_every = 2  # run YOLO on every 2nd frame

                while not self._stop_event.is_set():
                    ok, frame = cap.read()
                    if not ok:
                        if is_video_file:
                            # EOF reached — loop video from beginning and reset
                            # tracker state so track IDs restart cleanly
                            logger.info("Video EOF — looping",
                                        camera_id=self._camera.id)
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            last_frame_pos = -1.0
                            with self._counter_lock:
                                if self._counter is not None:
                                    self._counter.reset_tracker_state()
                            self._detector.reset_tracker()
                            consecutive_failures = 0
                            continue
                        consecutive_failures += 1
                        if consecutive_failures >= 5:
                            logger.warning("Too many consecutive frame failures",
                                           camera_id=self._camera.id)
                            break
                        time.sleep(0.05)
                        continue

                    # Detect video seeking backwards (extra guard for looped files)
                    if is_video_file:
                        cur_pos = cap.get(cv2.CAP_PROP_POS_FRAMES)
                        if cur_pos < last_frame_pos:
                            with self._counter_lock:
                                if self._counter is not None:
                                    self._counter.reset_tracker_state()
                            self._detector.reset_tracker()
                        last_frame_pos = cur_pos

                    consecutive_failures = 0
                    frame_count += 1
                    should_detect = (frame_count % detect_every == 0)
                    detections = self._detector.detect(frame) if should_detect else []

                    # DEBUG: log detections every 30 frames
                    if not hasattr(self, '_dbg_frame_count'):
                        self._dbg_frame_count = 0
                    self._dbg_frame_count += 1
                    if self._dbg_frame_count % 30 == 0:
                        logger.info("DEBUG detections",
                                    camera_id=self._camera.id,
                                    num_detections=len(detections),
                                    has_counter=self._counter is not None,
                                    num_lines=len(self._lines))

                    with self._counter_lock:
                        crossing_events = []
                        if self._counter is not None:
                            crossing_events = self._counter.update(detections)

                        for ev in crossing_events:
                            logger.info("CROSSING EVENT",
                                        camera_id=self._camera.id,
                                        direction=ev.direction,
                                        track_id=ev.track_id)
                            self._on_crossing(ev.camera_id, ev.direction, ev.track_id)

                        count_in  = self._counter.count_in  if self._counter else 0
                        count_out = self._counter.count_out if self._counter else 0
                        lines_snap = self._lines

                    # Publish counter every frame so WS dashboard stays live
                    self._publish_counter(count_in, count_out)

                    annotated = _draw_overlay(
                        frame.copy(), detections, lines_snap,
                        count_in, count_out, self._camera.name,
                    )
                    self._broker.put_frame(self._camera.id, annotated)

            except YouTubeBotDetectionError as exc:
                # Permanent auth failure — stop retrying immediately.
                # The operator must configure cookies and manually restart.
                logger.error(
                    "YouTube bot-detection: stopping worker until cookies are "
                    "configured and camera is manually restarted",
                    camera_id=self._camera.id, error=str(exc),
                )
                self._set_status(CameraStatus.error)
                self._stop_event.set()

            except Exception as exc:
                logger.error("CameraWorker error",
                             camera_id=self._camera.id, error=str(exc))
                self._set_status(CameraStatus.error)

            finally:
                if cap is not None:
                    cap.release()
                if not self._stop_event.is_set():
                    logger.info("Reconnecting",
                                camera_id=self._camera.id,
                                delay=self._reconnect_delay)
                    time.sleep(self._reconnect_delay)
                    self._reconnect_delay = min(
                        self._reconnect_delay * _RECONNECT_BACKOFF,
                        _RECONNECT_DELAY_MAX,
                    )

        self._set_status(CameraStatus.inactive)
        logger.info("CameraWorker stopped", camera_id=self._camera.id)

    # ------------------------------------------------------------------

    def _parse_lines(self) -> List[LineConfig]:
        """Parse line_config JSON string into a list of LineConfig. Handles legacy single-object format."""
        return MultiLineCounter.parse_line_config(self._camera.line_config) or []

    def _set_status(self, status: CameraStatus) -> None:
        self._on_status(self._camera.id, status)
        asyncio.run_coroutine_threadsafe(
            self._event_bus.publish("camera_status", CameraStatusEvent(
                camera_id=self._camera.id, status=status.value
            )),
            self._loop,
        )

    def _publish_counter(self, count_in: int, count_out: int) -> None:
        asyncio.run_coroutine_threadsafe(
            self._event_bus.publish("counter_update", CounterUpdateEvent(
                camera_id=self._camera.id,
                camera_name=self._camera.name,
                count_in=count_in,
                count_out=count_out,
                net=count_in - count_out,
            )),
            self._loop,
        )

    def reload_line(self, line_config: str) -> None:
        """Hot-reload virtual lines without restarting the worker."""
        try:
            new_lines = MultiLineCounter.parse_line_config(line_config) or []
            with self._counter_lock:
                w = self._counter._frame_w if self._counter else 640
                h = self._counter._frame_h if self._counter else 480
                self._lines = new_lines
                if new_lines:
                    self._counter = MultiLineCounter(
                        camera_id=self._camera.id,
                        lines=new_lines, frame_w=w, frame_h=h,
                    )
                else:
                    self._counter = None
            logger.info("Line config reloaded", camera_id=self._camera.id,
                        num_lines=len(new_lines))
        except Exception as exc:
            logger.error("reload_line failed",
                         camera_id=self._camera.id, error=str(exc))
