"""Pytest configuration and shared fixtures."""
import pytest
import os

# Use a test-specific .env overrides
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_ashenta.db")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("CREDENTIAL_ENCRYPTION_KEY", "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMzJjaGFycw==")
os.environ.setdefault("APP_ENV", "test")
