"""CameraWorker — low-latency RTSP/HTTP/video capture, per-frame counter publish, thread-safe line reload."""
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
_RECONNECT_DELAY_MAX = 60
_RECONNECT_BACKOFF   = 1.5

# Supported source types: rtsp, rtmp, http (MJPEG/HLS), file path
# YouTube/social media URLs are NOT supported — use a real IP camera or RTSP stream.


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
        # Green bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        # Foot point marker for debugging line crossing
        fx, fy = int((x1 + x2) / 2), y2
        cv2.circle(frame, (fx, fy), 3, (0, 255, 255), -1)
        label = f"ID:{det.track_id} {det.confidence:.2f}"
        cv2.putText(frame, label, (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

    if line is not None:
        pt1, pt2 = line.to_pixel(w, h)
        # Red counting line with directional arrows
        cv2.line(frame, pt1, pt2, (0, 0, 255), 2)
        # Label the line ends
        cv2.putText(frame, "IN", (pt1[0] + 4, pt1[1] - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1)

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


def _open_capture(url: str) -> cv2.VideoCapture:
    """
    Open a video capture with low-latency settings appropriate for the URL type.
    Supports: RTSP, RTMP, HTTP MJPEG/HLS, local file/device index.
    """
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)

    lower = url.lower()
    if lower.startswith("rtsp://") or lower.startswith("rtmp://"):
        # RTSP/RTMP: minimal buffer, TCP transport, fast open
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10_000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10_000)
        # Force TCP for more reliable RTSP delivery
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*'H264'))
    elif lower.startswith("http://") or lower.startswith("https://"):
        # HTTP MJPEG / HLS: slightly larger buffer for network jitter
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

    Supports RTSP, RTMP, HTTP MJPEG/HLS, and local video files.
    YouTube and other social media URLs are not supported.

    Accuracy features:
    - YOLOv8s with ByteTrack (configured in YoloV8Detector)
    - Crossing guard in EntryExitCounter (3-frame confirmation)
    - Foot-point line crossing (more stable than centroid)
    - Minimum bounding box size filter
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
                    self._line = self._parse_line()
                    if self._line:
                        self._counter = EntryExitCounter(
                            camera_id=self._camera.id,
                            line=self._line,
                            frame_w=w, frame_h=h,
                        )

                consecutive_failures = 0
                while not self._stop_event.is_set():
                    ok, frame = cap.read()
                    if not ok:
                        consecutive_failures += 1
                        if consecutive_failures >= 5:
                            logger.warning("Too many consecutive frame failures",
                                           camera_id=self._camera.id)
                            break
                        time.sleep(0.05)
                        continue

                    consecutive_failures = 0
                    detections = self._detector.detect(frame)

                    with self._counter_lock:
                        crossing_events = []
                        if self._counter is not None:
                            crossing_events = self._counter.update(detections)

                        for ev in crossing_events:
                            self._on_crossing(ev.camera_id, ev.direction, ev.track_id)

                        count_in  = self._counter.count_in  if self._counter else 0
                        count_out = self._counter.count_out if self._counter else 0
                        line_snap = self._line

                    # Publish counter every frame so WS dashboard stays live
                    self._publish_counter(count_in, count_out)

                    annotated = _draw_overlay(
                        frame.copy(), detections, line_snap,
                        count_in, count_out, self._camera.name,
                    )
                    self._broker.put_frame(self._camera.id, annotated)

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
                w = self._counter._frame_w if self._counter else 640
                h = self._counter._frame_h if self._counter else 480
                self._line = new_line
                self._counter = EntryExitCounter(
                    camera_id=self._camera.id,
                    line=new_line, frame_w=w, frame_h=h,
                )
            logger.info("Line config reloaded", camera_id=self._camera.id)
        except Exception as exc:
            logger.error("reload_line failed",
                         camera_id=self._camera.id, error=str(exc))
