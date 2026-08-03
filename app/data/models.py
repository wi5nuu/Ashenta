"""Database models — timezone-aware datetimes, tuned indexes."""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, Enum as SAEnum, UniqueConstraint, Index
)
from sqlalchemy.orm import DeclarativeBase, relationship
import enum


def _utcnow() -> datetime:
    """timezone-aware UTC now — replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    admin = "admin"
    viewer = "viewer"


class CameraStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    error = "error"


class CameraSourceType(str, enum.Enum):
    rtsp = "rtsp"        # RTSP/HTTP stream URL
    file = "file"        # uploaded video file (loops)
    url  = "url"         # any URL OpenCV can open (http video, local file path)


class CrossingDirection(str, enum.Enum):
    in_ = "in"
    out = "out"


class AlertCondition(str, enum.Enum):
    visitor_count_above = "visitor_count_above"
    visitor_count_below = "visitor_count_below"
    camera_offline = "camera_offline"
    hourly_count_above = "hourly_count_above"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(256), unique=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.viewer)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    refresh_tokens = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(256), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user_revoked", "user_id", "revoked"),
    )


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    url_encrypted = Column(Text, nullable=False)
    location_label = Column(String(256), nullable=True)
    status = Column(SAEnum(CameraStatus), default=CameraStatus.inactive, nullable=False)
    line_config = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    crossing_events = relationship(
        "CrossingEvent", back_populates="camera", cascade="all, delete-orphan"
    )
    hourly_aggregates = relationship(
        "HourlyAggregate", back_populates="camera", cascade="all, delete-orphan"
    )


class CrossingEvent(Base):
    __tablename__ = "crossing_events"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    direction = Column(SAEnum(CrossingDirection), nullable=False)
    track_id = Column(Integer, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    camera = relationship("Camera", back_populates="crossing_events")

    __table_args__ = (
        # Covering index for time-range queries (analytics, aggregation jobs)
        Index("ix_crossing_events_camera_ts", "camera_id", "timestamp"),
        # Direction-specific count queries
        Index("ix_crossing_events_camera_dir_ts", "camera_id", "direction", "timestamp"),
    )


class HourlyAggregate(Base):
    __tablename__ = "hourly_aggregates"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    hour_start = Column(DateTime(timezone=True), nullable=False)
    entries = Column(Integer, default=0, nullable=False)
    exits = Column(Integer, default=0, nullable=False)

    camera = relationship("Camera", back_populates="hourly_aggregates")

    __table_args__ = (
        UniqueConstraint("camera_id", "hour_start", name="uq_hourly_camera_hour"),
        Index("ix_hourly_camera_hour", "camera_id", "hour_start"),
    )


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=True)
    condition = Column(SAEnum(AlertCondition), nullable=False)
    threshold = Column(Float, nullable=True)
    cooldown_minutes = Column(Integer, default=30, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        Index("ix_alert_rules_active", "is_active"),
    )
