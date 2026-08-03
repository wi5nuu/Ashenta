import { useState, useRef } from 'react'
import { useWsStore } from '../store'
import { getStreamToken } from '../api'
import { Badge } from './UI'
import styles from './CameraCard.module.css'

export default function CameraCard({ camera, counter, onEdit, onDelete, onLineConfig, onStart, onStop, startLoading, stopLoading, onDetail }) {
  const [streaming, setStreaming] = useState(false)
  const [streamErr, setStreamErr] = useState(false)
  const imgRef = useRef(null)

  const wsStatuses = useWsStore(s => s.cameraStatuses)
  const status   = wsStatuses[camera.id] || camera.status
  const cnt      = counter || { in: 0, out: 0, net: 0 }
  const isActive = status === 'active'
  const hasLine  = !!camera.line_config

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

  return (
    <div className={styles.card}>
      {/* ── Video ───────────────────────────────────────────────────────── */}
      <div
        className={styles.video}
        onClick={!streaming && isActive && !streamErr ? startStream : undefined}
        style={{ cursor: !streaming && isActive && !streamErr ? 'pointer' : 'default' }}
      >
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
          <div className={styles.videoOverlay}>
            <div className={styles.overlayIconWrap}>
              {streamErr ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={styles.overlayIconError}>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
              isActive  ? styles.overlayTextActive :
              styles.overlayText
            }>
              {streamErr ? 'Stream tidak tersedia' : isActive ? 'Klik untuk live' : 'Kamera nonaktif'}
            </span>
          </div>
        )}
      </div>

      {/* ── Info ────────────────────────────────────────────────────────── */}
      <div className={styles.info} onClick={() => onDetail?.(camera.id)} style={{ cursor: 'pointer' }}>
        <div className={styles.infoLeft}>
          <div className={styles.camName}>{camera.name}</div>
          <div className={styles.camMeta}>
            {camera.location_label && (
              <span className={styles.camLoc}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ opacity: .5, flexShrink: 0, display: 'inline' }}>
                  <path d="M8 2a4 4 0 0 0-4 4c0 3 4 8 4 8s4-5 4-8a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
                {' '}{camera.location_label}
              </span>
            )}
            <span className={styles.camSourceTag}>{camera.source_type || 'rtsp'}</span>
          </div>
        </div>
      </div>

      {/* ── Counters ────────────────────────────────────────────────────── */}
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
          <span className={`${styles.cntVal} ${styles.cntValNet}`}>{cnt.net >= 0 ? `+${cnt.net}` : cnt.net}</span>
          <span className={styles.cntLabel}>Net</span>
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        {/* Line config indicator */}
        <button className={styles.actionBtn} onClick={() => onLineConfig?.(camera)} title="Konfigurasi garis virtual">
          <div className={`${styles.lineTagDot} ${hasLine ? styles.set : ''}`} />
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M2 14L14 2M5 2h7v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Garis
        </button>

        <div className={styles.actionSep} />

        {/* Edit */}
        <button className={styles.actionBtn} onClick={() => onEdit?.(camera)} title="Edit kamera">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2.5a1.41 1.41 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
          Edit
        </button>

        {/* Start / Stop */}
        {isActive ? (
          <button
            className={`${styles.actionBtn} ${styles.actionBtnStop}`}
            onClick={() => onStop?.(camera.id)}
            disabled={stopLoading}
            title="Hentikan kamera"
          >
            {stopLoading
              ? <span style={{ width: 10, height: 10, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .5s linear infinite', display: 'inline-block' }} />
              : <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>
                </svg>
            }
            Stop
          </button>
        ) : (
          <button
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={() => onStart?.(camera.id)}
            disabled={startLoading}
            title="Jalankan kamera"
          >
            {startLoading
              ? <span style={{ width: 10, height: 10, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .5s linear infinite', display: 'inline-block' }} />
              : <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <polygon points="4,2 14,8 4,14" fill="currentColor"/>
                </svg>
            }
            Mulai
          </button>
        )}

        <div className={styles.actionSep} />

        {/* Stream toggle */}
        {streaming
          ? <button className={styles.actionBtn} onClick={stopStream} title="Hentikan preview">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor"/>
                <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor"/>
              </svg>
            </button>
          : <button className={styles.actionBtn} onClick={startStream} disabled={!isActive} title="Preview live stream">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="4" width="9" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
                <path d="m10 7 4-2v6l-4-2" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
              </svg>
            </button>
        }

        {/* Delete */}
        <button className={`${styles.actionBtn} ${styles.danger}`} onClick={() => onDelete?.(camera.id)} title="Hapus kamera">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
