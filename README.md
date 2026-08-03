# Ashenta – Visitor Detection & Analytics System

Production-grade multi-camera visitor counting with live video, real-time dashboard, heatmap analysis, and trend forecasting.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    FastAPI App                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ /cameras │ │/analytics│ │ /stream  │ │/alerts │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │  WebSocket /ws   │  │   MJPEG Stream endpoint │  │
│  └──────────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  CameraManager → CameraWorker (thread per camera)   │
│     YOLOv8Detector + ByteTrack + EntryExitCounter   │
│     FrameBroker (annotated MJPEG → clients)         │
│     EventBus → WebSocketManager + Notifications     │
├─────────────────────────────────────────────────────┤
│  PostgreSQL (SQLAlchemy + Alembic)                  │
│  APScheduler (hourly aggregation job)               │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start (Docker)

### 1. Clone and configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
APP_SECRET_KEY=<random 32+ char string>
JWT_SECRET_KEY=<random 32+ char string>
CREDENTIAL_ENCRYPTION_KEY=<Fernet key>
```

Generate a Fernet key:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. Start

```bash
docker-compose up --build
```

The app will be available at `http://localhost:8000`.  
Swagger docs: `http://localhost:8000/docs`

### 3. First login

Register an admin user via the API or UI:

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@store.com","password":"YourPass123!","role":"admin"}'
```

Then open `http://localhost:8000` in your browser and log in.

---

## Manual Setup (Development)

### Requirements
- Python 3.11+
- PostgreSQL 14+

### Steps

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and configure .env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET_KEY, CREDENTIAL_ENCRYPTION_KEY, APP_SECRET_KEY

# 3. Run database migrations
alembic upgrade head

# 4. Start the server
python -m app.main
# OR
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## Adding a Camera (< 5 minutes)

1. Open the dashboard → **Kamera** tab → click **Tambah Kamera**
2. Enter name, RTSP/HTTP stream URL, and location label
3. Click **Save** – the camera worker starts automatically
4. Click **Atur Garis** on the camera row
5. Click two points on the canvas to draw the virtual counting line
6. Click **Simpan Garis** – the counter activates immediately (no restart needed)
7. Back on Dashboard, click **Lihat Live** to open the annotated MJPEG stream

---

## Project Structure

```
ashenta/
├── app/
│   ├── config/
│   │   ├── settings.py          # Pydantic settings from .env
│   │   └── logging.py           # Structured logging (structlog)
│   ├── core/
│   │   ├── vision.py            # DetectorInterface, YoloV8Detector, EntryExitCounter
│   │   ├── camera_worker.py     # Per-camera background thread
│   │   ├── camera_manager.py    # Lifecycle manager for all workers
│   │   ├── frame_broker.py      # Thread-safe MJPEG frame distributor
│   │   └── events.py            # Async EventBus + event dataclasses
│   ├── data/
│   │   ├── models.py            # SQLAlchemy ORM models
│   │   ├── database.py          # Engine + session factory
│   │   └── repositories.py      # Repository pattern (all DB ops)
│   ├── security/
│   │   ├── __init__.py          # JWT, bcrypt, Fernet, stream tokens
│   │   └── dependencies.py      # FastAPI auth dependencies
│   ├── services/
│   │   ├── scheduler.py         # APScheduler hourly aggregation
│   │   ├── peak_hour_analyzer.py# 7×24 heatmap builder
│   │   ├── trend_forecaster.py  # Holt-Winters forecasting
│   │   ├── notification_service.py # Telegram alert sender
│   │   └── ws_manager.py        # WebSocket connection manager
│   ├── api/
│   │   └── routers/
│   │       ├── auth.py          # Login, refresh, logout, register
│   │       ├── cameras.py       # CRUD + line config + stream token
│   │       ├── stream.py        # MJPEG endpoint
│   │       ├── analytics.py     # Daily, trend, heatmap, forecast
│   │       ├── alerts.py        # Alert rules CRUD
│   │       └── ws.py            # WebSocket counter endpoint
│   └── main.py                  # FastAPI app factory + lifespan
├── frontend/
│   ├── index.html               # Single-page app (4 pages)
│   └── app.js                   # Vanilla JS: WebSocket, Chart.js, MJPEG
├── alembic/
│   ├── env.py
│   └── versions/                # Migration files (generate with alembic revision)
├── tests/
│   ├── conftest.py
│   ├── test_vision.py           # EntryExitCounter unit tests
│   ├── test_security.py         # JWT, hashing, encryption tests
│   ├── test_forecast.py         # TrendForecaster unit tests
│   └── test_api.py              # Integration tests (TestClient + SQLite)
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── pytest.ini
├── requirements.txt
└── .env.example
```

