import { useState, useRef } from 'react'
import { useWsStore } from '../store'
import { getStreamToken } from '../api'
import { Badge } from './UI'
import styles from './CameraCard.module.css'

// ── Status helpers ──────────────────────────────────────────────────────────
const STATUS_LABEL = {
  active:   'Aktif',
  inactive: 'Nonaktif',
  error:    'Error',
}
const STATUS_DESC = {
  active:   'Kamera berjalan dan mendeteksi',
  inactive: 'Kamera dihentikan',
  error:    'Gagal terhubung ke sumber video',
}
const SOURCE_LABEL = {
  rtsp:    'RTSP',
  http:    'HTTP',
  webcam:  'Webcam',
  video:   'Video',
  youtube: 'Online',
}

export default function CameraCard({
  camera,
  counter,
  onEdit,
  onDelete,
  onLineConfig,
  onStart,
  onStop,
  onRestart,
  startLoading,
  stopLoading,
  restartLoading,
  onDetail,
}) {
  const [streaming,   setStreaming]   = useState(false)
  const [streamErr,   setStreamErr]   = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const imgRef = useRef(null)

  const wsStatuses = useWsStore(s => s.cameraStatuses)
  const status   = wsStatuses[camera.id] ?? camera.status ?? 'inactive'
  const cnt      = counter || { in: 0, out: 0, net: 0 }
  const isActive = status === 'active'
  const isError  = status === 'error'
  const hasLine  = !!camera.line_config
  const lineCount = (() => {
    if (!camera.line_config) return 0
    try {
      const parsed = JSON.parse(camera.line_config)
      if (Array.isArray(parsed)) return parsed.length
      if (parsed && typeof parsed === 'object' && 'x1' in parsed) return 1
    } catch (_) {}
    return 0
  })()

  async function startStream() {
    setStreamErr(false)
    try {
      const res = await getStreamToken(camera.id)
      const token = res.data.stream_token
      if (imgRef.current) {
        imgRef.current.src = `/api/v1/stream/${camera.id}/mjpeg?token=${encodeURIComponent(token)}`
        imgRef.current.style.display = 'block'
        setStreaming(true)
      }
    } catch { setStreamErr(true) }
  }

  function stopStream() {
    if (imgRef.current) { imgRef.current.src = ''; imgRef.current.style.display = 'none' }
    setStreaming(false)
    setStreamErr(false)
  }

  // Parse line_config for display
  let lineInfo = null
  if (camera.line_config) {
    try {
      const parsed = JSON.parse(camera.line_config)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const lc = parsed[0]
        lineInfo = parsed.length === 1
          ? `(${Math.round(lc.x1 * 100)}%,${Math.round(lc.y1 * 100)}%) → (${Math.round(lc.x2 * 100)}%,${Math.round(lc.y2 * 100)}%)`
          : `${parsed.length} garis virtual`
      } else if (parsed && typeof parsed === 'object' && 'x1' in parsed) {
        lineInfo = `(${Math.round(parsed.x1 * 100)}%,${Math.round(parsed.y1 * 100)}%) → (${Math.round(parsed.x2 * 100)}%,${Math.round(parsed.y2 * 100)}%)`
      }
    } catch (_) {}
  }

  return (
    <div className={`${styles.card} ${isError ? styles.cardError : ''} ${isActive ? styles.cardActive : ''}`}>

      {/* ── Video area ───────────────────────────────────────────────────── */}
      <div className={styles.video}>
        <img
          ref={imgRef}
          className={styles.img}
          alt={camera.name}
          style={{ display: 'none' }}
          onError={() => { setStreamErr(true); setStreaming(false) }}
        />

        {/* Live pill */}
        {streaming && !streamErr && (
          <div className={styles.livePill}>
            <span className={styles.liveDot} />
            LIVE
          </div>
        )}

        {/* Status badge */}
        <div className={styles.statusBadge}>
          <Badge status={status} />
        </div>

        {/* Overlay when not streaming */}
        {!streaming && (
          <div
            className={styles.videoOverlay}
            onClick={isActive && !streamErr ? startStream : undefined}
            style={{ cursor: isActive && !streamErr ? 'pointer' : 'default' }}
          >
            <div className={`${styles.overlayIconWrap} ${isError ? styles.overlayIconWrapError : ''}`}>
              {streamErr ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={styles.overlayIconError}>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              ) : isError ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={styles.overlayIconError}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              ) : isActive ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={styles.overlayIconActive}>
                  <polygon points="6,4 20,12 6,20" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={styles.overlayIcon}>
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </div>
            <span className={
              streamErr ? styles.overlayTextError :
              isError   ? styles.overlayTextError :
              isActive  ? styles.overlayTextActive :
              styles.overlayText
            }>
              {streamErr    ? 'Stream error'
               : isError    ? STATUS_DESC.error
               : isActive   ? 'Klik untuk live preview'
               : 'Kamera nonaktif'}
            </span>
          </div>
        )}

        {/* Stop stream button (when streaming) */}
        {streaming && (
          <button className={styles.stopStreamBtn} onClick={e => { e.stopPropagation(); stopStream() }} title="Hentikan preview">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Info header ──────────────────────────────────────────────────── */}
      <div className={styles.info} onClick={() => onDetail?.(camera.id)} style={{ cursor: 'pointer' }}>
        <div className={styles.infoLeft}>
          <div className={styles.camName}>{camera.name}</div>
          <div className={styles.camMeta}>
            {camera.location_label && (
              <span className={styles.camLoc}>
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" style={{ opacity: .5, flexShrink: 0 }}>
                  <path d="M8 2a4 4 0 0 0-4 4c0 3 4 8 4 8s4-5 4-8a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                {' '}{camera.location_label}
              </span>
            )}
            <span className={`${styles.camSourceTag} ${styles[`src_${camera.source_type || 'rtsp'}`] || ''}`}>
              {SOURCE_LABEL[camera.source_type] || (camera.source_type || 'RTSP').toUpperCase()}
            </span>
            {/* Line config indicator inline */}
            <span className={`${styles.lineIndicator} ${hasLine ? styles.lineIndicatorSet : ''}`}>
              <span className={styles.lineIndicatorDot} />
              {hasLine ? `Garis terset (${lineCount})` : 'Garis belum diset'}
            </span>
          </div>
        </div>
        {/* Expand details toggle */}
        <button
          className={styles.expandBtn}
          onClick={e => { e.stopPropagation(); setShowDetails(v => !v) }}
          title={showDetails ? 'Sembunyikan detail' : 'Tampilkan detail'}
          aria-expanded={showDetails}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Expanded detail rows ──────────────────────────────────────────── */}
      {showDetails && (
        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Status</span>
            <span className={`${styles.detailVal} ${
              isActive ? styles.detailValSuccess :
              isError  ? styles.detailValDanger  : styles.detailValMuted
            }`}>
              <span className={`${styles.detailDot} ${
                isActive ? styles.dotActive :
                isError  ? styles.dotError  : styles.dotInactive
              }`} />
              {STATUS_LABEL[status] || status} — {STATUS_DESC[status] || ''}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Sumber</span>
            <span className={styles.detailVal}>
              {SOURCE_LABEL[camera.source_type] || camera.source_type || 'RTSP'}
            </span>
          </div>
          {camera.location_label && (
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>Lokasi</span>
              <span className={styles.detailVal}>{camera.location_label}</span>
            </div>
          )}
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Garis virtual</span>
            <span className={`${styles.detailVal} ${hasLine ? styles.detailValSuccess : styles.detailValMuted}`}>
              {hasLine
                ? `${lineCount} garis — ${lineInfo || 'konfigurasi tersimpan'}`
                : 'Belum dikonfigurasi'}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>ID Kamera</span>
            <span className={`${styles.detailVal} ${styles.detailValMono}`}>#{String(camera.id).padStart(4, '0')}</span>
          </div>
        </div>
      )}

      {/* ── Counters ─────────────────────────────────────────────────────── */}
      <div className={styles.counters}>
        <div className={styles.cnt}>
          <span className={`${styles.cntVal} ${styles.cntValIn}`}>{cnt.in}</span>
          <span className={styles.cntLabel}>Masuk</span>
        </div>
        <div className={styles.cnt}>
          <span className={`${styles.cntVal} ${styles.cntValOut}`}>{cnt.out}</span>
          <span className={styles.cntLabel}>Keluar</span>
        </div>
        <div className={styles.cnt}>
          <span className={`${styles.cntVal} ${cnt.net >= 0 ? styles.cntValNet : styles.cntValOut}`}>
            {cnt.net >= 0 ? `+${cnt.net}` : cnt.net}
          </span>
          <span className={styles.cntLabel}>Net</span>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {isError && (
        <div className={styles.errorBanner}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5.13 1.5L.5 10h11L6.87 1.5a1 1 0 0 0-1.74 0Z" stroke="currentColor" strokeWidth="1.1"/>
            <path d="M6 5v2.5M6 9h.01" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
          Gagal terhubung ke sumber video. Klik Restart untuk mencoba ulang.
        </div>
      )}

      {/* ── Actions footer ────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        {/* Line config */}
        <button
          className={`${styles.actionBtn} ${hasLine ? styles.actionBtnLineSet : ''}`}
          onClick={() => onLineConfig?.(camera)}
          title={hasLine ? 'Edit garis virtual' : 'Set garis virtual'}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M2 14L14 2M5 2h7v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Garis
          {hasLine && <span className={styles.actionBtnBadge}>✓</span>}
        </button>

        <div className={styles.actionSep} />

        {/* Edit */}
        <button className={styles.actionBtn} onClick={() => onEdit?.(camera)} title="Edit konfigurasi kamera">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2.5a1.41 1.41 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
          Edit
        </button>

        <div className={styles.actionSep} />

        {/* Start / Stop / Restart */}
        {isError ? (
          <button
            className={`${styles.actionBtn} ${styles.actionBtnWarn}`}
            onClick={() => onRestart?.(camera.id)}
            disabled={restartLoading}
            title="Restart — stop lalu start ulang kamera"
          >
            {restartLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M8 1v4l2.5-2L8 1Z" fill="currentColor"/>
              </svg>
            )}
            Restart
          </button>
        ) : isActive ? (
          <button
            className={`${styles.actionBtn} ${styles.actionBtnStop}`}
            onClick={() => { stopStream(); onStop?.(camera.id) }}
            disabled={stopLoading}
            title="Hentikan kamera worker"
          >
            {stopLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>
              </svg>
            )}
            Hentikan
          </button>
        ) : (
          <button
            className={`${styles.actionBtn} ${styles.actionBtnStart}`}
            onClick={() => onStart?.(camera.id)}
            disabled={startLoading}
            title="Jalankan kamera worker"
          >
            {startLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <polygon points="4,2 14,8 4,14" fill="currentColor"/>
              </svg>
            )}
            Mulai
          </button>
        )}

        {/* More actions menu spacer + delete */}
        <div style={{ marginLeft: 'auto' }} />
        <button
          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
          onClick={() => onDelete?.(camera.id)}
          title="Hapus kamera ini"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"
              stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
