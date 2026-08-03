"""Core computer vision abstractions (DetectorInterface, YoloV8Detector, EntryExitCounter)."""
from __future__ import annotations
import abc
import json
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict

import numpy as np

from app.config.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Detection:
    """Single person detection in a frame."""
    track_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float

    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    @property
    def foot(self) -> Tuple[float, float]:
        """Bottom-centre of bounding box – more stable for line crossing."""
        return ((self.x1 + self.x2) / 2, self.y2)


@dataclass
class LineConfig:
    """Normalised virtual counting line (0–1 coordinate space)."""
    x1: float
    y1: float
    x2: float
    y2: float

    @classmethod
    def from_dict(cls, d: dict) -> "LineConfig":
        return cls(x1=d["x1"], y1=d["y1"], x2=d["x2"], y2=d["y2"])

    def to_dict(self) -> dict:
        return {"x1": self.x1, "y1": self.y1, "x2": self.x2, "y2": self.y2}

    def to_pixel(self, width: int, height: int) -> Tuple[Tuple[int, int], Tuple[int, int]]:
        return (
            (int(self.x1 * width), int(self.y1 * height)),
            (int(self.x2 * width), int(self.y2 * height)),
        )


@dataclass
class CrossingEvent:
    track_id: int
    direction: str  # "in" or "out"
    camera_id: int


# ---------------------------------------------------------------------------
# Abstract detector interface (SOLID – Dependency Inversion)
# ---------------------------------------------------------------------------

class DetectorInterface(abc.ABC):
    @abc.abstractmethod
    def detect(self, frame: np.ndarray) -> List[Detection]:
        """Run detection + tracking on a frame, return list of Detection."""
        ...

    @abc.abstractmethod
    def warmup(self) -> None:
        """Optional model warmup."""
        ...


# ---------------------------------------------------------------------------
# YOLOv8 implementation
# ---------------------------------------------------------------------------

class YoloV8Detector(DetectorInterface):
    """YOLOv8 person detector with ByteTrack tracking via ultralytics."""

    def __init__(self, model_path: str = "yolov8n.pt", confidence: float = 0.4):
        import os
        os.environ.setdefault("YOLO_AUTOINSTALL", "False")  # prevent mid-run pip installs
        from ultralytics import YOLO  # deferred import – not needed in tests
        self._model = YOLO(model_path)
        self._confidence = confidence
        logger.info("YoloV8Detector loaded", model=model_path, conf=confidence)

    def warmup(self) -> None:
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        self.detect(dummy)
        logger.info("YoloV8Detector warmup complete")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        results = self._model.track(
            frame,
            persist=True,
            classes=[0],          # class 0 = person
            conf=self._confidence,
            verbose=False,
        )
        detections: List[Detection] = []
        for r in results:
            if r.boxes is None:
                continue
            boxes = r.boxes
            ids = boxes.id
            if ids is None:
                continue
            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                track_id = int(ids[i])
                detections.append(Detection(
                    track_id=track_id,
                    x1=x1, y1=y1, x2=x2, y2=y2,
                    confidence=conf,
                ))
        return detections


# ---------------------------------------------------------------------------
# Entry / Exit Counter
# ---------------------------------------------------------------------------

def _side_of_line(
    lx1: float, ly1: float, lx2: float, ly2: float,
    px: float, py: float
) -> float:
    """Signed area of the triangle – positive = one side, negative = other."""
    return (lx2 - lx1) * (py - ly1) - (ly2 - ly1) * (px - lx1)


class EntryExitCounter:
    """
    Stateful counter per camera.

    Crossing direction convention:
        - "in"  when sign flips from positive → negative
        - "out" when sign flips from negative → positive

    Coordinates passed to update() must already be in pixel space
    and will be normalised internally.
    """

    def __init__(self, camera_id: int, line: LineConfig, frame_w: int, frame_h: int):
        self._camera_id = camera_id
        self._line = line
        self._frame_w = frame_w
        self._frame_h = frame_h
        # track_id → last signed side
        self._prev_side: Dict[int, float] = {}
        self._count_in = 0
        self._count_out = 0

    def update(self, detections: List[Detection]) -> List[CrossingEvent]:
        """
        Given new detections (in pixel coords), return crossing events this frame.
        """
        # Convert normalised line to pixel
        (lx1, ly1), (lx2, ly2) = self._line.to_pixel(self._frame_w, self._frame_h)
        events: List[CrossingEvent] = []

        seen_ids = set()
        for det in detections:
            tid = det.track_id
            seen_ids.add(tid)
            fx, fy = det.foot  # pixel coords

            side = _side_of_line(lx1, ly1, lx2, ly2, fx, fy)
            prev = self._prev_side.get(tid)

            if prev is not None and prev != 0 and side != 0:
                if prev > 0 and side < 0:
                    self._count_in += 1
                    events.append(CrossingEvent(
                        track_id=tid, direction="in", camera_id=self._camera_id
                    ))
                elif prev < 0 and side > 0:
                    self._count_out += 1
                    events.append(CrossingEvent(
                        track_id=tid, direction="out", camera_id=self._camera_id
                    ))

            if side != 0:
                self._prev_side[tid] = side

        # Prune stale track IDs to avoid unbounded growth
        stale = set(self._prev_side.keys()) - seen_ids
        for sid in stale:
            del self._prev_side[sid]

        return events

    @property
    def count_in(self) -> int:
        return self._count_in

    @property
    def count_out(self) -> int:
        return self._count_out

    def reset_daily(self) -> None:
        self._count_in = 0
        self._count_out = 0
