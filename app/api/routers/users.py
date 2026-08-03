"""Users router — admin-only CRUD for user management."""
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.data.database import get_db
from app.data.repositories import UserRepository
from app.data.models import UserRole
from app.security import hash_password
from app.security.dependencies import require_admin

router = APIRouter(prefix="/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.viewer


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


def _out(u) -> UserOut:
    return UserOut(
        id=u.id, username=u.username, email=u.email,
        role=u.role.value if hasattr(u.role, "value") else u.role,
        is_active=u.is_active,
    )


@router.get("", response_model=List[UserOut])
@router.get("/", response_model=List[UserOut], include_in_schema=False)
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return [_out(u) for u in UserRepository(db).list_all()]


@router.post("", status_code=201, response_model=UserOut)
def create_user(body: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    repo = UserRepository(db)
    if repo.get_by_username(body.username):
        raise HTTPException(status_code=400, detail="Username already taken")
    if repo.get_by_email(body.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = repo.create(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    return _out(user)


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, body: UserUpdate,
    db: Session = Depends(get_db), _=Depends(require_admin),
):
    repo = UserRepository(db)
    user = repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.email is not None:
        user.email = body.email
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    db.commit()
    db.refresh(user)
    return _out(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db), _=Depends(require_admin),
):
    repo = UserRepository(db)
    if not repo.get_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    repo.delete(user_id)
