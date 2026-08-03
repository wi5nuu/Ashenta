"""APScheduler-based background jobs."""
from __future__ import annotations
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.data.database import SessionLocal
from app.data.repositories import CrossingEventRepository, HourlyAggregateRepository, CameraRepository
from app.config.logging import get_logger

logger = get_logger(__name__)


async def aggregate_hourly() -> None:
    """
    Run at start of each hour (+ 2 min buffer).
    Aggregates the previous hour's CrossingEvents into HourlyAggregate.
    """
    now = datetime.utcnow()
    prev_hour_start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
    prev_hour_end = prev_hour_start + timedelta(hours=1)

    logger.info("aggregate_hourly running", hour=prev_hour_start.isoformat())

    with SessionLocal() as db:
        cameras = CameraRepository(db).list_all()
        event_repo = CrossingEventRepository(db)
        agg_repo = HourlyAggregateRepository(db)

        for cam in cameras:
            events = event_repo.get_range(cam.id, prev_hour_start, prev_hour_end)
            entries = sum(1 for e in events if e.direction.value == "in")
            exits = sum(1 for e in events if e.direction.value == "out")
            agg_repo.upsert(cam.id, prev_hour_start, entries, exits)

    logger.info("aggregate_hourly done", hour=prev_hour_start.isoformat())


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    # Aggregate the previous hour, runs at :02 of every hour
    scheduler.add_job(
        aggregate_hourly,
        trigger=CronTrigger(minute=2),
        id="aggregate_hourly",
        replace_existing=True,
        misfire_grace_time=120,
    )

    return scheduler
