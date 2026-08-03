"""Integration tests for API endpoints using TestClient with SQLite in-memory DB."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch, MagicMock

from app.data.models import Base
from app.data.database import get_db
from app.config.settings import get_settings

# Use in-memory SQLite for tests
TEST_DB_URL = "sqlite:///./test_ashenta.db"

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session")
def client():
    # Patch camera manager to avoid real camera connections
    with patch("app.main.init_camera_manager") as mock_mgr, \
         patch("app.main.create_tables"), \
         patch("app.main.create_scheduler") as mock_sched:

        mock_mgr.return_value = MagicMock()
        mock_sched.return_value = MagicMock()

        from app.main import app
        app.dependency_overrides[get_db] = override_get_db

        with TestClient(app, raise_server_exceptions=False) as c:
            yield c

        app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def admin_token(client):
    # Register admin user
    resp = client.post("/api/v1/auth/register", json={
        "username": "admin_test",
        "email": "admin@test.com",
        "password": "AdminPass123!",
        "role": "admin",
    })
    # Login
    resp = client.post("/api/v1/auth/login", data={
        "username": "admin_test",
        "password": "AdminPass123!",
    })
    assert resp.status_code == 200
    return resp.json()["access_token"]


class TestAuthEndpoints:
    def test_register_and_login(self, client):
        resp = client.post("/api/v1/auth/register", json={
            "username": "testuser",
            "email": "test@example.com",
            "password": "TestPass123!",
            "role": "viewer",
        })
        assert resp.status_code == 201

        resp = client.post("/api/v1/auth/login", data={
            "username": "testuser",
            "password": "TestPass123!",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    def test_me_endpoint(self, client, admin_token):
        resp = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "admin_test"

    def test_invalid_login(self, client):
        resp = client.post("/api/v1/auth/login", data={
            "username": "nobody",
            "password": "wrong",
        })
        assert resp.status_code == 401

    def test_refresh_token(self, client):
        client.post("/api/v1/auth/register", json={
            "username": "refreshuser",
            "email": "refresh@example.com",
            "password": "Refresh123!",
            "role": "viewer",
        })
        login = client.post("/api/v1/auth/login", data={
            "username": "refreshuser",
            "password": "Refresh123!",
        })
        rt = login.json()["refresh_token"]
        resp = client.post("/api/v1/auth/refresh", json={"refresh_token": rt})
        assert resp.status_code == 200
        assert "access_token" in resp.json()


class TestCamerasEndpoints:
    def test_list_cameras_unauthenticated(self, client):
        resp = client.get("/api/v1/cameras/")
        assert resp.status_code == 401

    def test_create_camera_requires_admin(self, client):
        # Register viewer
        client.post("/api/v1/auth/register", json={
            "username": "viewer1",
            "email": "viewer@example.com",
            "password": "View123!",
            "role": "viewer",
        })
        login = client.post("/api/v1/auth/login", data={
            "username": "viewer1", "password": "View123!"
        })
        viewer_token = login.json()["access_token"]

        with patch("app.api.routers.cameras.encrypt_credential", return_value="enc_url"):
            resp = client.post(
                "/api/v1/cameras/",
                json={"name": "Cam1", "url": "rtsp://test", "location_label": "Entrance"},
                headers={"Authorization": f"Bearer {viewer_token}"},
            )
        assert resp.status_code == 403

    def test_create_and_list_camera(self, client, admin_token):
        with patch("app.api.routers.cameras.encrypt_credential", return_value="enc_url"), \
             patch("app.api.routers.cameras.get_camera_manager") as mock_mgr:
            mock_mgr.return_value = MagicMock()
            resp = client.post(
                "/api/v1/cameras/",
                json={"name": "TestCam", "url": "rtsp://cam1", "location_label": "Door"},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        assert resp.status_code == 201
        cam_id = resp.json()["id"]

        resp = client.get(
            "/api/v1/cameras/",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        ids = [c["id"] for c in resp.json()]
        assert cam_id in ids


class TestAnalyticsEndpoints:
    def test_daily_counts(self, client, admin_token):
        resp = client.get(
            "/api/v1/analytics/daily?date=2026-01-01",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "exits" in data

    def test_heatmap(self, client, admin_token):
        resp = client.get(
            "/api/v1/analytics/heatmap",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "matrix" in data
        assert len(data["matrix"]) == 7
        assert len(data["matrix"][0]) == 24

    def test_forecast_insufficient_data(self, client, admin_token):
        resp = client.get(
            "/api/v1/analytics/forecast",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # No data in test DB → insufficient
        assert data["status"] == "insufficient_data"
