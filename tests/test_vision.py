"""Unit tests for EntryExitCounter and vision utilities."""
import pytest
from app.core.vision import (
    Detection, LineConfig, EntryExitCounter, _side_of_line
)


def make_detection(track_id: int, x1: float, y1: float, x2: float, y2: float) -> Detection:
    return Detection(track_id=track_id, x1=x1, y1=y1, x2=x2, y2=y2, confidence=0.9)


class TestSideOfLine:
    def test_point_left(self):
        # Vertical line x=320
        assert _side_of_line(320, 0, 320, 480, 100, 240) > 0

    def test_point_right(self):
        assert _side_of_line(320, 0, 320, 480, 500, 240) < 0

    def test_point_on_line(self):
        assert _side_of_line(320, 0, 320, 480, 320, 240) == 0


class TestLineConfig:
    def test_round_trip(self):
        lc = LineConfig(x1=0.5, y1=0.0, x2=0.5, y2=1.0)
        d = lc.to_dict()
        restored = LineConfig.from_dict(d)
        assert restored.x1 == lc.x1
        assert restored.y2 == lc.y2

    def test_to_pixel(self):
        lc = LineConfig(x1=0.5, y1=0.0, x2=0.5, y2=1.0)
        pt1, pt2 = lc.to_pixel(640, 480)
        assert pt1 == (320, 0)
        assert pt2 == (320, 480)


class TestEntryExitCounter:
    """
    Setup: vertical line at x=320 (normalised x=0.5).
    - person moving left→right (x increases past 320) triggers "in"
    - person moving right→left triggers "out"
    """

    def _make_counter(self) -> EntryExitCounter:
        line = LineConfig(x1=0.5, y1=0.0, x2=0.5, y2=1.0)
        return EntryExitCounter(camera_id=1, line=line, frame_w=640, frame_h=480)

    def test_no_events_single_frame(self):
        counter = self._make_counter()
        det = make_detection(1, 100, 100, 200, 300)  # left side
        events = counter.update([det])
        assert events == []
        assert counter.count_in == 0

    def test_crossing_in(self):
        """Track 1 starts left of line, then crosses to right → "in"."""
        counter = self._make_counter()
        # Frame 1: left side (foot at x=200)
        counter.update([make_detection(1, 150, 100, 250, 300)])
        # Frame 2: right side (foot at x=450)
        events = counter.update([make_detection(1, 400, 100, 500, 300)])
        assert len(events) == 1
        assert events[0].direction == "in"
        assert counter.count_in == 1
        assert counter.count_out == 0

    def test_crossing_out(self):
        """Track 2 starts right of line, crosses to left → "out"."""
        counter = self._make_counter()
        counter.update([make_detection(2, 400, 100, 500, 300)])
        events = counter.update([make_detection(2, 100, 100, 200, 300)])
        assert len(events) == 1
        assert events[0].direction == "out"
        assert counter.count_out == 1

    def test_no_double_count(self):
        """Same track staying on same side should not generate events."""
        counter = self._make_counter()
        counter.update([make_detection(1, 100, 100, 200, 300)])
        events = counter.update([make_detection(1, 150, 100, 250, 300)])
        assert events == []

    def test_multiple_persons(self):
        """Two persons crossing simultaneously both counted."""
        counter = self._make_counter()
        counter.update([
            make_detection(1, 100, 100, 200, 300),
            make_detection(2, 400, 100, 500, 300),
        ])
        events = counter.update([
            make_detection(1, 400, 100, 500, 300),  # crosses in
            make_detection(2, 100, 100, 200, 300),  # crosses out
        ])
        directions = {e.track_id: e.direction for e in events}
        assert directions[1] == "in"
        assert directions[2] == "out"

    def test_reset_daily(self):
        counter = self._make_counter()
        counter.update([make_detection(1, 100, 100, 200, 300)])
        counter.update([make_detection(1, 400, 100, 500, 300)])
        assert counter.count_in == 1
        counter.reset_daily()
        assert counter.count_in == 0
        assert counter.count_out == 0
