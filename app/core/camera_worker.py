"""CameraWorker — low-latency RTSP/HTTP/YouTube/video, per-frame counter publish, thread-safe line reload."""
from __future__ import annotations
import json
import threading
import time
from typing import Optional

import asyncio
import cv2
import numpy as np

from app.config.logging import get_logger
from app.core.vision import (
    DetectorInterface, EntryExitCounter, LineConfig, CrossingEvent
)
from app.core.frame_broker import FrameBroker
from app.core.events import EventBus, CounterUpdateEvent, CameraStatusEvent
from app.data.models import Camera, CameraStatus
from app.security import decrypt_credential

logger = get_logger(__name__)

_RECONNECT_DELAY_MIN = 2    # seconds
_RECONNECT_DELAY_MAX = 30
_RECONNECT_BACKOFF   = 1.5

# URL patterns that need yt-dlp resolution
_YTDLP_DOMAINS = (
    "youtube.com", "youtu.be", "twitch.tv", "facebook.com",
    "instagram.com", "tiktok.com", "dailymotion.com", "vimeo.com",
    "twitter.com", "x.com",
)


def _resolve_stream_url(url: str) -> str:
    """
    Resolve a web video URL (YouTube, Twitch, etc.) to a direct stream URL
    using yt-dlp. Returns the original URL if it doesn't match known platforms.
    """
    lower = url.lower()
    if not any(domain in lower for domain in _YTDLP_DOMAINS):
        return url  # RTSP, HTTP MJPEG, file path — use as-is

    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            # Prefer a format with both video+audio in a single file,
            # avoid DASH/HLS manifests that OpenCV cannot handle.
            # bestvideo[ext=mp4]+bestaudio falls back gracefully.
            "format": "best[ext=mp4][protocol=https]/best[ext=mp4]/best[protocol=https]/best",
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            # For playlists, take first entry
            if "entries" in info:
                info = info["entries"][0]
            # Prefer a single direct URL over a manifest
            direct_url = info.get("url")
            if not direct_url:
                # Fall back to manifest URL (HLS/DASH) — OpenCV may handle it
                direct_url = info.get("manifest_url")
            if not direct_url:
                raise RuntimeError("yt-dlp could not extract stream URL")
            logger.info("Resolved stream URL via yt-dlp",
                        original=url, resolved=direct_url[:80])
            return direct_url
    except Exception as exc:
        logger.error("yt-dlp resolve failed", url=url, error=str(exc))
        raise RuntimeError(f"Cannot resolve stream URL: {exc}") from exc


def _draw_overlay(
    frame: np.ndarray,
    detections,
    line: Optional[LineConfig],
    count_in: int,
    count_out: int,
    camera_name: str,
) -> np.ndarray:
    h, w = frame.shape[:2]

    for det in detections:
        x1, y1, x2, y2 = int(det.x1), int(det.y1), int(det.x2), int(det.y2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"ID:{det.track_id} {det.confidence:.2f}"
        cv2.putText(frame, label, (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

    if line is not None:
        pt1, pt2 = line.to_pixel(w, h)
        cv2.line(frame, pt1, pt2, (0, 0, 255), 2)

    net = count_in - count_out
    cv2.rectangle(frame, (0, 0), (280, 62), (0, 0, 0), -1)
    cv2.putText(frame, f"{camera_name}", (6, 17),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(frame, f"IN:{count_in}  OUT:{count_out}  NET:{net}", (6, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
    return frame


class CameraWorker:
    """
    Background thread: capture → detect → count → annotate → push.

    Key improvements:
    - Counter update published every frame (not only on crossing) so dashboard
      shows live counts even when nobody is crossing.
    - Thread-safe line reload via RLock.
    - Exponential back-off on reconnect.
    - Low-latency RTSP flags: FFMPEG backend, buffer=1, TCP transport.
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
        self._counter: Optional[EntryExitCounter] = None
        self._line: Optional[LineConfig] = None
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
            try:
                raw_url = decrypt_credential(self._camera.url_encrypted)

                # Resolve YouTube / Twitch / etc. to direct stream URL via yt-dlp
                source_type = getattr(self._camera, "source_type", "rtsp") or "rtsp"
                if source_type == "youtube":
                    url = _resolve_stream_url(raw_url)
                elif source_type in ("rtsp", "http"):
                    # Also try yt-dlp for http URLs that look like web video pages
                    url = _resolve_stream_url(raw_url)
                else:
                    url = raw_url

                # Low-latency capture: prefer FFMPEG backend, minimal buffer
                is_web_stream = source_type == "youtube" or any(
                    d in raw_url.lower() for d in _YTDLP_DOMAINS
                )
                cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
                if is_web_stream:
                    # Web streams need larger buffer — they have variable latency
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 10)
                    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 30000)
                    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 30000)
                else:
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)
                    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000)

                if not cap.isOpened():
                    raise RuntimeError("Cannot open stream")

                self._set_status(CameraStatus.active)
                self._reconnect_delay = _RECONNECT_DELAY_MIN  # reset on success

                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480

                with self._counter_lock:
                    self._line = self._parse_line()
                    if self._line:
                        self._counter = EntryExitCounter(
                            camera_id=self._camera.id,
                            line=self._line,
                            frame_w=w, frame_h=h,
                        )

                frame_count = 0
                while not self._stop_event.is_set():
                    ok, frame = cap.read()
                    if not ok:
                        logger.warning("Frame read failed", camera_id=self._camera.id)
                        break

                    detections = self._detector.detect(frame)
                    frame_count += 1

                    with self._counter_lock:
                        crossing_events = []
                        if self._counter is not None:
                            crossing_events = self._counter.update(detections)

                        for ev in crossing_events:
                            self._on_crossing(ev.camera_id, ev.direction, ev.track_id)

                        # Publish counter every frame for live dashboard
                        # (on_crossing only fires for actual crossings)
                        count_in  = self._counter.count_in  if self._counter else 0
                        count_out = self._counter.count_out if self._counter else 0
                        line_snap = self._line

                    # Publish counter update every frame so WS clients stay current
                    self._publish_counter(count_in, count_out)

                    annotated = _draw_overlay(
                        frame.copy(), detections, line_snap,
                        count_in, count_out, self._camera.name,
                    )
                    self._broker.put_frame(self._camera.id, annotated)

                cap.release()

            except Exception as exc:
                logger.error("CameraWorker error",
                             camera_id=self._camera.id, error=str(exc))
                self._set_status(CameraStatus.error)

            finally:
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

    def _parse_line(self) -> Optional[LineConfig]:
        if not self._camera.line_config:
            return None
        try:
            return LineConfig.from_dict(json.loads(self._camera.line_config))
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("Invalid line_config",
                           camera_id=self._camera.id, error=str(exc))
            return None

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
        """Hot-reload virtual line without restarting the worker."""
        try:
            new_line = LineConfig.from_dict(json.loads(line_config))
            with self._counter_lock:
                if self._counter:
                    w, h = self._counter._frame_w, self._counter._frame_h
                else:
                    w, h = 640, 480
                self._line = new_line
                self._counter = EntryExitCounter(
                    camera_id=self._camera.id,
                    line=new_line, frame_w=w, frame_h=h,
                )
            logger.info("Line config reloaded", camera_id=self._camera.id)
        except Exception as exc:
            logger.error("reload_line failed",
                         camera_id=self._camera.id, error=str(exc))
