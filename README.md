<div align="center">

<img src="frontend-react/public/android-chrome-192x192.png" alt="Ashenta Logo" width="80" height="80" />

# Ashenta

**Production-grade multi-camera visitor analytics platform**

Real-time people counting · Live MJPEG streaming · AI-powered detection · Predictive analytics

[![Python](https://img.shields.io/badge/Python-3.11+-3776ab?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18+-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-ff6b35?style=flat-square)](https://ultralytics.com)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Quick Start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [API Reference](#api-reference) · [Configuration](#configuration) · [Contributing](#contributing)

</div>

---

## Overview

Ashenta is a self-hosted visitor intelligence system built for physical retail stores. It turns existing CCTV cameras into a real-time analytics platform — counting people as they cross a configurable virtual line, streaming annotated video to a live dashboard, and forecasting future traffic patterns.

**No cloud dependency. No per-camera SaaS fees. Runs on your own hardware.**

### Key capabilities

| Capability | Detail |
|---|---|
| **Multi-camera detection** | Independent per-camera worker threads; one camera going offline never affects others |
| **Real-time counter push** | WebSocket updates reach all connected dashboards in < 2 seconds |
| **Live annotated video** | MJPEG streams with bounding boxes, virtual line, and counter overlay |
| **Virtual line config** | Click two points on a live snapshot — no manual coordinate input |
| **Hourly heatmap** | 7 × 24 grid showing average traffic by day-of-week and hour |
| **Holt-Winters forecasting** | Weekly-seasonal prediction with confidence intervals; honest about data requirements |
| **Telegram alerts** | Notify on camera offline, occupancy threshold, or daily target events |
| **Role-based access** | Admin and viewer roles; JWT + refresh token auth |

---

## Features

### Dashboard — 4 pages

**Dashboard (Overview)**
- Live camera grid with annotated MJPEG streams
- Total in / out / net counters updating via WebSocket
- Active camera count and connection status indicator

**Kamera (Cameras)**
- Card grid view with per-camera live preview
- One-click start/stop, edit, delete
- Click any camera name to open a full detail modal (info, virtual line, source config)
- Stream preview directly in-card

**Analitik (Analytics)**
- Hourly bar chart with in/out/net breakdown
- Per-camera or all-cameras filter
- Date picker with auto-refresh for today's data
- Holt-Winters predictive chart (requires 21+ days of data)

**Pengaturan (Settings)**
- Change password
- Admin: manage users (create, delete), enforce role

### Backend

- **YOLOv8** person detection behind a swappable `DetectorInterface`
- **ByteTrack** multi-object tracking (anti-double-counting)
- **EntryExitCounter** with 5-frame debounce crossing detection
- **FrameBroker** thread-safe annotated frame distribution
- **APScheduler** hourly aggregation job
- **Fernet encryption** for RTSP credentials at rest
- **Short-lived stream tokens** — video URL cannot be reused indefinitely
- **Structured JSON logging** — no secrets in logs

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        React SPA (Vite)                       │
│  Dashboard · Cameras · Analytics · Settings                   │
│  WebSocket client (Zustand) · MJPEG <img> · REST (Axios)     │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP / WS
┌────────────────────────▼─────────────────────────────────────┐
│                     FastAPI Application                       │
│                                                               │
│  /api/v1/auth      /api/v1/cameras     /api/v1/analytics     │
│  /api/v1/alerts    /api/v1/stream      /api/v1/users         │
│  /api/v1/ws/counters (WebSocket)                             │
└──────┬──────────────────────┬────────────────────────────────┘
       │                      │
┌──────▼──────┐    ┌──────────▼───────────────────────────────┐
│  SQLite /   │    │              Core Engine                  │
│ PostgreSQL  │    │                                           │
│             │    │  CameraManager                           │
│ SQLAlchemy  │    │    └── CameraWorker × N (threads)        │
│  + Alembic  │    │          YOLOv8Detector                  │
│             │    │          ByteTracker                     │
│ APScheduler │    │          EntryExitCounter                │
│  (hourly    │    │          FrameBroker ──► MJPEG clients   │
│  aggregation│    │          EventBus ──────► WebSocket mgr  │
│  + forecast)│    │                                           │
└─────────────┘    │  NotificationService (Telegram)          │
                   │  TrendForecaster (Holt-Winters)          │
                   │  PeakHourAnalyzer (7×24 heatmap)         │
                   └──────────────────────────────────────────┘
```

### Data flow

**Counter path (< 2s latency)**
```
CameraWorker detects crossing
  → EventRepository.write(db)
  → EventBus.publish()
    → WebSocketManager.broadcast(counter_update JSON)
      → React Zustand store update
        → UI re-render
```

**Video path (separate from counter, < 3s latency on LAN)**
```
CameraWorker annotates frame
  → FrameBroker.publish(camera_id, jpeg_bytes)
    → GET /stream/{id}/mjpeg (StreamingResponse, multipart/x-mixed-replace)
      → <img> tag in browser (native MJPEG decode)
```

---

## Quick Start

### Option A — Docker (recommended)

**Requirements:** Docker, Docker Compose

```bash
# 1. Clone
git clone https://github.com/wi5nuu/Ashenta.git
cd Ashenta

# 2. Configure environment
cp .env.example .env
```

Open `.env` and set the three required secrets:

```env
APP_SECRET_KEY=<random 32+ character string>
JWT_SECRET_KEY=<random 32+ character string>
CREDENTIAL_ENCRYPTION_KEY=<Fernet key — see below>
```

Generate a Fernet key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

```bash
# 3. Start
docker-compose up --build

# App:     http://localhost:8000
# Swagger: http://localhost:8000/docs
```

```bash
# 4. Create first admin user
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@example.com",
    "password": "YourStrongPass1!",
    "role": "admin"
  }'
```

Then open `http://localhost:8000` and log in.

---

### Option B — Manual / Development

**Requirements:** Python 3.11+, Node.js 18+

```bash
# Clone
git clone https://github.com/wi5nuu/Ashenta.git
cd Ashenta

# Python environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env — set APP_SECRET_KEY, JWT_SECRET_KEY, CREDENTIAL_ENCRYPTION_KEY

# Database migrations
alembic upgrade head

# Start backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend (separate terminal):

```bash
cd frontend-react
npm install
npm run dev         # dev server on http://localhost:5173 (proxies API to :8000)
npm run build       # production build → ../frontend-dist/
```

---

## Adding a Camera

Setup takes under 5 minutes with no code changes required.

1. Open the dashboard → **Kamera** tab → **Tambah Kamera**
2. Select source type: RTSP · HTTP/MJPEG · Webcam · Video file · YouTube/online
3. Enter name, URL or index, and optional location label
4. Click **Tambah Kamera** — the camera worker starts automatically
5. Click the **Garis** button on the camera card
6. The snapshot loads — click two points to draw the virtual counting line
7. Click **Simpan Garis** — counting activates immediately, no restart needed
8. Click any camera name to open the detail modal and verify the configuration

> **Supported source types**
>
> | Type | Example |
> |---|---|
> | RTSP | `rtsp://user:pass@192.168.1.10:554/stream1` |
> | HTTP/MJPEG | `http://192.168.1.10:8080/video` |
> | Webcam | Index `0` (first USB/built-in camera) |
> | Video file | Upload `.mp4`, `.avi`, `.mkv` |
> | Online (yt-dlp) | Any URL supported by yt-dlp |

---

## Configuration

All configuration is read from environment variables (`.env` file). See `.env.example` for the full list.

### Required

| Variable | Description |
|---|---|
| `APP_SECRET_KEY` | Application secret — random 32+ chars |
| `JWT_SECRET_KEY` | Signs access/refresh JWTs — random 32+ chars |
| `CREDENTIAL_ENCRYPTION_KEY` | Fernet key — encrypts RTSP credentials at rest |

### Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./ashenta.db` | SQLAlchemy connection string |

To use PostgreSQL:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/ashenta
```

### JWT & Tokens

| Variable | Default | Description |
|---|---|---|
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Access token lifetime |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime |
| `STREAM_TOKEN_EXPIRE_SECONDS` | `300` | Short-lived video stream token |

### Camera & Detection

| Variable | Default | Description |
|---|---|---|
| `YOLO_MODEL_PATH` | `yolov8n.pt` | Path to YOLO weights file |
| `YOLO_CONFIDENCE_THRESHOLD` | `0.5` | Detection confidence cutoff |
| `MAX_STREAM_VIEWERS` | `5` | Max concurrent MJPEG clients per camera |
| `STREAM_FPS` | `10` | Dashboard stream frame rate |

### Telegram Alerts (optional)

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_DEFAULT_CHAT_ID` | Default notification target |

To get a Telegram bot token:
1. Message `@BotFather` on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the token to `TELEGRAM_BOT_TOKEN`
4. Send a message to your bot, then fetch `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `chat_id`

---

## API Reference

Full interactive documentation available at `http://localhost:8000/docs` (Swagger UI) and `http://localhost:8000/redoc` (ReDoc).

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Login with username/password — returns `access_token` + `refresh_token` |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh token |
| `POST` | `/api/v1/auth/logout` | Revoke refresh token |
| `POST` | `/api/v1/auth/register` | Create user **(admin only)** |
| `GET` | `/api/v1/auth/me` | Current user info |
| `POST` | `/api/v1/auth/change-password` | Change own password |

All protected endpoints require `Authorization: Bearer <access_token>`.

### Cameras

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/cameras/` | List all cameras |
| `POST` | `/api/v1/cameras/` | Add camera (admin) |
| `GET` | `/api/v1/cameras/{id}` | Get camera detail |
| `PATCH` | `/api/v1/cameras/{id}` | Update camera (admin) |
| `DELETE` | `/api/v1/cameras/{id}` | Delete camera (admin) |
| `POST` | `/api/v1/cameras/{id}/start` | Start camera worker (admin) |
| `POST` | `/api/v1/cameras/{id}/stop` | Stop camera worker (admin) |
| `PUT` | `/api/v1/cameras/{id}/line` | Set virtual line config (admin) |
| `GET` | `/api/v1/cameras/{id}/stream-token` | Get short-lived stream token |
| `GET` | `/api/v1/cameras/{id}/counter` | Current day in/out counts |
| `POST` | `/api/v1/cameras/{id}/upload` | Upload video file source |

### Streaming

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/stream/{id}/mjpeg?token=...` | Annotated MJPEG stream |
| `GET` | `/api/v1/stream/{id}/snapshot?token=...` | Single JPEG frame |

Stream tokens are short-lived (default 5 min) and camera-scoped. Fetch a fresh token before opening a stream.

### Analytics

| Method | Path | Query params | Description |
|---|---|---|---|
| `GET` | `/api/v1/analytics/daily` | `date`, `camera_id` | Entry/exit totals for a date |
| `GET` | `/api/v1/analytics/trend` | `days`, `camera_id` | Daily totals over N days |
| `GET` | `/api/v1/analytics/hourly` | `date`, `camera_id` | Per-hour breakdown |
| `GET` | `/api/v1/analytics/heatmap` | `trailing_days`, `camera_id` | 7×24 peak-hour heatmap |
| `GET` | `/api/v1/analytics/forecast` | `camera_id` | Holt-Winters predictions (requires 21+ days) |
| `GET` | `/api/v1/analytics/predictive` | `camera_id` | Hourly predictions for tomorrow |

### Alerts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/alerts/` | List alert rules (admin) |
| `POST` | `/api/v1/alerts/` | Create alert rule (admin) |
| `PATCH` | `/api/v1/alerts/{id}` | Update alert rule (admin) |
| `DELETE` | `/api/v1/alerts/{id}` | Delete alert rule (admin) |

### WebSocket

```
WS /api/v1/ws/counters?token=<access_token>
```

**Server → Client messages:**

```jsonc
// Live counter update
{
  "type": "counter_update",
  "camera_id": 1,
  "entries": 128,
  "exits": 115
}

// Camera status change
{
  "type": "camera_status",
  "camera_id": 1,
  "status": "active"   // active | inactive | error
}

// Bulk snapshot on connect
{
  "type": "bulk_counters",
  "cameras": [
    { "camera_id": 1, "entries": 128, "exits": 115 }
  ]
}

// Status snapshot on connect
{
  "type": "bulk_statuses",
  "cameras": [
    { "camera_id": 1, "status": "active" }
  ]
}
```

**Client → Server:**

```jsonc
// Keep-alive (sent every 25s by frontend)
{ "type": "ping" }
```

The frontend automatically reconnects with exponential backoff (1s → 30s max) and skips retry on auth errors (close code 4001/4003).

---

## Project Structure

```
Ashenta/
├── app/
│   ├── config/
│   │   ├── settings.py          # Pydantic settings (all from .env)
│   │   └── logging.py           # Structured JSON logging (structlog)
│   ├── core/
│   │   ├── vision.py            # DetectorInterface, YoloV8Detector, EntryExitCounter
│   │   ├── camera_worker.py     # Per-camera background thread (detect → track → count → stream)
│   │   ├── camera_manager.py    # Lifecycle manager for all camera workers
│   │   ├── frame_broker.py      # Thread-safe MJPEG frame distributor + viewer limit
│   │   └── events.py            # Async EventBus + event dataclasses
│   ├── data/
│   │   ├── models.py            # SQLAlchemy ORM: Camera, Event, User, HourlyAggregate,
│   │   │                        #   AlertRule, NotificationLog, RefreshToken
│   │   ├── database.py          # Engine + session factory
│   │   └── repositories.py      # Repository pattern — all DB operations here
│   ├── security/
│   │   ├── __init__.py          # JWT creation/decode, bcrypt, Fernet, stream tokens
│   │   └── dependencies.py      # FastAPI auth dependency (get_current_user)
│   ├── services/
│   │   ├── scheduler.py         # APScheduler: hourly HourlyAggregate job
│   │   ├── peak_hour_analyzer.py# 7×24 heatmap computation
│   │   ├── trend_forecaster.py  # Holt-Winters weekly-seasonal forecasting
│   │   ├── notification_service.py # Telegram alert dispatch + rule evaluation
│   │   └── ws_manager.py        # WebSocket connection manager + broadcast
│   └── api/
│       ├── main.py              # FastAPI app factory + lifespan (startup/shutdown)
│       └── routers/
│           ├── auth.py          # Login, refresh, logout, register (admin-only), me
│           ├── cameras.py       # CRUD, start/stop, line config, stream token, counter
│           ├── stream.py        # MJPEG streaming + snapshot endpoints
│           ├── analytics.py     # Daily, trend, hourly, heatmap, forecast, predictive
│           ├── alerts.py        # Alert rules CRUD
│           ├── users.py         # User management (admin)
│           └── ws.py            # WebSocket counter endpoint
├── frontend-react/
│   ├── src/
│   │   ├── api.js               # Axios instance + all API functions
│   │   ├── store/index.js       # Zustand: auth store (persisted) + WS store
│   │   ├── hooks/
│   │   │   └── useWebSocket.js  # WS connection with keep-alive + exponential backoff
│   │   ├── components/
│   │   │   ├── UI.jsx           # Design system: Card, Btn, Badge, Modal, FormGroup, ...
│   │   │   ├── Layout.jsx       # Sidebar + topbar + WS status indicator
│   │   │   ├── CameraCard.jsx   # Camera grid card with inline stream preview
│   │   │   ├── CameraDetailModal.jsx  # Full camera detail: stream, info tabs, actions
│   │   │   ├── AddCameraModal.jsx     # Add/edit camera with source type selector
│   │   │   ├── LineConfigModal.jsx    # Canvas-based virtual line drawer
│   │   │   └── ErrorBoundary.jsx      # Global error boundary (dev/prod aware)
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── DashboardPage.jsx
│   │       ├── CamerasPage.jsx
│   │       ├── AnalyticsPage.jsx
│   │       └── SettingsPage.jsx
│   ├── index.css                # Design tokens: dark theme, accent gradient, typography
│   └── vite.config.js
├── alembic/
│   ├── env.py
│   └── versions/                # DB migration files
├── tests/
│   ├── conftest.py              # SQLite test DB + FastAPI TestClient fixtures
│   ├── test_vision.py           # EntryExitCounter unit tests
│   ├── test_security.py         # JWT, hashing, Fernet, stream token tests
│   ├── test_forecast.py         # TrendForecaster: insufficient data + directional accuracy
│   └── test_api.py              # Integration tests (auth, cameras, analytics)
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── pytest.ini
├── requirements.txt
└── .env.example
```

---

## Running Tests

```bash
# Install dev dependencies (included in requirements.txt)
pip install -r requirements.txt

# Run all tests
pytest

# With coverage
pytest --cov=app --cov-report=term-missing

# Specific module
pytest tests/test_vision.py -v
pytest tests/test_api.py -v
```

Tests use an in-memory SQLite database and a FastAPI `TestClient` — no running server or camera hardware required.

---

## Security

| Concern | Implementation |
|---|---|
| Authentication | JWT access tokens (60 min) + refresh tokens (30 days, rotated on use) |
| Password storage | bcrypt (passlib) |
| RTSP credentials | Fernet symmetric encryption at rest |
| Stream access | Short-lived camera-scoped tokens (5 min), validated server-side |
| Registration | Admin-only endpoint — public self-registration is disabled |
| Input validation | Pydantic models on all request bodies |
| SQL injection | SQLAlchemy ORM parameterized queries throughout |
| Error messages | Production error boundary shows error ID only, no stack traces |
| Secrets in logs | Structured logging configured to never include credential fields |

> For production deployments, place Ashenta behind a reverse proxy (nginx/Caddy) with HTTPS. The system does not terminate TLS itself.

---

## Deployment Checklist

Before going live:

- [ ] Generate unique `APP_SECRET_KEY`, `JWT_SECRET_KEY`, `CREDENTIAL_ENCRYPTION_KEY`
- [ ] Set `DATABASE_URL` to a persistent PostgreSQL instance (not SQLite for production)
- [ ] Configure HTTPS via reverse proxy
- [ ] Set `MAX_STREAM_VIEWERS` appropriate for your network bandwidth
- [ ] Place `yolov8n.pt` (or a larger model) in the project root
- [ ] Create the first admin user via API (see Quick Start step 4)
- [ ] Configure Telegram bot token if alerts are needed
- [ ] Verify `alembic upgrade head` completed without errors

---

## Troubleshooting

**WebSocket shows "Terputus" (disconnected)**
- Verify the backend is running and accessible
- Check that your JWT token is valid (try logging out and back in)
- Confirm the WebSocket path `/api/v1/ws/counters` is not being blocked by a proxy

**Camera stream shows "Stream tidak tersedia"**
- The camera worker must be active (green status badge)
- Stream tokens expire after 5 minutes — the frontend fetches a fresh one on each play
- Check backend logs for RTSP connection errors

**"Kamera tidak aktif" on snapshot in line config**
- Start the camera first (click **Mulai** on the camera card), then open line config
- The snapshot endpoint requires at least one processed frame

**Prediksi tidak tersedia**
- Holt-Winters forecasting requires a minimum of 21 days of historical data
- The analytics page will show an honest message until that threshold is met

**Build warning: chunk > 500 kB**
- Expected — recharts and react-router are large. Not an error.
- To reduce: enable `build.rolldownOptions.output.codeSplitting` in `vite.config.js`

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes, add tests where appropriate
4. Verify the build: `npm run build` (frontend) and `pytest` (backend)
5. Submit a pull request with a clear description of the change

Please keep commits focused and use conventional commit prefixes:
- `feat:` — new feature
- `fix:` — bug fix
- `security:` — security hardening
- `refactor:` — code cleanup without behavior change
- `style:` — UI/CSS changes
- `docs:` — documentation only
- `chore:` — dependency updates, config changes

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with FastAPI · React · YOLOv8 · ByteTrack

</div>
