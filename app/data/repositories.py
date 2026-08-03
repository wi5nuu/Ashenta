"""Repository layer — PostgreSQL native UPSERT, optimised queries."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.data.models import (
    User, RefreshToken, Camera, CrossingEvent, HourlyAggregate,
    AlertRule, CameraStatus, CrossingDirection
)
import json


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# User repository
# ---------------------------------------------------------------------------

class UserRepository:
    def __init__(self, db: Session):
        self._db = db

    def get_by_id(self, user_id: int) -> Optional[User]:
        return self._db.get(User, user_id)

    def get_by_username(self, username: str) -> Optional[User]:
        return self._db.query(User).filter(User.username == username).first()

    def get_by_email(self, email: str) -> Optional[User]:
        return self._db.query(User).filter(User.email == email).first()

    def create(self, username: str, email: str, hashed_password: str,
               role: str = "viewer") -> User:
        user = User(username=username, email=email,
                    hashed_password=hashed_password, role=role)
        self._db.add(user)
        self._db.commit()
        self._db.refresh(user)
        return user

    def list_all(self) -> List[User]:
        return self._db.query(User).all()

    def delete(self, user_id: int) -> bool:
        user = self.get_by_id(user_id)
        if not user:
            return False
        self._db.delete(user)
        self._db.commit()
        return True

    def update_active(self, user_id: int, is_active: bool) -> Optional[User]:
        self._db.execute(
            update(User).where(User.id == user_id).values(is_active=is_active)
        )
        self._db.commit()
        return self.get_by_id(user_id)


# ---------------------------------------------------------------------------
# RefreshToken repository
# ---------------------------------------------------------------------------

class RefreshTokenRepository:
    def __init__(self, db: Session):
        self._db = db

    def create(self, user_id: int, token_hash: str,
               expires_at: datetime) -> RefreshToken:
        rt = RefreshToken(user_id=user_id, token_hash=token_hash,
                          expires_at=expires_at)
        self._db.add(rt)
        self._db.commit()
        self._db.refresh(rt)
        return rt

    def get_by_hash(self, token_hash: str) -> Optional[RefreshToken]:
        return (
            self._db.query(RefreshToken)
            .filter(RefreshToken.token_hash == token_hash,
                    RefreshToken.revoked == False)
            .first()
        )

    def revoke(self, token_hash: str) -> None:
        self._db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == token_hash)
            .values(revoked=True)
        )
        self._db.commit()

    def revoke_all_for_user(self, user_id: int) -> None:
        self._db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id)
            .values(revoked=True)
        )
        self._db.commit()


# ---------------------------------------------------------------------------
# Camera repository
# ---------------------------------------------------------------------------

class CameraRepository:
    def __init__(self, db: Session):
        self._db = db

    def get_by_id(self, camera_id: int) -> Optional[Camera]:
        return self._db.get(Camera, camera_id)

    def list_active(self) -> List[Camera]:
        return self._db.query(Camera).filter(Camera.is_active == True).all()

    def list_all(self) -> List[Camera]:
        return self._db.query(Camera).all()

    def create(self, name: str, url_encrypted: str,
               location_label: Optional[str] = None) -> Camera:
        cam = Camera(name=name, url_encrypted=url_encrypted,
                     location_label=location_label)
        self._db.add(cam)
        self._db.commit()
        self._db.refresh(cam)
        return cam

    def update_status(self, camera_id: int, status: CameraStatus) -> None:
        """Single UPDATE — no SELECT round-trip."""
        self._db.execute(
            update(Camera)
            .where(Camera.id == camera_id)
            .values(status=status, updated_at=_utcnow())
        )
        self._db.commit()

    def update_line_config(self, camera_id: int,
                           line_config: dict) -> Optional[Camera]:
        self._db.execute(
            update(Camera)
            .where(Camera.id == camera_id)
            .values(line_config=json.dumps(line_config), updated_at=_utcnow())
        )
        self._db.commit()
        return self.get_by_id(camera_id)

    def update_fields(self, camera_id: int, **kwargs) -> Optional[Camera]:
        if not kwargs:
            return self.get_by_id(camera_id)
        kwargs["updated_at"] = _utcnow()
        self._db.execute(
            update(Camera).where(Camera.id == camera_id).values(**kwargs)
        )
        self._db.commit()
        return self.get_by_id(camera_id)

    def delete(self, camera_id: int) -> bool:
        cam = self.get_by_id(camera_id)
        if cam:
            self._db.delete(cam)
            self._db.commit()
            return True
        return False


# ---------------------------------------------------------------------------
# CrossingEvent repository
# ---------------------------------------------------------------------------

class CrossingEventRepository:
    def __init__(self, db: Session):
        self._db = db

    def record(self, camera_id: int, direction: CrossingDirection,
               track_id: Optional[int] = None) -> CrossingEvent:
        event = CrossingEvent(
            camera_id=camera_id,
            direction=direction,
            track_id=track_id,
            timestamp=_utcnow(),
        )
        self._db.add(event)
        self._db.commit()
        self._db.refresh(event)
        return event

    def count_for_day(self, camera_id: int, date: datetime) -> dict:
        day_start = date.replace(hour=0, minute=0, second=0, microsecond=0,
                                 tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        rows = (
            self._db.query(
                CrossingEvent.direction,
                func.count(CrossingEvent.id).label("cnt"),
            )
            .filter(
                CrossingEvent.camera_id == camera_id,
                CrossingEvent.timestamp >= day_start,
                CrossingEvent.timestamp < day_end,
            )
            .group_by(CrossingEvent.direction)
            .all()
        )
        result = {"in": 0, "out": 0}
        for row in rows:
            key = row.direction.value if hasattr(row.direction, "value") else row.direction
            result[key] = row.cnt
        return result

    def get_range(self, camera_id: Optional[int],
                  start: datetime, end: datetime) -> List[CrossingEvent]:
        q = self._db.query(CrossingEvent).filter(
            CrossingEvent.timestamp >= start,
            CrossingEvent.timestamp < end,
        )
        if camera_id is not None:
            q = q.filter(CrossingEvent.camera_id == camera_id)
        return q.order_by(CrossingEvent.timestamp).all()


# ---------------------------------------------------------------------------
# HourlyAggregate repository — PostgreSQL native UPSERT
# ---------------------------------------------------------------------------

class HourlyAggregateRepository:
    def __init__(self, db: Session):
        self._db = db

    def upsert(self, camera_id: int, hour_start: datetime,
               entries: int, exits: int) -> None:
        """
        PostgreSQL INSERT … ON CONFLICT DO UPDATE — single round-trip,
        no SELECT + conditional INSERT.
        Falls back to ORM upsert for SQLite (used in tests).
        """
        dialect = self._db.bind.dialect.name if self._db.bind else "postgresql"

        if dialect == "postgresql":
            stmt = pg_insert(HourlyAggregate).values(
                camera_id=camera_id,
                hour_start=hour_start,
                entries=entries,
                exits=exits,
            ).on_conflict_do_update(
                constraint="uq_hourly_camera_hour",
                set_={"entries": entries, "exits": exits},
            )
            self._db.execute(stmt)
            self._db.commit()
        else:
            # SQLite fallback (tests)
            existing = (
                self._db.query(HourlyAggregate)
                .filter(
                    HourlyAggregate.camera_id == camera_id,
                    HourlyAggregate.hour_start == hour_start,
                )
                .first()
            )
            if existing:
                existing.entries = entries
                existing.exits = exits
            else:
                self._db.add(HourlyAggregate(
                    camera_id=camera_id, hour_start=hour_start,
                    entries=entries, exits=exits,
                ))
            self._db.commit()

    def get_range(self, camera_id: Optional[int],
                  start: datetime, end: datetime) -> List[HourlyAggregate]:
        q = self._db.query(HourlyAggregate).filter(
            HourlyAggregate.hour_start >= start,
            HourlyAggregate.hour_start < end,
        )
        if camera_id is not None:
            q = q.filter(HourlyAggregate.camera_id == camera_id)
        return q.order_by(HourlyAggregate.hour_start).all()


# ---------------------------------------------------------------------------
# AlertRule repository
# ---------------------------------------------------------------------------

class AlertRuleRepository:
    def __init__(self, db: Session):
        self._db = db

    def list_active(self) -> List[AlertRule]:
        return (
            self._db.query(AlertRule)
            .filter(AlertRule.is_active == True)
            .all()
        )

    def get_by_id(self, rule_id: int) -> Optional[AlertRule]:
        return self._db.get(AlertRule, rule_id)

    def create(self, name: str, condition: str, threshold: Optional[float],
               camera_id: Optional[int] = None,
               cooldown_minutes: int = 30) -> AlertRule:
        rule = AlertRule(
            name=name, camera_id=camera_id, condition=condition,
            threshold=threshold, cooldown_minutes=cooldown_minutes,
        )
        self._db.add(rule)
        self._db.commit()
        self._db.refresh(rule)
        return rule

    def touch_triggered(self, rule_id: int) -> None:
        self._db.execute(
            update(AlertRule)
            .where(AlertRule.id == rule_id)
            .values(last_triggered_at=_utcnow())
        )
        self._db.commit()

    def delete(self, rule_id: int) -> bool:
        rule = self.get_by_id(rule_id)
        if rule:
            self._db.delete(rule)
            self._db.commit()
            return True
        return False
