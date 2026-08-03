"""Trend forecaster using Holt-Winters exponential smoothing."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.data.repositories import HourlyAggregateRepository
from app.config.logging import get_logger

logger = get_logger(__name__)

_MIN_DAYS_FOR_FORECAST = 21


class TrendForecaster:
    """
    Aggregates daily totals from HourlyAggregate, then applies
    Holt-Winters additive seasonal smoothing (period=7 days).

    Returns honest messaging when data is insufficient (<21 days).
    """

    def __init__(self, db: Session):
        self._repo = HourlyAggregateRepository(db)

    def forecast(
        self,
        camera_id: Optional[int] = None,
        days_ahead: int = 14,
        history_days: int = 90,
    ) -> Dict:
        end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        start = end - timedelta(days=history_days)

        rows = self._repo.get_range(camera_id=camera_id, start=start, end=end)

        # Aggregate to daily totals
        daily: Dict[datetime, int] = {}
        for row in rows:
            day = row.hour_start.replace(hour=0, minute=0, second=0, microsecond=0)
            daily[day] = daily.get(day, 0) + row.entries

        # Fill gaps with 0 to get a contiguous series
        series_dates = [start + timedelta(days=i) for i in range(history_days)]
        series_values = [float(daily.get(d, 0)) for d in series_dates]

        n_days = sum(1 for v in series_values if v > 0)

        if n_days < _MIN_DAYS_FOR_FORECAST:
            return {
                "status": "insufficient_data",
                "message": (
                    f"Perlu minimal {_MIN_DAYS_FOR_FORECAST} hari data untuk prediksi. "
                    f"Saat ini hanya tersedia {n_days} hari dengan data."
                ),
                "days_with_data": n_days,
                "forecast": [],
            }

        try:
            forecast_values, lower, upper = self._holt_winters(
                series_values, period=7, days_ahead=days_ahead
            )
        except Exception as exc:
            logger.warning("Holt-Winters failed, falling back to naive", error=str(exc))
            mean = float(np.mean([v for v in series_values[-14:] if v > 0] or [0]))
            forecast_values = [mean] * days_ahead
            lower = [max(0, mean * 0.8)] * days_ahead
            upper = [mean * 1.2] * days_ahead

        result_points = []
        for i in range(days_ahead):
            day = end + timedelta(days=i + 1)
            result_points.append({
                "date": day.strftime("%Y-%m-%d"),
                "predicted": max(0, round(forecast_values[i], 1)),
                "lower_ci": max(0, round(lower[i], 1)),
                "upper_ci": max(0, round(upper[i], 1)),
            })

        return {
            "status": "ok",
            "message": None,
            "days_with_data": n_days,
            "history_days": history_days,
            "forecast": result_points,
        }

    @staticmethod
    def _holt_winters(
        series: List[float],
        period: int,
        days_ahead: int,
        alpha: float = 0.3,
        beta: float = 0.1,
        gamma: float = 0.2,
    ):
        """Additive Holt-Winters implementation."""
        n = len(series)
        if n < 2 * period:
            raise ValueError("Series too short for Holt-Winters")

        # Initialise level, trend, and seasonal components
        level = np.mean(series[:period])
        trend = (np.mean(series[period: 2 * period]) - np.mean(series[:period])) / period
        seasonal = [series[i] - level for i in range(period)]

        levels = [level]
        trends = [trend]
        seasonals = list(seasonal)
        fitted = []

        for t in range(n):
            s_idx = t % period
            prev_level = levels[-1]
            prev_trend = trends[-1]
            prev_season = seasonals[s_idx]

            new_level = alpha * (series[t] - prev_season) + (1 - alpha) * (prev_level + prev_trend)
            new_trend = beta * (new_level - prev_level) + (1 - beta) * prev_trend
            new_season = gamma * (series[t] - new_level) + (1 - gamma) * prev_season

            levels.append(new_level)
            trends.append(new_trend)
            seasonals[s_idx] = new_season
            fitted.append(new_level + new_season)

        # Forecast
        forecast = []
        residuals = [abs(series[i] - fitted[i]) for i in range(n)]
        std_res = float(np.std(residuals)) if residuals else 0.0

        for h in range(1, days_ahead + 1):
            s_idx = (n + h - 1) % period
            f = levels[-1] + h * trends[-1] + seasonals[s_idx]
            forecast.append(f)

        lower = [f - 1.96 * std_res for f in forecast]
        upper = [f + 1.96 * std_res for f in forecast]

        return forecast, lower, upper
