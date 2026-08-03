# PROMPT EKSEKUSI v1.0.0: Sistem Deteksi & Analitik Pengunjung Toko (Multi-Kamera, Real-Time, Prediktif) name project is Ashenta
> **Cara pakai:** salin seluruh isi file ini, tempel sebagai instruksi awal ke AI coding agent (Fable 5 / Claude Code / dsb). Versi ini menambah: live video streaming ke dashboard, update counter instan, dan analitik prediktif (jam tersibuk + prediksi tren kunjungan). Menggantikan draft v1.

---

## 0. PERAN KAMU (Role untuk AI Agent)

Kamu adalah **Senior Software Architect & Full-Stack Engineer** spesialis computer vision production system dan real-time data platform. Bangun sistem ini dengan standar production-grade: OOP bersih (SOLID), aman berlapis, teruji otomatis, dan terdokumentasi. Ikuti dokumen ini berurutan dari Bagian 1 sampai akhir. Untuk tiap bagian besar, selesaikan dan uji dulu sebelum lanjut ke bagian berikutnya — jangan membangun semua lapisan sekaligus tanpa validasi antar-tahap.

---

## 1. RINGKASAN PROYEK & METRIK SUKSES

**Konteks bisnis:** Pemilik toko fisik dengan beberapa kamera CCTV ingin: (a) tahu berapa pengunjung masuk/keluar per hari secara real-time, (b) bisa **melihat langsung kondisi toko** dari dashboard (bukan cuma angka), (c) tahu **jam-jam tersibuk** untuk atur jadwal staf, (d) dapat **perkiraan tren kunjungan** ke depan untuk perencanaan.

**Metrik sukses sistem (harus bisa diukur, bukan subjektif):**
| Metrik | Target |
|---|---|
| Akurasi hitung vs manual | ≥ 90% |
| Latensi update counter di dashboard | < 2 detik dari event terjadi |
| Latensi video live di dashboard | < 3 detik dari kejadian nyata (MJPEG lokal jaringan) |
| Uptime sistem (di luar downtime kamera) | ≥ 99% dalam sebulan operasional |
| Waktu setup kamera baru oleh admin | < 5 menit, tanpa sentuh kode |

---

## 2. REQUIREMENT FUNGSIONAL (lengkap)

| # | Requirement |
|---|---|
| F1 | Deteksi orang di tiap frame, multi-kamera paralel independen |
| F2 | Tracking lintas-frame (anti dobel hitung) |
| F3 | Garis virtual per-kamera, dikonfigurasi via klik di preview frame (bukan input angka manual) |
| F4 | Setiap event lintas-garis tersimpan permanen (kamera, arah, waktu) |
| F5 | **Video live tiap kamera tampil di dashboard**, dengan overlay bounding box + garis + counter di atas video (bukan CCTV mentah) |
| F6 | Counter live update otomatis ke semua client dashboard yang sedang buka, tanpa refresh manual, delay < 2 detik |
| F7 | Grafik tren harian & mingguan, filter per kamera/gabungan |
| F8 | **Heatmap jam tersibuk**: visualisasi jam (0-23) x hari (Senin-Minggu) menunjukkan rata-rata pengunjung |
| F9 | **Prediksi tren**: perkiraan jumlah pengunjung untuk N hari ke depan berdasarkan pola historis |
| F10 | Perbandingan otomatis: hari ini vs hari yang sama minggu lalu, minggu ini vs minggu lalu (persentase naik/turun) |
| F11 | Admin tambah/edit/hapus kamera tanpa restart server |
| F12 | Sistem tetap jalan normal untuk kamera lain walau satu kamera offline |
| F13 | Login wajib untuk akses dashboard, role admin/viewer |
| F14 | Ekspor data (CSV) untuk laporan eksternal |
| F15 | Sistem alert dasar (opsional aktif): notifikasi Telegram kalau kamera offline lebih dari X menit |

---

## 3. REQUIREMENT NON-FUNGSIONAL

### 3.1 Akurasi
- Model: YOLOv8 (`m` ke atas jika hardware cukup) di belakang `DetectorInterface` yang bisa ditukar backend.
- Debounce line-crossing: minimal **5 frame berturut-turut** sebelum/sesudah lintas garis.
- Toleransi oklusi: `track_buffer` ByteTrack ≥ 30 frame.
- Mode kalibrasi: bandingkan hitung sistem vs manual, tuning confidence threshold otomatis dicatat sebagai riwayat kalibrasi (tabel `CalibrationLog`).
- **Prediksi tren**: gunakan metode statistik yang jujur soal keterbatasannya (bukan "AI ramal masa depan" yang menyesatkan) — lihat Bagian 10 untuk detail metode dan syarat data minimum.