---

## API Reference

Full interactive docs at `/docs` (Swagger UI) after starting the server.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login, returns JWT + refresh token |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/register` | Register user |
| GET | `/api/v1/cameras/` | List all cameras |
| POST | `/api/v1/cameras/` | Add camera (admin) |
| PUT | `/api/v1/cameras/{id}/line` | Set virtual line (admin) |
| POST | `/api/v1/cameras/{id}/start` | Start worker (admin) |
| GET | `/api/v1/cameras/{id}/stream-token` | Get MJPEG stream token |
| GET | `/api/v1/stream/{id}/mjpeg?token=...` | Annotated MJPEG stream |
| WS | `/ws/counters?token=...` | Live counter WebSocket |
| GET | `/api/v1/analytics/daily` | Entry/exit for a date |
| GET | `/api/v1/analytics/trend` | Daily totals (N days) |
| GET | `/api/v1/analytics/heatmap` | 7×24 peak hour heatmap |
| GET | `/api/v1/analytics/forecast` | Holt-Winters forecast |
| GET | `/api/v1/alerts/` | List alert rules |
| POST | `/api/v1/alerts/` | Create alert rule (admin) |
| DELETE | `/api/v1/alerts/{id}` | Delete alert rule (admin) |

---

## Running Tests

```bash
pytest
```

Coverage report is printed to terminal. Tests use an in-memory SQLite DB and mock the camera manager.

---

## Telegram Alerts Setup

1. Create a bot via [@BotFather](https://t.me/botfather), copy the token
2. Get your chat ID from [@userinfobot](https://t.me/userinfobot)
3. Set in `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=987654321
   ```
4. Add an alert rule via Settings → Alert Rules → Tambah Rule
5. Test by setting a `camera_offline` rule and stopping a camera

---

## Security Notes

- Camera RTSP URLs are encrypted at rest using Fernet symmetric encryption
- Credentials never appear in logs or API responses
- MJPEG streams require a short-lived signed JWT token (not the main access token)
- Refresh tokens are stored as SHA-256 hashes, rotated on every use
- All admin operations require `role=admin` verified server-side

---

## Scaling Notes

- Each camera runs in its own daemon thread – one camera failure cannot crash others
- FrameBroker drops frames for slow MJPEG clients rather than blocking workers
- Database writes (crossing events) happen in a separate session per worker
- APScheduler aggregation runs inside the same process; for high load, extract to a separate worker

---

## Definition of Done Checklist

- [x] All REST endpoints documented via Swagger at `/docs`
- [x] Live video per camera with bounding box + line + counter overlay
- [x] Counter updates via WebSocket, latency target < 2s
- [x] 7×24 peak hour heatmap from historical data
- [x] Holt-Winters forecast with confidence interval + honest message when data < 21 days
- [x] Telegram alert on `camera_offline` and visitor threshold rules
- [x] Camera credentials encrypted at rest, never plaintext in logs/DB
- [x] One camera failure isolated from others (independent threads)
- [x] Unit + integration tests (vision, security, forecast, API)
- [x] `docker-compose up` starts entire system from scratch
- [x] README sufficient for zero-question setup by a new developer
