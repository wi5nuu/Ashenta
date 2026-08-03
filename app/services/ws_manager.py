"""WebSocket connection manager — production-grade with heartbeat and concurrent broadcast."""
from __future__ import annotations
import asyncio
import json
import time
from typing import Dict, Set, List

from fastapi import WebSocket
from app.config.logging import get_logger
from app.core.events import CounterUpdateEvent, CameraStatusEvent

logger = get_logger(__name__)

_HEARTBEAT_INTERVAL = 20   # seconds – matches most proxy idle timeouts
_HEARTBEAT_TIMEOUT  = 10   # seconds to wait for pong before dropping


class _Connection:
    """Wraps a WebSocket with last-pong tracking."""
    __slots__ = ("ws", "last_pong")

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.last_pong = time.monotonic()


class WebSocketManager:
    """
    Manages active WebSocket connections.

    Improvements over v1:
    - asyncio.gather for concurrent broadcast (no head-of-line blocking)
    - Dead connection cleanup without holding the lock during I/O
    - Periodic ping/pong heartbeat to kill half-open TCP connections
    - Separate subscription buckets: 0 = all cameras, N = specific camera
    """

    def __init__(self) -> None:
        self._connections: Dict[int, Set[_Connection]] = {}
        self._lock = asyncio.Lock()
        self._heartbeat_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------------
    # Connect / Disconnect
    # ------------------------------------------------------------------

    async def connect(self, ws: WebSocket, camera_id: int = 0) -> None:
        await ws.accept()
        conn = _Connection(ws)
        async with self._lock:
            self._connections.setdefault(camera_id, set()).add(conn)
        logger.info("WebSocket connected", camera_id=camera_id,
                    total=sum(len(s) for s in self._connections.values()))

    async def disconnect(self, ws: WebSocket, camera_id: int = 0) -> None:
        async with self._lock:
            bucket = self._connections.get(camera_id, set())
            to_remove = {c for c in bucket if c.ws is ws}
            bucket -= to_remove
        logger.info("WebSocket disconnected", camera_id=camera_id)

    # ------------------------------------------------------------------
    # Broadcast
    # ------------------------------------------------------------------

    async def broadcast_counter(self, event: CounterUpdateEvent) -> None:
        msg = json.dumps({
            "type": "counter_update",
            "camera_id": event.camera_id,
            "camera_name": event.camera_name,
            "count_in": event.count_in,
            "count_out": event.count_out,
            "net": event.net,
            "ts": time.time(),
        })
        await asyncio.gather(
            self._send_to_bucket(0, msg),
            self._send_to_bucket(event.camera_id, msg),
        )

    async def broadcast_camera_status(self, event: CameraStatusEvent) -> None:
        msg = json.dumps({
            "type": "camera_status",
            "camera_id": event.camera_id,
            "status": event.status,
            "ts": time.time(),
        })
        await asyncio.gather(
            self._send_to_bucket(0, msg),
            self._send_to_bucket(event.camera_id, msg),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _send_to_bucket(self, camera_id: int, msg: str) -> None:
        async with self._lock:
            conns = list(self._connections.get(camera_id, set()))

        if not conns:
            return

        results = await asyncio.gather(
            *[self._safe_send(c, msg) for c in conns],
            return_exceptions=True,
        )

        dead: List[_Connection] = []
        for conn, result in zip(conns, results):
            if isinstance(result, Exception):
                dead.append(conn)

        if dead:
            async with self._lock:
                bucket = self._connections.get(camera_id, set())
                bucket -= set(dead)

    @staticmethod
    async def _safe_send(conn: _Connection, msg: str) -> None:
        await conn.ws.send_text(msg)

    # ------------------------------------------------------------------
    # Heartbeat (ping / pong)
    # ------------------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            now = time.monotonic()
            dead: list[tuple[int, _Connection]] = []

            async with self._lock:
                all_conns = [
                    (cam_id, conn)
                    for cam_id, bucket in self._connections.items()
                    for conn in list(bucket)
                ]

            for cam_id, conn in all_conns:
                # Drop connections that never ponged within the timeout window
                if now - conn.last_pong > _HEARTBEAT_INTERVAL + _HEARTBEAT_TIMEOUT:
                    dead.append((cam_id, conn))
                    continue
                try:
                    await conn.ws.send_text(json.dumps({"type": "ping", "ts": now}))
                except Exception:
                    dead.append((cam_id, conn))

            if dead:
                async with self._lock:
                    for cam_id, conn in dead:
                        self._connections.get(cam_id, set()).discard(conn)
                logger.info("Heartbeat pruned dead connections", count=len(dead))

    def handle_pong(self, ws: WebSocket) -> None:
        """Call this when a 'pong' message is received from a client."""
        now = time.monotonic()
        for bucket in self._connections.values():
            for conn in bucket:
                if conn.ws is ws:
                    conn.last_pong = now
                    return


_ws_manager: WebSocketManager | None = None


def get_ws_manager() -> WebSocketManager:
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = WebSocketManager()
    return _ws_manager
