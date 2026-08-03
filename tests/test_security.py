"""Unit tests for security utilities."""
import pytest
from app.security import (
    hash_password, verify_password,
    create_access_token, decode_access_token,
    create_refresh_token_string, hash_refresh_token,
    create_stream_token, decode_stream_token,
)


class TestPasswordHashing:
    def test_hash_and_verify(self):
        plain = "MyS3cureP@ss!"
        hashed = hash_password(plain)
        assert hashed != plain
        assert verify_password(plain, hashed)

    def test_wrong_password_fails(self):
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)

    def test_hash_is_unique(self):
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2  # bcrypt salts


class TestJWT:
    def test_access_token_round_trip(self):
        user_id = 42
        token = create_access_token(user_id)
        decoded = decode_access_token(token)
        assert decoded == user_id

    def test_tampered_token_rejected(self):
        token = create_access_token(1) + "tampered"
        assert decode_access_token(token) is None

    def test_stream_token_round_trip(self):
        camera_id = 7
        token = create_stream_token(camera_id)
        decoded = decode_stream_token(token)
        assert decoded == camera_id

    def test_stream_token_rejects_access_token(self):
        access = create_access_token(1)
        assert decode_stream_token(access) is None

    def test_access_token_rejects_stream_token(self):
        stream = create_stream_token(1)
        assert decode_access_token(stream) is None


class TestRefreshToken:
    def test_hash_deterministic(self):
        raw = create_refresh_token_string()
        h1 = hash_refresh_token(raw)
        h2 = hash_refresh_token(raw)
        assert h1 == h2

    def test_different_tokens_different_hashes(self):
        t1 = create_refresh_token_string()
        t2 = create_refresh_token_string()
        assert hash_refresh_token(t1) != hash_refresh_token(t2)
