"""FrameBroker — correct MJPEG multipart with Content-Length header."""
from __future__ import annotations
import asyncio
import threading
from typing import Dict, List, AsyncIterator, Optional
import cv2
import numpy as np

from app.config.logging import get_logger

logger = get_logger(__name__)

_JPEG_QUALITY = 70
_BOUNDARY_PREFIX = b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
_FRAME_TIMEOUT   = 10.0   # seconds to wait for next frame before giving up


class FrameBroker:
    """
    Thread-safe MJPEG frame broker.

    - Correct Content-Length in each MJPEG part header.
    - Queue per subscriber — one slow client doesn't affect others.
    - Latest raw JPEG stored per camera for snapshot endpoint.
    - Frames iterator has a timeout so MJPEG connections close when camera stops.
    """

    def __init__(self) -> None:
        self._queues:       Dict[int, List[asyncio.Queue]] = {}
        self._latest_jpeg:  Dict[int, bytes]               = {}
        self._loop:  asyncio.AbstractEventLoop | None      = None
        self._lock   = threading.Lock()

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def put_frame(self, camera_id: int, frame: np.ndarray) -> None:
        ok, buf = cv2.imencode(
            ".jpg", frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY],
        )
        if not ok:
            return
        jpeg_bytes = buf.tobytes()

        # Store latest JPEG for snapshot
        with self._lock:
            self._latest_jpeg[camera_id] = jpeg_bytes

        # Build full multipart chunk once, reuse for all subscribers
        chunk = (
            _BOUNDARY_PREFIX
            + str(len(jpeg_bytes)).encode()
            + b"\r\n\r\n"
            + jpeg_bytes
            + b"\r\n"
        )

        with self._lock:
            queues = list(self._queues.get(camera_id, []))

        if not queues or self._loop is None:
            return

        for q in queues:
            try:
                self._loop.call_soon_threadsafe(q.put_nowait, chunk)
            except asyncio.QueueFull:
                pass  # drop frame for slow client

    def get_latest_jpeg(self, camera_id: int) -> Optional[bytes]:
        """Return the most-recent JPEG frame for this camera, or None."""
        with self._lock:
            return self._latest_jpeg.get(camera_id)

    def clear_camera(self, camera_id: int) -> None:
        """Remove stored frame when camera stops."""
        with self._lock:
            self._latest_jpeg.pop(camera_id, None)

    def subscribe(self, camera_id: int) -> "_FrameSubscription":
        return _FrameSubscription(self, camera_id)

    def _add_queue(self, camera_id: int, q: asyncio.Queue) -> None:
        with self._lock:
            self._queues.setdefault(camera_id, []).append(q)

    def _remove_queue(self, camera_id: int, q: asyncio.Queue) -> None:
        with self._lock:
            qs = self._queues.get(camera_id, [])
            try:
                qs.remove(q)
            except ValueError:
                pass


class _FrameSubscription:
    def __init__(self, broker: FrameBroker, camera_id: int) -> None:
        self._broker    = broker
        self._camera_id = camera_id
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=4)

    async def __aenter__(self) -> "_FrameSubscription":
        self._broker._add_queue(self._camera_id, self._queue)
        return self

    async def __aexit__(self, *_) -> None:
        self._broker._remove_queue(self._camera_id, self._queue)

    async def frames(self) -> AsyncIterator[bytes]:
        """Yield MJPEG chunks. Stops automatically if no frame arrives within timeout."""
        while True:
            try:
                chunk = await asyncio.wait_for(
                    self._queue.get(), timeout=_FRAME_TIMEOUT
                )
                yield chunk
            except asyncio.TimeoutError:
                # Camera stopped sending — close the stream cleanly
                return


_frame_broker: FrameBroker | None = None


def get_frame_broker() -> FrameBroker:
    global _frame_broker
    if _frame_broker is None:
        _frame_broker = FrameBroker()
    return _frame_broker