### 3.2 Real-Time (dua jalur berbeda, jangan dicampur)
- **Jalur data (angka/counter)**: WebSocket push tiap ada event baru. Payload kecil (JSON), latensi target < 2 detik.
- **Jalur video**: endpoint streaming terpisah per kamera (lihat Bagian 9). Video **tidak** lewat WebSocket yang sama dengan data angka — pisahkan supaya beban video tidak mengganggu kecepatan update counter.
- Kalau client dashboard terputus lalu connect lagi, harus otomatis sinkron ulang ke state terkini (bukan cuma nunggu event berikutnya).

### 3.3 Keamanan
- JWT (access + refresh token), password di-hash argon2/bcrypt.
- Kredensial RTSP dienkripsi at-rest (Fernet).
- **Endpoint streaming video juga wajib token-protected** (bukan URL publik tanpa auth — video toko adalah data sensitif).
- Validasi input via Pydantic di semua endpoint, ORM parameterized query.
- Rate limiting di endpoint login & endpoint streaming (cegah satu client buka ratusan koneksi stream sekaligus).
- HTTPS via reverse proxy untuk akses dari luar jaringan lokal toko.
- Audit log: siapa login, siapa ubah konfigurasi kamera, kapan.

### 3.4 Performa & Skalabilitas
- Proses deteksi tiap kamera di thread/process terpisah.
- Frame untuk **deteksi** (resolusi lebih tinggi, akurat) dipisah dari frame untuk **streaming ke dashboard** (boleh di-downscale, mis. 640px lebar, supaya hemat bandwidth) — dua tujuan, dua resolusi berbeda dari sumber yang sama.
- Batasi jumlah viewer stream bersamaan per kamera (mis. max 5) untuk cegah CPU/bandwidth toko jebol; kalau lebih, tampilkan pesan "batas viewer tercapai" bukan crash.
- Index database `camera_id + timestamp` untuk query agregasi cepat.
- Agregasi harian/jam dihitung via scheduled job (bukan real-time query berat tiap load dashboard) — lihat `APScheduler` di Bagian 4.

### 3.5 Reliabilitas
- Auto-reconnect RTSP dengan exponential backoff.
- `/api/health` melaporkan status tiap kamera + status job agregasi/prediksi terakhir.
- Log terstruktur JSON, tanpa bocorkan secret.
- Idempotent event write (aman di-restart).
- Timestamp timezone-aware (Asia/Jakarta).

---

## 4. TECH STACK

| Layer | Pilihan | Catatan |
|---|---|---|
| Bahasa | Python 3.11+ | |
| Web framework | FastAPI | async, OpenAPI otomatis |
| Deteksi | Ultralytics YOLOv8 | di belakang `DetectorInterface` |
| Tracking | ByteTrack (`supervision`) | |
| Database | SQLite → desain portable ke PostgreSQL via SQLAlchemy ORM | |
| Migrasi DB | Alembic | wajib, jangan ubah schema manual |
| Real-time data | WebSocket (FastAPI native) | untuk counter |
| Live video | MJPEG stream (`StreamingResponse` multipart) per kamera | lihat Bagian 9 |
| Scheduled job | APScheduler | agregasi harian/jam, kalkulasi prediksi |
| Forecasting | `statsmodels` (Exponential Smoothing / Holt-Winters) | lihat Bagian 10, bukan deep learning — proporsional untuk skala 1 toko |
| Cache (opsional, kalau kamera > 4 atau viewer banyak) | Redis | untuk simpan frame terbaru per kamera, kurangi beban decode berulang |
| Notifikasi | `python-telegram-bot` | jalur alert utama; WhatsApp via provider pihak ketiga (mis. Fonnte) sebagai opsi tambahan, bukan wajib |
| Auth | `python-jose` (JWT) + `passlib[argon2]` | |
| Frontend | HTML/CSS/JS + Chart.js (grafik) + native `<img>` tag utk MJPEG stream | React opsional kalau tim familiar |
| Deployment | Docker + docker-compose | |

---

## 5. ARSITEKTUR SISTEM (OOP)

