"""WebSocket router — production keepalive + graceful cleanup."""
from __future__ import annotations
import asyncio
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.services.ws_manager import get_ws_manager
from app.security import decode_access_token
from app.config.logging import get_logger

router = APIRouter(tags=["websocket"])
logger = get_logger(__name__)

_PONG_MSG = '{"type":"pong"}'


@router.websocket("/ws/counters")
async def ws_counters(
    websocket: WebSocket,
    camera_id: Optional[int] = Query(None),
    token: str = Query(...),
):
    """
    WebSocket for real-time counter + camera-status updates.
    - token: valid JWT access token (query param for browser compatibility)
    - camera_id: omit to subscribe to ALL cameras

    Protocol:
      Server → client: JSON counter_update / camera_status / ping
      Client → server: {"type":"pong"}  (keep-alive response)
    """
    user_id = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=4001, reason="Invalid token")
        return

    mgr = get_ws_manager()
    sub_id = camera_id if camera_id is not None else 0
    await mgr.connect(websocket, sub_id)

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60)
                # Handle pong so heartbeat can track connection liveness
                if '"pong"' in data or data == _PONG_MSG:
                    mgr.handle_pong(websocket)
            except asyncio.TimeoutError:
                # No message in 60s — connection is alive but silent; continue
                continue
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error", error=str(exc))
    finally:
        await mgr.disconnect(websocket, sub_id)
