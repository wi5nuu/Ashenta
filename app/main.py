"""Main FastAPI app — secure CORS, Alembic auto-migration, startup assertions."""
from __future__ import annotations
import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from app.config.logging import configure_logging, get_logger
from app.config.settings import get_settings
from app.data.database import engine
from app.core.camera_manager import init_camera_manager
from app.core.events import get_event_bus
from app.services.scheduler import create_scheduler
from app.services.notification_service import NotificationService
from app.services.ws_manager import get_ws_manager
from app.api.routers import auth, cameras, stream, analytics, alerts, ws, users

configure_logging()
logger = get_logger(__name__)
_settings = get_settings()


def _run_migrations() -> None:
    """Run Alembic for PostgreSQL, create_tables() for SQLite (dev/test)."""
    from app.data.database import create_tables
    if "sqlite" in _settings.database_url:
        create_tables()
        logger.info("SQLite tables created")
        return
    from alembic.config import Config
    from alembic import command
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", _settings.database_url)
    command.upgrade(cfg, "head")


def _assert_secrets() -> None:
    """Fail fast if placeholder secrets are still set in production."""
    if _settings.app_env == "production":
        weak = {"change-this", "test-", "dev-"}
        for key_name, val in [
            ("APP_SECRET_KEY", _settings.app_secret_key),
            ("JWT_SECRET_KEY", _settings.jwt_secret_key),
        ]:
            if any(val.startswith(w) for w in weak):
                raise RuntimeError(
                    f"{key_name} looks like a placeholder — set a real secret in production."
                )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Ashenta starting up", env=_settings.app_env)

    _assert_secrets()
    _run_migrations()

    loop = asyncio.get_event_loop()
    manager = init_camera_manager(loop)

    # Wire EventBus → WebSocket broadcaster
    bus = get_event_bus()
    ws_mgr = get_ws_manager()
    ws_mgr.start_heartbeat()
    bus.subscribe("counter_update", ws_mgr.broadcast_counter)
    bus.subscribe("camera_status", ws_mgr.broadcast_camera_status)

    # Wire EventBus → Notifications
    notif = NotificationService()
    notif.register(bus)

    # Start camera workers
    manager.start_all()

    # Scheduler (hourly aggregation)
    scheduler = create_scheduler()
    scheduler.start()
    app.state.scheduler = scheduler

    logger.info("Ashenta startup complete")
    yield

    logger.info("Ashenta shutting down")
    manager.stop_all()
    scheduler.shutdown(wait=False)
    await ws_mgr.stop()
    logger.info("Ashenta shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Ashenta – Visitor Detection & Analytics",
        version="1.0.0",
        description="Multi-camera real-time visitor counting, live video, heatmap, and trend forecasting.",
        lifespan=lifespan,
    )

    # CORS — restrict in production; wildcard only for development
    allowed_origins = (
        ["*"] if _settings.app_env != "production"
        else os.getenv("ALLOWED_ORIGINS", "http://localhost:8000").split(",")
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(cameras.router, prefix=prefix)
    app.include_router(stream.router, prefix=prefix)
    app.include_router(analytics.router, prefix=prefix)
    app.include_router(alerts.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(ws.router, prefix=prefix)

    # Serve frontend SPA (built to frontend-dist/)
    frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend-dist")
    if os.path.isdir(frontend_path):
        # Mount assets directory for JS/CSS files
        assets_path = os.path.join(frontend_path, "assets")
        if os.path.isdir(assets_path):
            app.mount(
                "/assets",
                StaticFiles(directory=assets_path, html=False),
                name="assets",
            )

        # Serve favicon
        favicon_path = os.path.join(frontend_path, "favicon.svg")

        @app.get("/favicon.svg", include_in_schema=False)
        async def favicon():
            return FileResponse(favicon_path)

        # SPA fallback — serve index.html for all non-API routes
        index_path = os.path.join(frontend_path, "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_frontend(full_path: str):
            # Pass through API and WS routes (already handled by routers above)
            if full_path.startswith("api/") or full_path.startswith("ws/"):
                from fastapi import HTTPException
                raise HTTPException(status_code=404, detail="Not found")
            return FileResponse(index_path)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=_settings.app_host,
        port=_settings.app_port,
        reload=_settings.app_env == "development",
        workers=1,   # threading model requires single process
    )