Design pattern wajib: **Strategy** (detector backend), **Repository** (akses data), **Observer/Pub-Sub** (broadcast WebSocket), **Factory** (bikin `CameraWorker`), **Singleton** (`ConfigManager`), **Template Method** (langkah kalkulasi analitik harian yang seragam per kamera).

### 5.1 Struktur Folder (diperluas dari v1)

```
store-vision-system/
├── app/
│   ├── core/
│   │   ├── detector.py           # DetectorInterface, YoloV8Detector
│   │   ├── tracker.py            # PersonTracker
│   │   ├── line_counter.py       # EntryExitCounter (debounce)
│   │   ├── camera_worker.py      # CameraWorker (loop deteksi + publish frame utk stream)
│   │   └── frame_broker.py       # FrameBroker: simpan frame terbaru per kamera utk streaming
│   ├── services/
│   │   ├── camera_manager.py
│   │   ├── analytics_service.py       # agregasi dasar
│   │   ├── peak_hour_analyzer.py      # NEW: heatmap jam tersibuk
│   │   ├── trend_forecaster.py        # NEW: prediksi tren
│   │   ├── notification_service.py    # alert Telegram/webhook
│   │   └── scheduler.py               # APScheduler job registry
│   ├── data/
│   │   ├── models.py             # + HourlyAggregate, CalibrationLog, AlertRule, NotificationLog
│   │   ├── repository.py
│   │   └── database.py
│   ├── api/
│   │   ├── main.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── cameras.py
│   │   │   ├── analytics.py
│   │   │   ├── stream.py         # NEW: endpoint MJPEG per kamera
│   │   │   └── alerts.py         # NEW: konfigurasi alert
│   │   ├── websocket.py
│   │   └── schemas.py
│   ├── security/
│   │   ├── auth.py
│   │   └── crypto.py
│   └── config/
│       ├── config_schema.py
│       └── config.yaml
├── frontend/
│   ├── index.html                 # Overview: live video grid + counter
│   ├── analytics.html             # NEW: heatmap + grafik prediksi
│   ├── settings.html              # kelola kamera + alert
│   ├── app.js
│   └── styles.css
├── tests/
│   ├── test_line_counter.py
│   ├── test_repository.py
│   ├── test_peak_hour_analyzer.py     # NEW
│   ├── test_trend_forecaster.py       # NEW
│   └── test_api.py
├── docker-compose.yml   # app + redis (opsional) + scheduler worker
├── Dockerfile
├── requirements.txt
└── README.md
```

### 5.2 Kontrak Kelas Tambahan (di luar yang sudah ada di v1)

```python
# core/frame_broker.py
class FrameBroker:
    """Menyimpan frame teranotasi terbaru tiap kamera secara thread-safe,
    supaya endpoint streaming tidak perlu akses langsung ke capture loop."""
    def publish(self, camera_id: str, annotated_frame) -> None: ...
    def get_latest(self, camera_id: str): ...
    def get_jpeg_bytes(self, camera_id: str, quality: int = 70) -> bytes: ...


# services/peak_hour_analyzer.py
class PeakHourAnalyzer:
    """Hitung rata-rata pengunjung per (hari-dalam-minggu, jam) dari histori event."""
    def compute_heatmap(self, camera_id: str | None, trailing_days: int = 28) -> dict:
        """Return grid 7x24: {(day_of_week, hour): avg_visitor_count}."""
        ...
    def get_top_busy_hours(self, camera_id: str | None, top_n: int = 3) -> list: ...


# services/trend_forecaster.py
class TrendForecaster:
    """Prediksi kunjungan N hari ke depan pakai Holt-Winters (weekly seasonality)."""
    MIN_DAYS_REQUIRED = 21   # minimal 3 minggu data sebelum prediksi diaktifkan

    def has_enough_data(self, camera_id: str | None) -> bool: ...
    def forecast(self, camera_id: str | None, days_ahead: int = 7) -> list:
        """Return [{'date': ..., 'predicted_visitors': ..., 'confidence_low': ...,
        'confidence_high': ...}]. Jika data belum cukup, raise
        InsufficientDataError -- caller HARUS tangani ini dan tampilkan
        pesan jujur ke user, bukan angka ngasal."""
        ...


# services/notification_service.py
class NotificationService:
    def send_telegram(self, chat_id: str, message: str) -> None: ...
    def evaluate_rules(self, event_context: dict) -> None:
        """Cek semua AlertRule aktif, kirim notifikasi kalau kondisi terpenuhi."""
        ...
```

