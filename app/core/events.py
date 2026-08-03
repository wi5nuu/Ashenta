"""In-process async event bus using asyncio.Queue."""
from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, List
import weakref

from app.config.logging import get_logger

logger = get_logger(__name__)


@dataclass
class CounterUpdateEvent:
    camera_id: int
    camera_name: str
    count_in: int
    count_out: int
    net: int


@dataclass
class CameraStatusEvent:
    camera_id: int
    status: str  # "active" | "inactive" | "error"


class EventBus:
    """
    Simple asyncio pub/sub.

    Usage:
        bus = EventBus()
        unsub = bus.subscribe("counter_update", my_async_handler)
        await bus.publish("counter_update", CounterUpdateEvent(...))
        unsub()  # removes subscriber
    """

    def __init__(self) -> None:
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, topic: str, handler: Callable[..., Coroutine]) -> Callable:
        self._subscribers.setdefault(topic, []).append(handler)

        def _unsub():
            try:
                self._subscribers[topic].remove(handler)
            except (KeyError, ValueError):
                pass

        return _unsub

    async def publish(self, topic: str, event: Any) -> None:
        handlers = list(self._subscribers.get(topic, []))
        for handler in handlers:
            try:
                await handler(event)
            except Exception:
                logger.exception("EventBus handler error", topic=topic)


# Singleton used by the application
_event_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
