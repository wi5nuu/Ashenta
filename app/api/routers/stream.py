"""Stream router: MJPEG live video + JPEG snapshot endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
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
    Automatically closes when camera stops (10 s timeout per frame).
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


@router.get("/{camera_id}/snapshot")
async def snapshot(
    camera_id: int,
    token: str = Query(..., description="Short-lived stream token"),
    db: Session = Depends(get_db),
):
    """
    Single JPEG snapshot of the most recent annotated frame.
    Used by LineConfigModal to draw the virtual line on a still image.
    Returns 204 if camera has no frame yet.
    """
    validated_camera_id = decode_stream_token(token)
    if validated_camera_id is None or validated_camera_id != camera_id:
        raise HTTPException(status_code=401, detail="Invalid or expired stream token")

    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    broker = get_frame_broker()
    jpeg = broker.get_latest_jpeg(camera_id)
    if jpeg is None:
        raise HTTPException(
            status_code=404,
            detail="No frame available yet. Make sure the camera is active and processing.",
        )

    return Response(content=jpeg, media_type="image/jpeg")
