"""Security utilities: JWT, password hashing, credential encryption, stream tokens."""
from __future__ import annotations
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet, InvalidToken

from app.config.settings import get_settings

_settings = get_settings()

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
_ACCESS_TOKEN_TYPE = "access"
_REFRESH_TOKEN_TYPE = "refresh"


def _create_token(subject: str, token_type: str, expires_delta: timedelta) -> str:
    expire = datetime.utcnow() + expires_delta
    payload = {
        "sub": subject,
        "type": token_type,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, _settings.jwt_secret_key, algorithm=_settings.jwt_algorithm)


def create_access_token(user_id: int) -> str:
    return _create_token(
        subject=str(user_id),
        token_type=_ACCESS_TOKEN_TYPE,
        expires_delta=timedelta(minutes=_settings.jwt_access_token_expire_minutes),
    )


def create_refresh_token_string() -> str:
    """Return a random opaque refresh token (stored hashed in DB)."""
    return secrets.token_urlsafe(48)


def decode_access_token(token: str) -> Optional[int]:
    """Return user_id from a valid access token, or None."""
    try:
        payload = jwt.decode(
            token, _settings.jwt_secret_key,
            algorithms=[_settings.jwt_algorithm]
        )
        if payload.get("type") != _ACCESS_TOKEN_TYPE:
            return None
        return int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        return None


def hash_refresh_token(raw: str) -> str:
    """SHA-256 hex digest used to store refresh token in DB."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Credential encryption (camera RTSP URLs)
# ---------------------------------------------------------------------------

def _get_fernet() -> Fernet:
    key = _settings.credential_encryption_key
    if not key:
        raise RuntimeError(
            "CREDENTIAL_ENCRYPTION_KEY not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_credential(plain_text: str) -> str:
    """Encrypt camera URL / credential for storage."""
    return _get_fernet().encrypt(plain_text.encode()).decode()


def decrypt_credential(cipher_text: str) -> str:
    """Decrypt stored credential. Raises ValueError on failure."""
    try:
        return _get_fernet().decrypt(cipher_text.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Failed to decrypt credential – wrong key or corrupted data") from exc


# ---------------------------------------------------------------------------
# Short-lived stream tokens (for MJPEG endpoint auth)
# ---------------------------------------------------------------------------
_STREAM_TOKEN_TYPE = "stream"


def create_stream_token(camera_id: int) -> str:
    expire = datetime.utcnow() + timedelta(seconds=_settings.stream_token_expire_seconds)
    payload = {
        "sub": str(camera_id),
        "type": _STREAM_TOKEN_TYPE,
        "exp": expire,
    }
    return jwt.encode(payload, _settings.jwt_secret_key, algorithm=_settings.jwt_algorithm)


def decode_stream_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(
            token, _settings.jwt_secret_key,
            algorithms=[_settings.jwt_algorithm]
        )
        if payload.get("type") != _STREAM_TOKEN_TYPE:
            return None
        return int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        return None