---

## 6. SKEMA DATABASE (lengkap, v1 + tambahan)

```
Camera (sama seperti v1)
Event (sama seperti v1)
User (sama seperti v1)

HourlyAggregate                    # NEW - dihitung oleh scheduled job tiap jam
- id (PK)
- camera_id (FK, nullable = semua kamera)
- date (date)
- hour (int, 0-23)
- day_of_week (int, 0-6)
- visitor_count (int)

CalibrationLog                     # NEW
- id (PK)
- camera_id (FK)
- calibrated_at (datetime)
- manual_count (int)
- system_count (int)
- old_confidence_threshold (float)
- new_confidence_threshold (float)

AlertRule                          # NEW
- id (PK)
- name (string)
- rule_type (enum: 'camera_offline' | 'daily_target_reached' | 'occupancy_threshold')
- camera_id (FK, nullable = semua kamera)
- threshold_value (float, nullable)
- notify_channel (enum: 'telegram' | 'webhook')
- notify_target (string)   # chat_id telegram / URL webhook
- is_active (bool)

NotificationLog                    # NEW - audit trail notifikasi terkirim
- id (PK)
- alert_rule_id (FK)
- sent_at (datetime)
- message (text)
- delivery_status (enum: 'sent' | 'failed')
```

---

## 7. SPESIFIKASI API (lengkap, v1 + tambahan)

| Method | Endpoint | Fungsi | Akses |
|---|---|---|---|
| *(semua endpoint v1 tetap berlaku: auth, cameras, analytics/live, analytics/history, health)* | | | |
| GET | `/api/stream/{camera_id}?token=` | **MJPEG live stream** teranotasi (bounding box + garis + counter overlay) | Authenticated, token per-request |
| GET | `/api/analytics/heatmap?camera_id=&trailing_days=28` | Data heatmap 7x24 jam tersibuk | Authenticated |
| GET | `/api/analytics/forecast?camera_id=&days_ahead=7` | Prediksi tren; return `insufficient_data: true` kalau data < 21 hari, bukan angka palsu | Authenticated |
| GET | `/api/analytics/comparison?camera_id=&period=daily\|weekly` | Perbandingan vs periode sebelumnya (% naik/turun) | Authenticated |
| GET | `/api/alerts` | List alert rule | Admin |
| POST | `/api/alerts` | Buat alert rule baru | Admin |
| PUT | `/api/alerts/{id}` | Update alert rule | Admin |
| GET | `/api/alerts/logs` | Riwayat notifikasi terkirim | Admin |

### 7.1 Skema Pesan WebSocket `/ws/live` (konkret, bukan cuma "push update")

```json
// Server -> Client, tiap ada event baru
{
  "type": "counter_update",
  "camera_id": "cam_001",
  "direction": "in",
  "timestamp": "2026-08-02T14:35:12+07:00",
  "today_totals": { "in": 128, "out": 115 }
}

// Server -> Client, tiap kamera ganti status
{
  "type": "camera_status",
  "camera_id": "cam_001",
  "status": "offline"
}

// Client -> Server, saat pertama connect (sinkron ulang state)
{ "type": "sync_request" }

// Server -> Client, balasan sync_request
{
  "type": "sync_response",
  "cameras": [
    { "camera_id": "cam_001", "today_in": 128, "today_out": 115, "status": "online" }
  ]
}
```

---

## 8. REQUIREMENT FUNGSIONAL DETAIL: REAL-TIME (dua jalur)

**Jalur counter (WebSocket):**
1. `CameraWorker` mendeteksi event lintas-garis → tulis ke DB via `EventRepository` → publish ke `EventBus` (in-process pub/sub, atau Redis pub/sub kalau nanti multi-instance)
2. `websocket.py` subscribe ke `EventBus`, broadcast ke semua koneksi dashboard aktif dalam format di Bagian 7.1
3. Saat client baru connect, kirim `sync_response` dulu supaya dashboard tidak nunggu kosong sampai event berikutnya

**Jalur video (MJPEG):**
1. `CameraWorker` setelah anotasi frame (box+garis+counter), panggil `FrameBroker.publish()`
2. Endpoint `/api/stream/{camera_id}` adalah generator tanpa henti yang ambil frame terbaru dari `FrameBroker.get_jpeg_bytes()` dan kirim sebagai `multipart/x-mixed-replace`
3. **Streaming tidak boleh menunggu/blocking capture loop utama** — kalau frame belum siap, kirim frame terakhir yang tersedia, jangan freeze seluruh proses deteksi

