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

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    @property
    def area(self) -> float:
        return self.width * self.height


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

# Minimum bounding box area as fraction of total frame area.
# Filters out tiny detections caused by background noise.
_MIN_BOX_AREA_RATIO = 0.002   # 0.2% of frame — ignores sub-pixel ghosts
_MIN_BOX_HEIGHT_RATIO = 0.04  # box height must be at least 4% of frame height


class YoloV8Detector(DetectorInterface):
    """
    YOLOv8 person detector with ByteTrack tracking via ultralytics.

    Accuracy improvements over the baseline:
    - Uses yolov8s.pt (small) instead of yolov8n.pt (nano): ~5% higher mAP
    - Confidence threshold 0.50 to reduce false positives
    - IOU threshold 0.45 for tighter NMS
    - imgsz=640 explicit (default but ensures no accidental downscaling)
    - Minimum bounding box size filter applied post-detection
    """

    def __init__(
        self,
        model_path: str = "yolov8s.pt",
        confidence: float = 0.50,
        iou: float = 0.45,
    ):
        import os
        os.environ.setdefault("YOLO_AUTOINSTALL", "False")
        from ultralytics import YOLO
        self._model = YOLO(model_path)
        self._confidence = confidence
        self._iou = iou
        logger.info("YoloV8Detector loaded", model=model_path,
                    conf=confidence, iou=iou)

    def warmup(self) -> None:
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        self.detect(dummy)
        logger.info("YoloV8Detector warmup complete")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        frame_area = float(w * h)
        min_area  = frame_area * _MIN_BOX_AREA_RATIO
        min_height = h * _MIN_BOX_HEIGHT_RATIO

        results = self._model.track(
            frame,
            persist=True,
            classes=[0],              # class 0 = person only
            conf=self._confidence,
            iou=self._iou,
            imgsz=640,
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

                bw = x2 - x1
                bh = y2 - y1

                # Filter out too-small detections (background artefacts)
                if bw * bh < min_area or bh < min_height:
                    continue

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


# Number of consecutive frames a track must be on the same side before a
# crossing is registered.  Eliminates ghost crossings from detection jitter.
_CROSSING_GUARD_FRAMES = 3


class EntryExitCounter:
    """
    Stateful counter per camera.

    Crossing direction convention:
        - "in"  when sign flips from positive → negative
        - "out" when sign flips from negative → positive

    Accuracy improvements:
    - Uses foot point (bottom-centre) instead of centroid for line testing
    - Crossing guard: track must be stable on the new side for
      _CROSSING_GUARD_FRAMES consecutive frames before counting
    - Dead-zone: detections within 1% of the line are ignored (side == 0)
      to prevent flickering at the boundary
    """

    def __init__(
        self,
        camera_id: int,
        line: LineConfig,
        frame_w: int = 640,
        frame_h: int = 480,
    ):
        self._camera_id = camera_id
        self._line = line
        self._frame_w = frame_w
        self._frame_h = frame_h

        self._count_in  = 0
        self._count_out = 0

        # last confirmed side per track_id (+1 or -1)
        self._prev_side: Dict[int, float] = {}

        # candidate crossing buffer: track_id -> (candidate_side, frame_count)
        # When frame_count reaches _CROSSING_GUARD_FRAMES the crossing fires.
        self._crossing_candidate: Dict[int, Tuple[float, int]] = {}

    def _pixel_line(self) -> Tuple[float, float, float, float]:
        """Return line endpoints in pixel space."""
        lx1 = self._line.x1 * self._frame_w
        ly1 = self._line.y1 * self._frame_h
        lx2 = self._line.x2 * self._frame_w
        ly2 = self._line.y2 * self._frame_h
        return lx1, ly1, lx2, ly2

    def update(self, detections: List[Detection]) -> List[CrossingEvent]:
        lx1, ly1, lx2, ly2 = self._pixel_line()

        # Normalise line length for dead-zone calculation
        line_len = max(
            ((lx2 - lx1) ** 2 + (ly2 - ly1) ** 2) ** 0.5, 1.0
        )
        # Dead-zone threshold: ignore if within 1% of line length
        dead_zone = line_len * 0.01

        events: List[CrossingEvent] = []
        seen_ids: set = set()

        for det in detections:
            tid = det.track_id
            seen_ids.add(tid)

            # Use foot point for more stable line crossing
            px, py = det.foot

            raw = _side_of_line(lx1, ly1, lx2, ly2, px, py)

            # Dead-zone: skip if too close to the line
            if abs(raw) < dead_zone:
                continue

            side = 1.0 if raw > 0 else -1.0
            prev = self._prev_side.get(tid)

            if prev is None:
                # First time we see this track — just record side, no crossing
                self._prev_side[tid] = side
                continue

            if side == prev:
                # Same side — check if we have a pending candidate to confirm
                cand = self._crossing_candidate.get(tid)
                if cand is not None:
                    cand_side, cand_count = cand
                    if cand_side == side:
                        # Still on the candidate side — increment guard counter
                        new_count = cand_count + 1
                        if new_count >= _CROSSING_GUARD_FRAMES:
                            # Crossing confirmed — fire event
                            if prev == 1.0 and side == -1.0:
                                # prev was +1, now confirmed on -1 → "in"
                                pass  # handled below when candidate was set
                            # Determine direction from the OLD prev_side
                            # (stored when candidate was created)
                            old_side = self._crossing_candidate.get(tid, (side, 0))[0]
                            # fire based on direction of change
                            if old_side != self._prev_side.get(tid, old_side):
                                pass
                            del self._crossing_candidate[tid]
                            self._prev_side[tid] = side
                        else:
                            self._crossing_candidate[tid] = (cand_side, new_count)
                    else:
                        # Candidate changed — reset
                        self._crossing_candidate[tid] = (side, 1)
                # No candidate — all good, update side
                self._prev_side[tid] = side
            else:
                # Side changed vs confirmed prev — start or extend candidate
                cand = self._crossing_candidate.get(tid)
                if cand is None:
                    self._crossing_candidate[tid] = (side, 1)
                else:
                    cand_side, cand_count = cand
                    if cand_side == side:
                        new_count = cand_count + 1
                        if new_count >= _CROSSING_GUARD_FRAMES:
                            # Confirmed crossing
                            if prev > 0 and side < 0:
                                self._count_in += 1
                                events.append(CrossingEvent(
                                    track_id=tid, direction="in",
                                    camera_id=self._camera_id,
                                ))
                            elif prev < 0 and side > 0:
                                self._count_out += 1
                                events.append(CrossingEvent(
                                    track_id=tid, direction="out",
                                    camera_id=self._camera_id,
                                ))
                            del self._crossing_candidate[tid]
                            self._prev_side[tid] = side
                        else:
                            self._crossing_candidate[tid] = (cand_side, new_count)
                    else:
                        # Bounced back — reset candidate
                        self._crossing_candidate[tid] = (side, 1)

        # Prune stale track IDs to avoid unbounded growth
        stale = set(self._prev_side.keys()) - seen_ids
        for sid in stale:
            self._prev_side.pop(sid, None)
            self._crossing_candidate.pop(sid, None)

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
