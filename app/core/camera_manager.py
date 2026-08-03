"""CameraManager — per-camera detector instance, async crossing event queue."""
from __future__ import annotations
import asyncio
import queue
import threading
from datetime import datetime
from typing import Dict, Optional

from app.config.logging import get_logger
from app.core.camera_worker import CameraWorker
from app.core.vision import DetectorInterface, YoloV8Detector
from app.core.frame_broker import FrameBroker, get_frame_broker
from app.core.events import EventBus, get_event_bus
from app.data.database import SessionLocal
from app.data.models import CameraStatus, CrossingDirection
from app.data.repositories import CameraRepository, CrossingEventRepository
from app.config.settings import get_settings

logger = get_logger(__name__)

# Each DB write is queued so camera threads never block on I/O
_crossing_queue: queue.Queue = queue.Queue(maxsize=2048)
_db_writer_thread: Optional[threading.Thread] = None


def _db_writer_loop() -> None:
    """Background thread: drains crossing event queue → PostgreSQL."""
    while True:
        item = _crossing_queue.get()
        if item is None:          # sentinel – stop signal
            break
        camera_id, direction, track_id = item
        try:
            with SessionLocal() as db:
                CrossingEventRepository(db).record(
                    camera_id=camera_id,
                    direction=CrossingDirection.in_ if direction == "in" else CrossingDirection.out,
                    track_id=track_id,
                )
        except Exception as exc:
            logger.error("DB crossing write failed", error=str(exc))
        finally:
            _crossing_queue.task_done()


def _ensure_db_writer() -> None:
    global _db_writer_thread
    if _db_writer_thread is None or not _db_writer_thread.is_alive():
        _db_writer_thread = threading.Thread(
            target=_db_writer_loop,
            name="db-writer",
            daemon=True,
        )
        _db_writer_thread.start()


class CameraManager:
    """
    Owns all CameraWorkers.

    Improvements over v1:
    - Each camera gets its own YoloV8Detector instance (no shared state / GIL
      contention between workers using the same model object).
    - Crossing events are written to DB via a dedicated queue+thread so workers
      never block on PostgreSQL latency.
    """

    def __init__(
        self,
        frame_broker: FrameBroker,
        event_bus: EventBus,
        loop: asyncio.AbstractEventLoop,
    ):
        self._broker = frame_broker
        self._event_bus = event_bus
        self._loop = loop
        self._workers: Dict[int, CameraWorker] = {}
        _ensure_db_writer()

    # ------------------------------------------------------------------

    def start_all(self) -> None:
        with SessionLocal() as db:
            cameras = CameraRepository(db).list_active()
        for cam in cameras:
            self._start_worker(cam)
        logger.info("CameraManager started", count=len(self._workers))

    def stop_all(self) -> None:
        for worker in list(self._workers.values()):
            worker.stop()
        self._workers.clear()
        # Drain queue then stop db writer
        _crossing_queue.join()
        _crossing_queue.put(None)   # sentinel
        logger.info("CameraManager stopped")

    # ------------------------------------------------------------------

    def start_camera(self, camera_id: int) -> bool:
        if camera_id in self._workers:
            return True
        with SessionLocal() as db:
            cam = CameraRepository(db).get_by_id(camera_id)
        if cam is None or not cam.is_active:
            return False
        self._start_worker(cam)
        return True

    def stop_camera(self, camera_id: int) -> None:
        worker = self._workers.pop(camera_id, None)
        if worker:
            worker.stop()
            self._broker.clear_camera(camera_id)

    def reload_line(self, camera_id: int, line_config_json: str) -> bool:
        worker = self._workers.get(camera_id)
        if worker:
            worker.reload_line(line_config_json)
            return True
        return False

    def is_running(self, camera_id: int) -> bool:
        return camera_id in self._workers

    def get_live_counter(self, camera_id: int) -> Optional[dict]:
        """Return latest in/out counts from the worker's counter (no DB hit)."""
        worker = self._workers.get(camera_id)
        if worker and worker._counter is not None:
            with worker._counter_lock:
                return {
                    "in": worker._counter.count_in,
                    "out": worker._counter.count_out,
                    "net": worker._counter.count_in - worker._counter.count_out,
                }
        return None

    # ------------------------------------------------------------------

    def _start_worker(self, camera) -> None:
        # Each camera gets its own detector instance
        settings = get_settings()
        detector = YoloV8Detector(model_path=settings.yolo_model_path)

        worker = CameraWorker(
            camera=camera,
            detector=detector,
            frame_broker=self._broker,
            event_bus=self._event_bus,
            loop=self._loop,
            on_crossing=self._handle_crossing,
            on_status=self._handle_status,
        )
        self._workers[camera.id] = worker
        worker.start()
        logger.info("Worker started", camera_id=camera.id)

    def _handle_crossing(self, camera_id: int, direction: str, track_id: Optional[int]) -> None:
        """Non-blocking: enqueue for async DB write."""
        try:
            _crossing_queue.put_nowait((camera_id, direction, track_id))
        except queue.Full:
            logger.warning("Crossing queue full – event dropped", camera_id=camera_id)

    def _handle_status(self, camera_id: int, status: CameraStatus) -> None:
        try:
            with SessionLocal() as db:
                CameraRepository(db).update_status(camera_id, status)
        except Exception as exc:
            logger.error("DB status update failed", error=str(exc))


# ---------------------------------------------------------------------------
_manager: Optional[CameraManager] = None


def get_camera_manager() -> CameraManager:
    if _manager is None:
        raise RuntimeError("CameraManager not initialised")
    return _manager


def init_camera_manager(loop: asyncio.AbstractEventLoop) -> CameraManager:
    global _manager
    broker = get_frame_broker()
    broker.set_loop(loop)
    bus = get_event_bus()
    _manager = CameraManager(frame_broker=broker, event_bus=bus, loop=loop)
    return _manager