---

## 9. SPESIFIKASI LIVE VIDEO STREAMING (detail teknis)

- Resolusi stream ke dashboard: turunkan ke lebar ±640px (deteksi tetap jalan di resolusi asli/lebih tinggi untuk akurasi — dua pipeline resolusi dari 1 sumber frame).
- Frame rate stream: cukup 8-10 FPS untuk kebutuhan monitoring visual (bukan 30 FPS) — hemat bandwidth signifikan, mata manusia tetap nyaman untuk keperluan pengawasan.
- Overlay yang wajib digambar di frame sebelum di-stream: bounding box tiap orang terdeteksi, garis virtual, angka counter in/out hari ini (di pojok frame).
- Dashboard menampilkan **grid video semua kamera** di halaman Overview (mis. 2x2 kalau 4 kamera), tiap kamera bisa diklik untuk full-screen.
- Token stream: JWT jangka pendek khusus video (terpisah dari access token API biasa), supaya URL stream tidak bisa dipakai ulang tanpa batas kalau ter-share tidak sengaja.
- Batasi maksimal viewer bersamaan per kamera (konfigurasi, default 5) di level `FrameBroker`/endpoint, supaya satu toko dengan koneksi terbatas tidak kolaps kalau banyak yang buka dashboard sekaligus.

---

## 10. SPESIFIKASI ANALITIK LANJUTAN (jam tersibuk + prediksi tren)

### 10.1 Heatmap Jam Tersibuk
- Sumber data: tabel `HourlyAggregate`, diisi oleh scheduled job tiap jam (bukan dihitung on-the-fly dari jutaan baris `Event` setiap dashboard dibuka).
- Output: grid 7 (hari) x 24 (jam), tiap sel = rata-rata pengunjung pada slot itu selama `trailing_days` terakhir (default 28 hari).
- Visualisasi dashboard: heatmap warna (semakin gelap/pekat = semakin ramai), plus daftar "3 jam tersibuk" dan "3 jam paling sepi" dalam teks agar mudah dibaca cepat (berguna untuk atur jadwal staf).

### 10.2 Prediksi Tren Kunjungan
- **Metode**: Exponential Smoothing dengan seasonality mingguan (Holt-Winters, `statsmodels.tsa.holtwinters.ExponentialSmoothing`, `seasonal_periods=7`). Ini metode statistik klasik yang cocok untuk pola trafik toko yang berulang mingguan (weekday vs weekend) — **bukan** deep learning, karena data satu toko terlalu kecil untuk itu, dan metode ini jauh lebih transparan/predictable.
- **Syarat minimum**: minimal 21 hari data historis (`TrendForecaster.MIN_DAYS_REQUIRED`). Kalau belum cukup, API **wajib** mengembalikan `insufficient_data: true` dan pesan jujur seperti "Butuh data 21 hari, saat ini baru 8 hari" — **dilarang keras menampilkan angka prediksi seolah-olah valid padahal datanya belum cukup**.
- Output prediksi harus menyertakan rentang kepercayaan (`confidence_low`/`confidence_high`), bukan cuma satu angka pasti — supaya user paham ini perkiraan, bukan kepastian.
- Re-train/recalculate model tiap malam (scheduled job), bukan tiap kali endpoint dipanggil (mahal secara komputasi kalau real-time).
- Dashboard menampilkan grafik: garis historis aktual + garis prediksi (dengan area bayangan untuk rentang kepercayaan) menyambung di ujung grafik historis.

### 10.3 Perbandingan Periode
- Endpoint `/api/analytics/comparison`: hitung persentase perubahan (hari ini vs hari sama minggu lalu; minggu ini vs minggu lalu) langsung dari `HourlyAggregate`/`DailyAggregate`, tampil di kartu ringkas dashboard ("+12% dibanding minggu lalu").

---

## 11. SPESIFIKASI DASHBOARD (final, 4 halaman)

**Halaman 1 — Overview**
- Grid video live semua kamera (dengan overlay), klik untuk fullscreen
- Total pengunjung hari ini (in/out/net), update instan via WebSocket
- Kartu perbandingan singkat ("+12% vs minggu lalu")
- Status tiap kamera (online/offline/reconnecting)

**Halaman 2 — Riwayat**
- Grafik tren harian/mingguan (data aktual)
- Filter kamera & rentang tanggal, ekspor CSV

