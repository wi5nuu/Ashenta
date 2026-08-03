"""Unit tests for TrendForecaster."""
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch


def _make_aggregate(camera_id, hour_start, entries, exits=0):
    agg = MagicMock()
    agg.camera_id = camera_id
    agg.hour_start = hour_start
    agg.entries = entries
    agg.exits = exits
    return agg


class TestTrendForecaster:
    def _make_db_with_rows(self, rows):
        db = MagicMock()
        return db, rows

    def test_insufficient_data_returns_message(self):
        from app.services.trend_forecaster import TrendForecaster
        db = MagicMock()
        # Only 5 days of data → < 21
        rows = []
        for d in range(5):
            day = datetime(2026, 1, 1) + timedelta(days=d)
            rows.append(_make_aggregate(1, day.replace(hour=10), 10))

        with patch("app.services.trend_forecaster.HourlyAggregateRepository") as MockRepo:
            MockRepo.return_value.get_range.return_value = rows
            fc = TrendForecaster(db)
            result = fc.forecast(camera_id=1, days_ahead=7, history_days=90)

        assert result["status"] == "insufficient_data"
        assert result["days_with_data"] == 5
        assert result["forecast"] == []
        assert "21" in result["message"]

    def test_sufficient_data_returns_forecast(self):
        from app.services.trend_forecaster import TrendForecaster
        db = MagicMock()
        rows = []
        for d in range(60):
            day = datetime(2026, 1, 1) + timedelta(days=d)
            for h in range(8, 20):
                rows.append(_make_aggregate(1, day.replace(hour=h), 5))

        with patch("app.services.trend_forecaster.HourlyAggregateRepository") as MockRepo:
            MockRepo.return_value.get_range.return_value = rows
            fc = TrendForecaster(db)
            result = fc.forecast(camera_id=1, days_ahead=7, history_days=90)

        assert result["status"] == "ok"
        assert len(result["forecast"]) == 7
        for point in result["forecast"]:
            assert "date" in point
            assert "predicted" in point
            assert "lower_ci" in point
            assert "upper_ci" in point
            assert point["predicted"] >= 0
            assert point["lower_ci"] <= point["upper_ci"]

    def test_holt_winters_basic(self):
        from app.services.trend_forecaster import TrendForecaster
        import math
        # Simple linear series with weekly seasonality
        series = [float(10 + (i % 7) * 2) for i in range(30)]
        forecast, lower, upper = TrendForecaster._holt_winters(series, period=7, days_ahead=7)
        assert len(forecast) == 7
        assert len(lower) == 7
        assert len(upper) == 7
        for f, lo, hi in zip(forecast, lower, upper):
            assert lo <= hi
