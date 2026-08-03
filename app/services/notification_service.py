"""Telegram notification service + alert rule evaluator."""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.config.settings import get_settings
from app.config.logging import get_logger
from app.data.database import SessionLocal
from app.data.repositories import AlertRuleRepository
from app.data.models import AlertCondition
from app.core.events import CounterUpdateEvent, CameraStatusEvent

logger = get_logger(__name__)
_settings = get_settings()

_TELEGRAM_API = "https://api.telegram.org"


async def _send_telegram(message: str) -> None:
    token = _settings.telegram_bot_token
    chat_id = _settings.telegram_chat_id
    if not token or not chat_id:
        logger.debug("Telegram not configured, skipping notification")
        return
    url = f"{_TELEGRAM_API}/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            logger.info("Telegram notification sent")
    except Exception as exc:
        logger.error("Telegram send failed", error=str(exc))


class NotificationService:
    """
    Listens on EventBus topics and evaluates AlertRules.
    Sends Telegram messages when a rule fires (respects cooldown).
    """

    def __init__(self):
        self._bus = None  # set in register()

    def register(self, event_bus) -> None:
        self._bus = event_bus
        event_bus.subscribe("counter_update", self._on_counter_update)
        event_bus.subscribe("camera_status", self._on_camera_status)

    async def _on_counter_update(self, event: CounterUpdateEvent) -> None:
        with SessionLocal() as db:
            rules = AlertRuleRepository(db).list_active()
            for rule in rules:
                if rule.condition not in (
                    AlertCondition.visitor_count_above,
                    AlertCondition.visitor_count_below,
                ):
                    continue
                if rule.camera_id and rule.camera_id != event.camera_id:
                    continue
                if self._is_cooling(rule):
                    continue

                triggered = False
                net = event.net

                if rule.condition == AlertCondition.visitor_count_above:
                    triggered = rule.threshold is not None and net > rule.threshold
                elif rule.condition == AlertCondition.visitor_count_below:
                    triggered = rule.threshold is not None and net < rule.threshold

                if triggered:
                    msg = (
                        f"*Ashenta Alert* – {rule.name}\n"
                        f"Kamera: {event.camera_name}\n"
                        f"Net pengunjung saat ini: {net}\n"
                        f"Kondisi: {rule.condition.value} {rule.threshold}\n"
                        f"Waktu: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
                    )
                    await _send_telegram(msg)
                    AlertRuleRepository(db).touch_triggered(rule.id)

    async def _on_camera_status(self, event: CameraStatusEvent) -> None:
        if event.status != "error":
            return
        with SessionLocal() as db:
            rules = AlertRuleRepository(db).list_active()
            for rule in rules:
                if rule.condition != AlertCondition.camera_offline:
                    continue
                if rule.camera_id and rule.camera_id != event.camera_id:
                    continue
                if self._is_cooling(rule):
                    continue

                msg = (
                    f"*Ashenta Alert* – {rule.name}\n"
                    f"Kamera ID {event.camera_id} *OFFLINE/ERROR*\n"
                    f"Waktu: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
                )
                await _send_telegram(msg)
                AlertRuleRepository(db).touch_triggered(rule.id)

    @staticmethod
    def _is_cooling(rule) -> bool:
        if rule.last_triggered_at is None:
            return False
        last = rule.last_triggered_at; elapsed = datetime.now(timezone.utc) - (last if last.tzinfo else last.replace(tzinfo=timezone.utc))
        return elapsed < timedelta(minutes=rule.cooldown_minutes)