**Halaman 3 — Analitik Lanjutan** (NEW)
- Heatmap jam tersibuk (grid 7x24)
- Daftar jam tersibuk/tersepi dalam teks
- Grafik prediksi tren (historis + proyeksi + rentang kepercayaan), atau pesan jujur kalau data belum cukup

**Halaman 4 — Pengaturan** (admin)
- Kelola kamera (tambah/edit garis via klik di preview, hapus)
- Kelola alert rule (kamera offline, target harian tercapai, dst) + riwayat notifikasi terkirim

**Prinsip desain (tetap berlaku dari v1):** dashboard operasional yang dibuka berulang kali per hari dari HP — prioritaskan keterbacaan angka/status, kontras tinggi, responsif mobile, hindari palet "AI generik" tanpa alasan, state kosong harus mengarahkan aksi.

---

## 12. TESTING (lengkap, v1 + tambahan)

*(semua test v1 tetap berlaku)*
- `test_peak_hour_analyzer.py`: dengan data historis sintetis yang polanya diketahui (mis. selalu ramai jam 18-20), pastikan `get_top_busy_hours` mendeteksi jam itu dengan benar.
- `test_trend_forecaster.py`: (a) dengan data < 21 hari, pastikan raise `InsufficientDataError`; (b) dengan data sintetis berpola musiman jelas, pastikan prediksi arah trennya masuk akal (bukan cek angka exact, cek arah & rentang wajar).
- Test streaming: simulasikan `FrameBroker` tanpa frame baru masuk beberapa detik, pastikan endpoint tetap kirim frame terakhir, bukan hang/error.
- Test beban: simulasi 5+ koneksi stream bersamaan ke 1 kamera, pastikan sistem menolak dengan pesan jelas (bukan crash) setelah batas viewer.

---

## 13. URUTAN EKSEKUSI (revisi, tambahan tahap streaming & analitik)

1. Setup struktur folder & `requirements.txt`
2. Layer database + Alembic migration awal (termasuk semua tabel baru)
3. `DetectorInterface`, `YoloV8Detector`, `EntryExitCounter` + unit test
4. `CameraWorker` + `CameraManager`, uji 1 video file
5. `FrameBroker` + endpoint `/api/stream/{camera_id}` (MJPEG), uji video live tampil di browser sederhana dulu (sebelum masuk dashboard penuh)
6. Security layer (JWT, hashing, enkripsi kredensial, token khusus stream)
7. REST API + WebSocket (jalur counter) + skema pesan Bagian 7.1
8. `APScheduler` job: agregasi `HourlyAggregate` tiap jam
9. `PeakHourAnalyzer` + endpoint heatmap + unit test
10. `TrendForecaster` (Holt-Winters) + endpoint forecast + unit test (termasuk kasus data kurang)
11. `NotificationService` + `AlertRule` + integrasi Telegram bot
12. Frontend: 4 halaman dashboard (Overview dengan grid video, Riwayat, Analitik Lanjutan, Pengaturan)
13. Uji end-to-end dengan ≥2 kamera simulasi (2 video file diputar sebagai "kamera")
14. `README.md` lengkap: install, tambah kamera, setup Telegram bot, cara jalankan via Docker
15. Review checklist Bagian 3 (Non-Fungsional) satu per satu

---

## 14. DEFINITION OF DONE (revisi)

- [ ] Semua endpoint Bagian 7 berfungsi + terdokumentasi otomatis (Swagger)
- [ ] Video live tiap kamera tampil di dashboard dengan overlay box+garis+counter
- [ ] Counter di dashboard update tanpa refresh, delay < 2 detik dari event nyata
- [ ] Heatmap jam tersibuk menampilkan data yang masuk akal dari histori
- [ ] Prediksi tren menampilkan rentang kepercayaan, dan menampilkan pesan jujur (bukan angka palsu) kalau data < 21 hari
- [ ] Alert Telegram terkirim saat kondisi rule terpenuhi (uji manual: matikan 1 kamera, pastikan notifikasi masuk)
- [ ] Kredensial kamera & token stream tidak pernah plaintext di log/DB
- [ ] 1 kamera mati tidak mematikan kamera lain maupun video/counter kamera lain
- [ ] Semua unit + integration test Bagian 12 lulus
- [ ] `docker-compose up` menjalankan seluruh sistem dari nol (termasuk scheduler job)
- [ ] README cukup lengkap untuk orang lain setup ulang dari nol tanpa tanya balik