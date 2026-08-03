"""Auth router: login, refresh, logout."""
from __future__ import annotations
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.data.database import get_db
from app.data.repositories import UserRepository, RefreshTokenRepository
from app.data.models import UserRole
from app.security import (
    verify_password, hash_password,
    create_access_token, create_refresh_token_string, hash_refresh_token,
)
from app.security.dependencies import get_current_user
from app.config.settings import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
_settings = get_settings()


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.viewer


@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    repo = UserRepository(db)
    user = repo.get_by_username(form.username)
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    access = create_access_token(user.id)
    raw_refresh = create_refresh_token_string()
    token_hash = hash_refresh_token(raw_refresh)
    expires_at = datetime.utcnow() + timedelta(days=_settings.jwt_refresh_token_expire_days)
    RefreshTokenRepository(db).create(user.id, token_hash, expires_at)

    return TokenResponse(access_token=access, refresh_token=raw_refresh)


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    rt_repo = RefreshTokenRepository(db)
    rt = rt_repo.get_by_hash(token_hash)

    if not rt or rt.revoked or rt.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    rt_repo.revoke(token_hash)  # rotate
    new_access = create_access_token(rt.user_id)
    new_raw_refresh = create_refresh_token_string()
    new_hash = hash_refresh_token(new_raw_refresh)
    new_expires = datetime.utcnow() + timedelta(days=_settings.jwt_refresh_token_expire_days)
    rt_repo.create(rt.user_id, new_hash, new_expires)

    return TokenResponse(access_token=new_access, refresh_token=new_raw_refresh)


@router.post("/logout", status_code=204)
def logout(body: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(body.refresh_token)
    RefreshTokenRepository(db).revoke(token_hash)


@router.post("/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
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
    return {"id": user.id, "username": user.username, "role": user.role}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
    }
