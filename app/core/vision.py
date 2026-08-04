"""Core computer vision abstractions (DetectorInterface, YoloV8Detector, EntryExitCounter).

Professional people-counting pipeline:
- ByteTrack tracker via ultralytics for stable multi-person tracking
- Foot-point (bottom-centre) line crossing for accuracy
- Interpolation-based crossing: check if track path INTERSECTS the line between frames
  (eliminates dependency on guard frame count entirely)
- Dead-zone eliminated — interpolation handles jitter naturally
"""
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
    label: Optional[str] = None

    @classmethod
    def from_dict(cls, d: dict) -> "LineConfig":
        return cls(
            x1=d["x1"], y1=d["y1"], x2=d["x2"], y2=d["y2"],
            label=d.get("label"),
        )

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
# Abstract detector interface
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

    def reset_tracker(self) -> None:
        """Reset internal tracker state (e.g. on video loop). Optional override."""
        pass


# ---------------------------------------------------------------------------
# YOLOv8 implementation
# ---------------------------------------------------------------------------

# Relaxed thresholds for better detection coverage:
# - Smaller min_area catches people who are far away or partially visible
# - Smaller min_height allows detection of distant/crouching people
_MIN_BOX_AREA_RATIO  = 0.0005  # 0.05% of frame (was 0.2% — too restrictive)
_MIN_BOX_HEIGHT_RATIO = 0.02   # 2% of frame height (was 4% — too restrictive)


