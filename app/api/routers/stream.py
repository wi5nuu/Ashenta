"""Stream router: MJPEG live video endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.data.database import get_db
from app.data.repositories import CameraRepository
from app.security import decode_stream_token
from app.core.frame_broker import get_frame_broker

router = APIRouter(prefix="/stream", tags=["stream"])


@router.get("/{camera_id}/mjpeg")
async def mjpeg_stream(
    camera_id: int,
    token: str = Query(..., description="Short-lived stream token from /cameras/{id}/stream-token"),
    db: Session = Depends(get_db),
):
    """
    MJPEG multipart stream of annotated video for the given camera.
    Auth: stream token (JWT) passed as query parameter ?token=...
    """
    validated_camera_id = decode_stream_token(token)
    if validated_camera_id is None or validated_camera_id != camera_id:
        raise HTTPException(status_code=401, detail="Invalid or expired stream token")

    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    broker = get_frame_broker()
    subscription = broker.subscribe(camera_id)

    async def generate():
        async with subscription as sub:
            async for chunk in sub.frames():
                yield chunk

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
