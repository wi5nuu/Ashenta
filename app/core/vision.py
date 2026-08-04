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

    def reset_tracker(self) -> None:
        """Reset internal tracker state (e.g. on video loop). Optional override."""
        pass


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

    def reset_tracker(self) -> None:
        """Reset ultralytics ByteTrack internal state.
        Call this when a video loops so track IDs restart from 1 and don't
        carry over ghost tracks from the previous play-through."""
        try:
            # ultralytics stores tracker state per predictor
            if hasattr(self._model, 'predictor') and self._model.predictor is not None:
                if hasattr(self._model.predictor, 'trackers'):
                    for tracker in self._model.predictor.trackers:
                        if hasattr(tracker, 'reset'):
                            tracker.reset()
                        else:
                            # Fallback: clear tracked objects dict
                            for attr in ('tracked_stracks', 'lost_stracks',
                                         'removed_stracks', 'kalman_filter'):
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
        # Dead-zone: ignore detections within 1% of line length from the line
        dead_zone = line_len * 0.01

        events: List[CrossingEvent] = []
        seen_ids: set = set()

        for det in detections:
            tid = det.track_id
            seen_ids.add(tid)

            # Use foot point (bottom-centre) for more stable line crossing
            px, py = det.foot
            raw = _side_of_line(lx1, ly1, lx2, ly2, px, py)

            # Skip detections in the dead-zone right on the line
            if abs(raw) < dead_zone:
                continue

            side = 1.0 if raw > 0 else -1.0
            prev = self._prev_side.get(tid)

            if prev is None:
                # First time we see this track — record which side it's on
                self._prev_side[tid] = side
                continue

            if side == prev:
                # Still on the same confirmed side — nothing to do
                # Clear any stale candidate (track bounced back)
                self._crossing_candidate.pop(tid, None)
                continue

            # side != prev: track has moved to the other side of the line.
            # Use the crossing guard to require _CROSSING_GUARD_FRAMES
            # consecutive frames on the new side before confirming.
            cand = self._crossing_candidate.get(tid)
            if cand is None:
                # Start a new candidate
                self._crossing_candidate[tid] = (side, 1)
            else:
                cand_side, cand_count = cand
                if cand_side == side:
                    # Still on the candidate side — increment guard counter
                    new_count = cand_count + 1
                    if new_count >= _CROSSING_GUARD_FRAMES:
                        # Crossing confirmed — fire event
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
                        # Update confirmed side, clear candidate
                        self._prev_side[tid] = side
                        del self._crossing_candidate[tid]
                    else:
                        self._crossing_candidate[tid] = (cand_side, new_count)
                else:
                    # Track bounced to yet another side — reset candidate
                    self._crossing_candidate[tid] = (side, 1)

        # Prune stale track IDs to avoid unbounded memory growth
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

    def reset_tracker_state(self) -> None:
        """Clear tracker state (prev_side, candidates) without resetting counts.
        Call this when a video loops so track IDs from the new loop are treated
        as fresh tracks and don't cause spurious crossings."""
        self._prev_side.clear()
        self._crossing_candidate.clear()


# ---------------------------------------------------------------------------
# Multi-line counter — aggregates N EntryExitCounter instances
# ---------------------------------------------------------------------------

class MultiLineCounter:
    """
    Wraps multiple EntryExitCounter instances (one per virtual line).
    Exposes the same count_in / count_out / update / reset_daily interface
    as EntryExitCounter so the rest of the codebase needs no changes.

    Format of lines_config (JSON string stored in Camera.line_config):
        [{"x1":0.1,"y1":0.5,"x2":0.9,"y2":0.5,"label":"Door A"}, ...]

    Backward compat: if the stored value is a plain dict (single-line legacy)
    it is automatically wrapped in a list.
    """

    def __init__(
        self,
        camera_id: int,
        lines: List[LineConfig],
        frame_w: int = 640,
        frame_h: int = 480,
    ):
        self._counters: List[EntryExitCounter] = [
            EntryExitCounter(camera_id=camera_id, line=line, frame_w=frame_w, frame_h=frame_h)
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
        Parse line_config JSON string.  Returns a list of LineConfig or None.
        Handles both legacy single-object format and new array format.
        """
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                # Legacy single-line format — wrap in list
                return [LineConfig.from_dict(parsed)]
            if isinstance(parsed, list) and parsed:
                return [LineConfig.from_dict(d) for d in parsed]
        except (json.JSONDecodeError, KeyError):
            pass
        return None
