"""Peak hour analyzer: heatmap of average visitors by hour x weekday."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.data.repositories import HourlyAggregateRepository, CrossingEventRepository
from app.config.logging import get_logger

logger = get_logger(__name__)

# weekday index: 0=Monday ... 6=Sunday
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class PeakHourAnalyzer:
    """
    Builds a 7Ã-24 heatmap matrix from HourlyAggregate data.
    Cell value = average entries for that (weekday, hour) slot across all weeks.
    """

    def __init__(self, db: Session):
        self._repo = HourlyAggregateRepository(db)

    def heatmap(
        self,
        camera_id: Optional[int] = None,
        weeks_back: int = 12,
    ) -> Dict:
        """
        Returns:
          {
            "matrix": [[avg_entries, ...] * 24 hours] * 7 weekdays,
            "weekdays": [...],
            "hours": [0..23],
            "peak": {"weekday": str, "hour": int, "avg": float},
          }
        """
        end = datetime.now(timezone.utc)
        start = end - timedelta(weeks=weeks_back)

        rows = self._repo.get_range(camera_id=camera_id, start=start, end=end)

        # accumulate sum and count per (weekday, hour)
        sums: Dict[Tuple[int, int], float] = {}
        counts: Dict[Tuple[int, int], int] = {}

        for row in rows:
            key = (row.hour_start.weekday(), row.hour_start.hour)
            sums[key] = sums.get(key, 0.0) + row.entries
            counts[key] = counts.get(key, 0) + 1

        # build 7Ã-24 matrix
        matrix = []
        peak_val = 0.0
        peak_wd = 0
        peak_hr = 0

        for wd in range(7):
            row_data = []
            for hr in range(24):
                key = (wd, hr)
                avg = (sums[key] / counts[key]) if counts.get(key, 0) > 0 else 0.0
                avg = round(avg, 2)
                row_data.append(avg)
                if avg > peak_val:
                    peak_val = avg
                    peak_wd = wd
                    peak_hr = hr
            matrix.append(row_data)

        return {
            "matrix": matrix,
            "weekdays": WEEKDAY_NAMES,
            "hours": list(range(24)),
            "peak": {
                "weekday": WEEKDAY_NAMES[peak_wd],
                "hour": peak_hr,
                "avg": peak_val,
            },
            "data_range": {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "weeks_back": weeks_back,
            },
        }
