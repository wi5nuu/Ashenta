"""Cameras router - full CRUD, source_type support, stream token, live counter."""
from __future__ import annotations
from typing import List, Optional
import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.data.database import get_db
from app.data.repositories import CameraRepository
from app.security import encrypt_credential, create_stream_token
from app.security.dependencies import get_current_user, require_admin
from app.core.camera_manager import get_camera_manager


def _write_file(path: str, data: bytes) -> None:
    """Synchronous file write - run via asyncio.to_thread to avoid blocking the event loop."""
    with open(path, "wb") as fh:
        fh.write(data)


router = APIRouter(prefix="/cameras", tags=["cameras"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CameraCreate(BaseModel):
    name: str
    location_label: Optional[str] = None
    source_type: str = "rtsp"          # rtsp | http | webcam | video | youtube
    rtsp_url: Optional[str] = None     # used for rtsp / http / youtube
    webcam_index: Optional[int] = None # used for webcam


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location_label: Optional[str] = None
    source_type: Optional[str] = None
    rtsp_url: Optional[str] = None
    webcam_index: Optional[int] = None
    is_active: Optional[bool] = None


class LineItem(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    label: Optional[str] = None


class LineConfigRequest(BaseModel):
    lines: List[LineItem]


class CameraOut(BaseModel):
    id: int
    name: str
    location_label: Optional[str]
    status: str
    is_active: bool
    line_config: Optional[str]
    source_type: Optional[str] = "rtsp"

    class Config:
        from_attributes = True


def _cam_out(c) -> CameraOut:
    return CameraOut(
        id=c.id, name=c.name, location_label=c.location_label,
        status=c.status.value if hasattr(c.status, "value") else c.status,
        is_active=c.is_active, line_config=c.line_config,
        source_type=getattr(c, "source_type", "rtsp") or "rtsp",
    )


def _build_url(body_source_type: str, rtsp_url: Optional[str], webcam_index: Optional[int]) -> str:
    """Build the URL string to encrypt and store."""
    if body_source_type == "webcam":
        return str(webcam_index or 0)
    return rtsp_url or ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[CameraOut])
@router.get("/", response_model=List[CameraOut], include_in_schema=False)
def list_cameras(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [_cam_out(c) for c in CameraRepository(db).list_all()]


@router.post("", status_code=201, response_model=CameraOut)
@router.post("/", status_code=201, response_model=CameraOut, include_in_schema=False)
def create_camera(
    body: CameraCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    url = _build_url(body.source_type, body.rtsp_url, body.webcam_index)
    url_enc = encrypt_credential(url)
    repo = CameraRepository(db)
    cam = repo.create(
        name=body.name,
        url_encrypted=url_enc,
        location_label=body.location_label,
    )
    # Persist source_type if model supports it
    if hasattr(cam, "source_type"):
        cam.source_type = body.source_type
        db.commit()
        db.refresh(cam)
    return _cam_out(cam)


@router.get("/{camera_id}", response_model=CameraOut)
def get_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _cam_out(cam)


@router.put("/{camera_id}", response_model=CameraOut)
@router.patch("/{camera_id}", response_model=CameraOut)
def update_camera(
    camera_id: int,
    body: CameraUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.location_label is not None:
        updates["location_label"] = body.location_label
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.source_type is not None:
        updates["source_type"] = body.source_type
    if body.rtsp_url is not None or body.webcam_index is not None or body.source_type is not None:
        src = body.source_type or "rtsp"
        url = _build_url(src, body.rtsp_url, body.webcam_index)
        if url:
            updates["url_encrypted"] = encrypt_credential(url)

    cam = CameraRepository(db).update_fields(camera_id, **updates)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _cam_out(cam)


@router.delete("/{camera_id}", status_code=204)
def delete_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    get_camera_manager().stop_camera(camera_id)
    if not CameraRepository(db).delete(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")


@router.post("/{camera_id}/toggle", status_code=200)
def toggle_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Toggle camera active/inactive."""
    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    new_active = not cam.is_active
    CameraRepository(db).update_fields(camera_id, is_active=new_active)
    if new_active:
        get_camera_manager().start_camera(camera_id)
    else:
        get_camera_manager().stop_camera(camera_id)
    return {"detail": "toggled", "is_active": new_active}


@router.put("/{camera_id}/line", response_model=CameraOut)
def set_line_config(
    camera_id: int,
    body: LineConfigRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    # Store as array of line objects (multi-line support)
    lines_list = [
        {k: v for k, v in line.model_dump().items() if v is not None}
        for line in body.lines
    ]
    cam = CameraRepository(db).update_line_config(camera_id, lines_list)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    get_camera_manager().reload_line(camera_id, json.dumps(lines_list))
    return _cam_out(cam)


@router.post("/{camera_id}/start", status_code=200)
def start_camera(camera_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    # Mark active in DB first so the manager's is_active check passes
    if not cam.is_active:
        CameraRepository(db).update_fields(camera_id, is_active=True)
    if not get_camera_manager().start_camera(camera_id):
        raise HTTPException(status_code=500, detail="Failed to start camera worker")
    return {"detail": "started"}


@router.post("/{camera_id}/stop", status_code=200)
def stop_camera(camera_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    get_camera_manager().stop_camera(camera_id)
    # Mark inactive in DB so it doesn't auto-start on next server restart
    CameraRepository(db).update_fields(camera_id, is_active=False)
    return {"detail": "stopped"}


@router.post("/{camera_id}/stream-token")
@router.get("/{camera_id}/stream-token", include_in_schema=False)
def get_stream_token(
    camera_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if not CameraRepository(db).get_by_id(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")
    return {"stream_token": create_stream_token(camera_id)}


@router.get("/{camera_id}/counter")
def get_live_counter(
    camera_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    from datetime import datetime, timezone
    counter = get_camera_manager().get_live_counter(camera_id)
    if counter is None:
        from app.data.repositories import CrossingEventRepository
        day = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        counter = CrossingEventRepository(db).count_for_day(camera_id, day)
    return {"camera_id": camera_id, **counter}


@router.post("/{camera_id}/upload", status_code=200)
async def upload_video(
    camera_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Upload a video file and set it as the camera source."""
    cam = CameraRepository(db).get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    dest = os.path.join(upload_dir, f"cam_{camera_id}{ext}")

    # Read file bytes async, then write to disk in a thread to avoid blocking the event loop
    file_data = await file.read()
    await asyncio.to_thread(_write_file, dest, file_data)

    url_enc = encrypt_credential(os.path.abspath(dest))
    CameraRepository(db).update_fields(camera_id, url_encrypted=url_enc, source_type="video")
    return {"detail": "uploaded", "path": dest}