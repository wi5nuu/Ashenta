"""Analytics router — DB-level aggregation, no Python loops for counting."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.data.database import get_db
from app.data.models import CrossingEvent, CrossingDirection, HourlyAggregate
from app.data.repositories import CrossingEventRepository, HourlyAggregateRepository
from app.services.peak_hour_analyzer import PeakHourAnalyzer
from app.services.trend_forecaster import TrendForecaster
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _parse_date(date_str: Optional[str]) -> datetime:
    if date_str:
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    return datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


@router.get("/daily")
def daily_counts(
    camera_id: Optional[int] = Query(None),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, default today"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Entry/exit counts for a given day — single aggregation query."""
    day = _parse_date(date)
    day_end = day + timedelta(days=1)

    q = (
        db.query(
            CrossingEvent.direction,
            func.count(CrossingEvent.id).label("cnt"),
        )
        .filter(
            CrossingEvent.timestamp >= day,
            CrossingEvent.timestamp < day_end,
        )
    )
    if camera_id is not None:
        q = q.filter(CrossingEvent.camera_id == camera_id)
    q = q.group_by(CrossingEvent.direction)

    entries = exits = 0
    for row in q.all():
        key = row.direction.value if hasattr(row.direction, "value") else row.direction
        if key == "in":
            entries = row.cnt
        else:
            exits = row.cnt

    return {
        "date": day.strftime("%Y-%m-%d"),
        "camera_id": camera_id,
        "entries": entries,
        "exits": exits,
        "net": entries - exits,
    }


@router.get("/trend")
def trend(
    camera_id: Optional[int] = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Daily entry totals — aggregated in DB, not Python."""
    end = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    start = end - timedelta(days=days)

    # Sum entries per day using DB-level date_trunc
    q = (
        db.query(
            func.date_trunc("day", HourlyAggregate.hour_start).label("day"),
            func.sum(HourlyAggregate.entries).label("total"),
        )
        .filter(
            HourlyAggregate.hour_start >= start,
            HourlyAggregate.hour_start < end,
        )
    )
    if camera_id is not None:
        q = q.filter(HourlyAggregate.camera_id == camera_id)
    q = q.group_by("day").order_by("day")

    daily_map = {}
    for row in q.all():
        key = row.day.strftime("%Y-%m-%d") if hasattr(row.day, "strftime") else str(row.day)[:10]
        daily_map[key] = int(row.total or 0)

    result = []
    for i in range(days):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        result.append({"date": d, "entries": daily_map.get(d, 0)})

    return {"camera_id": camera_id, "days": days, "data": result}


@router.get("/heatmap")
def heatmap(
    camera_id: Optional[int] = Query(None),
    weeks_back: int = Query(12, ge=1, le=52),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """7×24 heatmap of average entries by weekday × hour."""
    return PeakHourAnalyzer(db).heatmap(
        camera_id=camera_id, weeks_back=weeks_back
    )


@router.get("/forecast")
def forecast(
    camera_id: Optional[int] = Query(None),
    days_ahead: int = Query(14, ge=1, le=90),
    history_days: int = Query(90, ge=30, le=365),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Holt-Winters trend forecast with confidence intervals."""
    return TrendForecaster(db).forecast(
        camera_id=camera_id,
        days_ahead=days_ahead,
        history_days=history_days,
    )


@router.get("/hourly")
def hourly_counts(
    camera_id: Optional[int] = Query(None),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, default today"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Per-hour entry/exit counts for a given day."""
    day = _parse_date(date)
    day_end = day + timedelta(days=1)

    q = (
        db.query(
            func.strftime("%H", CrossingEvent.timestamp).label("hour"),
            CrossingEvent.direction,
            func.count(CrossingEvent.id).label("cnt"),
        )
        .filter(
            CrossingEvent.timestamp >= day,
            CrossingEvent.timestamp < day_end,
        )
    )
    if camera_id is not None:
        q = q.filter(CrossingEvent.camera_id == camera_id)
    q = q.group_by("hour", CrossingEvent.direction)

    # Build hour map
    hour_map: dict = {h: {"entries": 0, "exits": 0} for h in range(24)}
    for row in q.all():
        h = int(row.hour) if row.hour is not None else 0
        key = row.direction.value if hasattr(row.direction, "value") else row.direction
        if key == "in":
            hour_map[h]["entries"] = row.cnt
        else:
            hour_map[h]["exits"] = row.cnt

    result = [
        {
            "hour": h,
            "entries": hour_map[h]["entries"],
            "exits": hour_map[h]["exits"],
            "net": hour_map[h]["entries"] - hour_map[h]["exits"],
        }
        for h in range(24)
    ]
    return {"date": day.strftime("%Y-%m-%d"), "camera_id": camera_id, "data": result}


@router.get("/predictive")
def predictive(
    camera_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Predict next 24-hour traffic based on historical hourly averages."""
    # Use last 30 days of hourly aggregates to compute average per hour-of-day
    from datetime import datetime, timezone, timedelta as td
    now = datetime.now(timezone.utc)
    start = now - td(days=30)

    # Use func.extract for PostgreSQL, func.strftime for SQLite
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        hour_expr = func.extract("hour", HourlyAggregate.hour_start).label("hour")
    else:
        hour_expr = func.strftime("%H", HourlyAggregate.hour_start).label("hour")

    q = (
        db.query(
            hour_expr,
            func.avg(HourlyAggregate.entries).label("avg_entries"),
            func.avg(HourlyAggregate.exits).label("avg_exits"),
        )
        .filter(HourlyAggregate.hour_start >= start)
    )
    if camera_id is not None:
        q = q.filter(HourlyAggregate.camera_id == camera_id)
    q = q.group_by(hour_expr).order_by(hour_expr)

    rows = q.all()
    if not rows:
        return []

    result = [
        {
            "hour": int(row.hour),
            "predicted_entries": round(float(row.avg_entries or 0), 1),
            "predicted_exits": round(float(row.avg_exits or 0), 1),
        }
        for row in rows
    ]
    return result