class YoloV8Detector(DetectorInterface):
    """
    YOLOv8 person detector with ByteTrack tracking via ultralytics.

    Tuned for people-counting:
    - confidence 0.35: catches partially occluded people (was 0.50 — missed many)
    - iou 0.45: standard NMS threshold
    - tracker="bytetrack.yaml": best for crowded scenes
    - imgsz=640: standard input size
    """

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        confidence: float = 0.35,
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

    def reset_tracker(self) -> None:
        """Reset ultralytics ByteTrack internal state (e.g. on video loop)."""
        try:
            if hasattr(self._model, 'predictor') and self._model.predictor is not None:
                if hasattr(self._model.predictor, 'trackers'):
                    for tracker in self._model.predictor.trackers:
                        if hasattr(tracker, 'reset'):
                            tracker.reset()
                        else:
                            for attr in ('tracked_stracks', 'lost_stracks',
                                         'removed_stracks'):
                                if hasattr(tracker, attr):
                                    v = getattr(tracker, attr)
                                    if isinstance(v, list):
                                        v.clear()
        except Exception as exc:
            logger.debug("reset_tracker: minor error (safe to ignore)",
                         error=str(exc))

    def detect(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        frame_area = float(w * h)
        min_area   = frame_area * _MIN_BOX_AREA_RATIO
        min_height = h * _MIN_BOX_HEIGHT_RATIO

        results = self._model.track(
            frame,
            persist=True,
            classes=[0],              # class 0 = person only
            conf=self._confidence,
            iou=self._iou,
            imgsz=640,
            verbose=False,
            tracker="bytetrack.yaml",
        )

        detections: List[Detection] = []
        for r in results:
            if r.boxes is None:
                continue
            boxes = r.boxes
            ids   = boxes.id
            if ids is None:
                continue
            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf     = float(box.conf[0])
                track_id = int(ids[i])

                bw = x2 - x1
                bh = y2 - y1

                if bw * bh < min_area or bh < min_height:
                    continue

                detections.append(Detection(
                    track_id=track_id,
                    x1=x1, y1=y1, x2=x2, y2=y2,
                    confidence=conf,
                ))
        return detections


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _cross2d(ax: float, ay: float, bx: float, by: float) -> float:
    """2D cross product of vectors A and B."""
    return ax * by - ay * bx


def _segments_intersect(
    p1x: float, p1y: float, p2x: float, p2y: float,
    p3x: float, p3y: float, p4x: float, p4y: float,
) -> Optional[float]:
    """
    Check if segment P1-P2 (track path) crosses segment P3-P4 (counting line).
    Returns the signed cross product at crossing to determine direction,
    or None if segments do not intersect.

    Direction convention:
      - positive → "in"  (crossed from left to right relative to line direction)
      - negative → "out"
    """
    d1x, d1y = p2x - p1x, p2y - p1y  # track motion vector
    d2x, d2y = p4x - p3x, p4y - p3y  # line direction vector

    denom = _cross2d(d1x, d1y, d2x, d2y)
    if abs(denom) < 1e-10:
        return None  # parallel

    t = _cross2d(p3x - p1x, p3y - p1y, d2x, d2y) / denom
    u = _cross2d(p3x - p1x, p3y - p1y, d1x, d1y) / denom

    # Both parameters must be in [0, 1] for intersection within segments
    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        # Return direction: positive = "in", negative = "out"
        # This is the cross product of line direction × motion direction
        return _cross2d(d2x, d2y, d1x, d1y)
    return None


def _side_of_line(
    lx1: float, ly1: float, lx2: float, ly2: float,
    px: float, py: float
) -> float:
    """Signed area of the triangle — positive = one side, negative = other."""
    return (lx2 - lx1) * (py - ly1) - (ly2 - ly1) * (px - lx1)


# ---------------------------------------------------------------------------
# Entry / Exit Counter — interpolation-based crossing
# ---------------------------------------------------------------------------

class EntryExitCounter:
    """
    Professional stateful counter using SEGMENT INTERSECTION for crossing detection.

    Why interpolation > guard-frame approach:
    - Guard frames require N consecutive frames on the new side — fails when:
      * person moves quickly (crosses in 1-2 frames)
      * frame skipping is active
      * YOLO misses 1 frame mid-crossing
    - Segment intersection checks if the foot-point PATH between two frames
      actually crosses the line — works regardless of speed or frame rate.

    Crossing direction:
      - "in"  when track crosses from positive side to negative side of line
      - "out" when track crosses from negative side to positive side of line
    """

    def __init__(
        self,
        camera_id: int,
        line: LineConfig,
        frame_w: int = 640,
        frame_h: int = 480,
    ):
        self._camera_id = camera_id
        self._line      = line
        self._frame_w   = frame_w
        self._frame_h   = frame_h

        self._count_in  = 0
        self._count_out = 0

        # Previous foot position per track_id for interpolation
        self._prev_foot: Dict[int, Tuple[float, float]] = {}

        # Cooldown: track_id → frames_until_can_count_again
        # Prevents double-counting from detection jitter right after a crossing
        self._cooldown: Dict[int, int] = {}
        self._COOLDOWN_FRAMES = 8  # frames to ignore same track after crossing

    def _pixel_line(self) -> Tuple[float, float, float, float]:
        """Return line endpoints in pixel space."""
        return (
            self._line.x1 * self._frame_w,
            self._line.y1 * self._frame_h,
            self._line.x2 * self._frame_w,
            self._line.y2 * self._frame_h,
        )

    def update(self, detections: List[Detection]) -> List[CrossingEvent]:
        lx1, ly1, lx2, ly2 = self._pixel_line()
        events: List[CrossingEvent] = []
        seen_ids: set = set()

        # Decrement cooldowns
        expired = [tid for tid, c in self._cooldown.items() if c <= 1]
        for tid in expired:
            del self._cooldown[tid]
        for tid in self._cooldown:
            self._cooldown[tid] -= 1

        for det in detections:
            tid = det.track_id
            seen_ids.add(tid)

            curr_foot = det.foot  # (fx, fy) in pixel space

            prev_foot = self._prev_foot.get(tid)
            self._prev_foot[tid] = curr_foot

            if prev_foot is None:
                # First time seeing this track — just record position
                continue

            # Skip if track is in cooldown
            if tid in self._cooldown:
                continue

            # Check if track path (prev_foot → curr_foot) intersects the line
            direction = _segments_intersect(
                prev_foot[0], prev_foot[1],
                curr_foot[0],  curr_foot[1],
                lx1, ly1, lx2, ly2,
            )

            if direction is None:
                continue  # no crossing this frame

            if direction > 0:
                self._count_in += 1
                self._cooldown[tid] = self._COOLDOWN_FRAMES
                events.append(CrossingEvent(
                    track_id=tid, direction="in",
                    camera_id=self._camera_id,
                ))
            else:
                self._count_out += 1
                self._cooldown[tid] = self._COOLDOWN_FRAMES
                events.append(CrossingEvent(
                    track_id=tid, direction="out",
                    camera_id=self._camera_id,
                ))

        # Prune stale track IDs to avoid memory growth
        stale = set(self._prev_foot.keys()) - seen_ids
        for sid in stale:
            self._prev_foot.pop(sid, None)
            self._cooldown.pop(sid, None)

        return events

    @property
    def count_in(self) -> int:
        return self._count_in

    @property
    def count_out(self) -> int:
        return self._count_out

    def reset_daily(self) -> None:
        self._count_in  = 0
        self._count_out = 0

    def reset_tracker_state(self) -> None:
        """Clear tracker state without resetting counts (e.g. on video loop)."""
        self._prev_foot.clear()
        self._cooldown.clear()


# ---------------------------------------------------------------------------
# Multi-line counter — aggregates N EntryExitCounter instances
# ---------------------------------------------------------------------------

class MultiLineCounter:
    """
    Wraps multiple EntryExitCounter instances (one per virtual line).
    Exposes the same interface as EntryExitCounter.
    """

    def __init__(
        self,
        camera_id: int,
        lines: List[LineConfig],
        frame_w: int = 640,
        frame_h: int = 480,
    ):
        self._counters: List[EntryExitCounter] = [
            EntryExitCounter(
                camera_id=camera_id, line=line,
                frame_w=frame_w, frame_h=frame_h,
            )
            for line in lines
        ]

    def update(self, detections: List[Detection]) -> List[CrossingEvent]:
        events: List[CrossingEvent] = []
        for counter in self._counters:
            events.extend(counter.update(detections))
        return events

    @property
    def count_in(self) -> int:
        return sum(c.count_in for c in self._counters)

    @property
    def count_out(self) -> int:
        return sum(c.count_out for c in self._counters)

    @property
    def lines(self) -> List[LineConfig]:
        return [c._line for c in self._counters]

    @property
    def _frame_w(self) -> int:
        return self._counters[0]._frame_w if self._counters else 640

    @property
    def _frame_h(self) -> int:
        return self._counters[0]._frame_h if self._counters else 480

    def reset_daily(self) -> None:
        for c in self._counters:
            c.reset_daily()

    def reset_tracker_state(self) -> None:
        """Clear tracker state on all child counters (e.g. on video loop)."""
        for c in self._counters:
            c.reset_tracker_state()

    @staticmethod
    def parse_line_config(raw: str) -> Optional[List[LineConfig]]:
        """
        Parse line_config JSON string. Returns a list of LineConfig or None.
        Handles both legacy single-object format and new array format.
        """
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return [LineConfig.from_dict(parsed)]
            if isinstance(parsed, list) and parsed:
                return [LineConfig.from_dict(d) for d in parsed]
        except (json.JSONDecodeError, KeyError):
            pass
        return None
