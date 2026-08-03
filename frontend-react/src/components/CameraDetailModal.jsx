import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { getCamera, getStreamToken, getLiveCounter, startCamera, stopCamera } from '../api'
import { useWsStore } from '../store'
import { Btn, Badge } from './UI'
import styles from './CameraDetailModal.module.css'

const TABS = ['Info', 'Garis Virtual', 'Sumber']

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
function fmtDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

export default function CameraDetailModal({ cameraId, open, onClose, onEdit, onDelete, onLineConfig }) {
  const [tab,        setTab]        = useState(0)
  const [streaming,  setStreaming]  = useState(false)
  const [streamErr,  setStreamErr]  = useState(false)
  const [actionLoad, setActionLoad] = useState(null) // 'start'|'stop'|null
  const imgRef = useRef(null)

  const wsStatuses = useWsStore(s => s.cameraStatuses)
  const wsCounters = useWsStore(s => s.counters)

  // Fetch detail kamera (fresh saat modal buka)
  const { data: camera, isLoading, refetch } = useQuery({
    queryKey: ['camera', cameraId],
    queryFn:  () => getCamera(cameraId).then(r => r.data),
    enabled:  open && !!cameraId,
    staleTime: 0,
  })

  // Live counter REST fallback (jika WS belum ada)
  const { data: liveCounter } = useQuery({
    queryKey: ['liveCounter', cameraId],
    queryFn:  () => getLiveCounter(cameraId).then(r => r.data),
    enabled:  open && !!cameraId,
    refetchInterval: 30_000,
  })

  // Reset state saat buka/tutup
  useEffect(() => {
    if (!open) {
      stopStream()
      setTab(0)
      setActionLoad(null)
    }
  }, [open])

  // ESC close
  useEffect(() => {
    if (!open) return
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  // Body scroll lock
  useEffect(() => {
    if (!open) return
    document.body.classList.add('modal-open')
    return () => document.body.classList.remove('modal-open')
  }, [open])

  if (!open) return null

  const status   = (camera && wsStatuses[camera.id]) ?? camera?.status ?? 'inactive'
  const isActive = status === 'active'

  // Counters: WS > REST live > 0
  const wsC   = wsCounters[cameraId]
  const restC = liveCounter
  const cnt = {
    in:  wsC?.in  ?? restC?.entries ?? 0,
    out: wsC?.out ?? restC?.exits   ?? 0,
    net: wsC?.net ?? ((restC?.entries ?? 0) - (restC?.exits ?? 0)),
  }

  // ── Stream helpers ──────────────────────────────────────────────────────
  async function startStream() {
    setStreamErr(false)
    try {
      const res   = await getStreamToken(cameraId)
      const token = res.data.stream_token
      if (imgRef.current) {
        imgRef.current.src = `/api/v1/stream/${cameraId}/mjpeg?token=${encodeURIComponent(token)}`
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

  // ── Camera start/stop ───────────────────────────────────────────────────
  async function handleStart() {
    setActionLoad('start')
    try { await startCamera(cameraId); await refetch() }
    finally { setActionLoad(null) }
  }
  async function handleStop() {
    setActionLoad('stop')
    try { stopStream(); await stopCamera(cameraId); await refetch() }
    finally { setActionLoad(null) }
  }

  const lc = camera?.line_config

  return createPortal(
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modalWrap}>
        {/* ── Modal header ─────────────────────────────────────────────── */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            <span className={styles.modalHeaderTitle}>
              {isLoading ? 'Memuat...' : camera?.name ?? '—'}
            </span>
            {camera && (
              <span className={styles.modalHeaderId}>
                ID #{String(camera.id).padStart(4, '0')}
              </span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Tutup">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.loadingSpinner} />
            <span className={styles.loadingText}>Memuat detail kamera...</span>
          </div>
        ) : camera ? (
          <div className={styles.body}>
            {/* ════ LEFT — Video Panel ══════════════════════════════════ */}
            <div className={styles.videoPanel}>
              {/* Video area */}
              <div
                className={styles.videoWrap}
                onClick={!streaming && isActive && !streamErr ? startStream : undefined}
                style={{ cursor: !streaming && isActive && !streamErr ? 'pointer' : 'default' }}
              >
                <img
                  ref={imgRef}
                  alt={camera.name}
                  style={{ display: 'none', width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={() => { setStreamErr(true); setStreaming(false) }}
                />

                {streaming && !streamErr && (
                  <div className={styles.livePill}>
                    <span className={styles.liveDot} />
                    LIVE
                  </div>
                )}

                <div className={styles.streamBadge}>
                  <Badge status={status} />
                </div>

                {!streaming && (
                  <div className={styles.videoOverlay}>
                    <div
                      className={styles.playBtn}
                      role="button"
                      aria-label={isActive ? 'Mulai live preview' : 'Kamera tidak aktif'}
                    >
                      {streamErr ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      ) : isActive ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="6,4 20,12 6,20"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={styles.playBtnText}>
                      {streamErr ? 'Stream error' : isActive ? 'Klik untuk live' : 'Kamera nonaktif'}
                    </span>
                  </div>
                )}
              </div>

              {/* Video controls */}
              <div className={styles.videoControls}>
                {streaming ? (
                  <>
                    <button className={`${styles.vcBtn} ${styles.vcBtnStop}`} onClick={stopStream}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                        <rect x="2" y="2" width="8" height="8" rx="1"/>
                      </svg>
                      Stop Preview
                    </button>
                    <div className={styles.vcSep} />
                    <span style={{ fontSize: '.65rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 4px var(--success)', display: 'inline-block' }} />
                      Streaming aktif
                    </span>
                  </>
                ) : (
                  <button
                    className={`${styles.vcBtn} ${styles.vcBtnLive}`}
                    onClick={startStream}
                    disabled={!isActive}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="3" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
                      <path d="m8 5 3-1.5V8.5L8 7" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                    </svg>
                    Live Preview
                  </button>
                )}
                <div className={styles.vcDivider} />
                {isActive ? (
                  <button className={styles.vcBtn} onClick={handleStop} disabled={actionLoad === 'stop'}>
                    {actionLoad === 'stop' ? <span className={styles.spinner} /> : (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                        <rect x="2" y="2" width="8" height="8" rx="1"/>
                      </svg>
                    )}
                    Stop Kamera
                  </button>
                ) : (
                  <button className={styles.vcBtn} onClick={handleStart} disabled={actionLoad === 'start'}>
                    {actionLoad === 'start' ? <span className={styles.spinner} /> : (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                        <polygon points="3,2 10,6 3,10"/>
                      </svg>
                    )}
                    Mulai Kamera
                  </button>
                )}
              </div>

              {/* Mini counters */}
              <div className={styles.miniCounters}>
                <div className={styles.miniCnt}>
                  <span className={`${styles.miniCntVal} ${styles.miniCntValIn}`}>{cnt.in}</span>
                  <span className={styles.miniCntLabel}>Masuk</span>
                </div>
                <div className={styles.miniCnt}>
                  <span className={`${styles.miniCntVal} ${styles.miniCntValOut}`}>{cnt.out}</span>
                  <span className={styles.miniCntLabel}>Keluar</span>
                </div>
                <div className={styles.miniCnt}>
                  <span className={`${styles.miniCntVal} ${styles.miniCntValNet}`}>
                    {cnt.net >= 0 ? `+${cnt.net}` : cnt.net}
                  </span>
                  <span className={styles.miniCntLabel}>Net</span>
                </div>
              </div>
            </div>

            {/* ════ RIGHT — Info Panel ═══════════════════════════════════ */}
            <div className={styles.infoPanel}>
              {/* Header */}
              <div className={styles.infoHeader}>
                <div className={styles.infoTitle}>{camera.name}</div>
                <div className={styles.infoMeta}>
                  {camera.location_label && (
                    <span className={styles.infoMetaLoc}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M8 2a4 4 0 0 0-4 4c0 3 4 8 4 8s4-5 4-8a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3"/>
                        <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
                      </svg>
                      {camera.location_label}
                    </span>
                  )}
                  <span className={styles.infoMetaTag}>{camera.source_type || 'rtsp'}</span>
                </div>
              </div>

              {/* Tabs */}
              <div className={styles.tabs}>
                {TABS.map((t, i) => (
                  <button
                    key={t}
                    className={`${styles.tab} ${tab === i ? styles.tabActive : ''}`}
                    onClick={() => setTab(i)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className={styles.tabContent}>
                {/* ── TAB 0: Info ──────────────────────────────────────── */}
                {tab === 0 && (
                  <>
                    <span className={styles.sectionTitle}>Identitas</span>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>ID Kamera</span>
                      <span className={`${styles.rowVal} ${styles.rowValMono}`}>
                        #{String(camera.id).padStart(4, '0')}
                      </span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Nama</span>
                      <span className={styles.rowVal}>{camera.name}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Lokasi</span>
                      <span className={styles.rowVal}>{camera.location_label || '—'}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Tipe Sumber</span>
                      <span className={`${styles.rowVal} ${styles.rowValAccent}`}>
                        {camera.source_type?.toUpperCase() || 'RTSP'}
                      </span>
                    </div>

                    <span className={styles.sectionTitle}>Status & Waktu</span>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Status</span>
                      <span className={styles.statusRow}>
                        <span className={`${styles.statusDot} ${
                          status === 'active'   ? styles.statusDotActive   :
                          status === 'error'    ? styles.statusDotError    :
                          styles.statusDotInactive
                        }`} />
                        <span className={`${styles.rowVal} ${
                          status === 'active' ? styles.rowValSuccess :
                          status === 'error'  ? styles.rowValDanger  : ''
                        }`}>
                          {status === 'active' ? 'Aktif' : status === 'error' ? 'Error' : 'Nonaktif'}
                        </span>
                      </span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Ditambahkan</span>
                      <span className={styles.rowVal}>{fmtDate(camera.created_at)}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Terakhir Aktif</span>
                      <span className={styles.rowVal}>{fmt(camera.last_active_at || camera.updated_at)}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Diperbarui</span>
                      <span className={styles.rowVal}>{fmt(camera.updated_at)}</span>
                    </div>

                    <span className={styles.sectionTitle}>Statistik Hari Ini</span>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Total Masuk</span>
                      <span className={`${styles.rowVal} ${styles.rowValAccent}`}>{cnt.in} orang</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Total Keluar</span>
                      <span className={styles.rowVal}>{cnt.out} orang</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Di Dalam (Net)</span>
                      <span className={`${styles.rowVal} ${cnt.net >= 0 ? styles.rowValSuccess : styles.rowValDanger}`}>
                        {cnt.net >= 0 ? `+${cnt.net}` : cnt.net} orang
                      </span>
                    </div>
                  </>
                )}

                {/* ── TAB 1: Garis Virtual ─────────────────────────────── */}
                {tab === 1 && (
                  <>
                    {lc ? (
                      <>
                        <span className={styles.sectionTitle}>Konfigurasi Garis</span>
                        <div className={styles.linePreview}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.375rem', marginBottom: '.375rem' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 5px var(--success)' }} />
                            <span style={{ fontSize: '.7rem', color: 'var(--success)', fontWeight: 600 }}>Garis dikonfigurasi</span>
                          </div>
                          <div className={styles.linePreviewGrid}>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>Arah masuk</span>
                              <span className={styles.linePreviewValue}>{lc.direction || '—'}</span>
                            </div>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>Offset</span>
                              <span className={styles.linePreviewValue}>{lc.offset ?? '—'}</span>
                            </div>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>P1 X</span>
                              <span className={styles.linePreviewValue}>{lc.x1 ?? lc.p1?.x ?? '—'}</span>
                            </div>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>P1 Y</span>
                              <span className={styles.linePreviewValue}>{lc.y1 ?? lc.p1?.y ?? '—'}</span>
                            </div>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>P2 X</span>
                              <span className={styles.linePreviewValue}>{lc.x2 ?? lc.p2?.x ?? '—'}</span>
                            </div>
                            <div className={styles.linePreviewItem}>
                              <span className={styles.linePreviewKey}>P2 Y</span>
                              <span className={styles.linePreviewValue}>{lc.y2 ?? lc.p2?.y ?? '—'}</span>
                            </div>
                          </div>
                        </div>
                        <div className={styles.row} style={{ marginTop: '.5rem' }}>
                          <span className={styles.rowLabel}>Min Confidence</span>
                          <span className={styles.rowVal}>{lc.min_confidence ? `${(lc.min_confidence * 100).toFixed(0)}%` : '—'}</span>
                        </div>
                        <div className={styles.row}>
                          <span className={styles.rowLabel}>Min Frames</span>
                          <span className={styles.rowVal}>{lc.min_frames ?? '—'}</span>
                        </div>
                      </>
                    ) : (
                      <div className={styles.noLine}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className={styles.noLineIcon}>
                          <path d="M4 20L20 4M7 4h13v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className={styles.noLineText}>
                          Garis virtual belum dikonfigurasi.<br/>
                          Konfigurasi garis diperlukan agar<br/>
                          penghitungan orang berfungsi.
                        </span>
                        <button
                          className={`${styles.vcBtn} ${styles.vcBtnLive}`}
                          style={{ marginTop: '.5rem' }}
                          onClick={() => { onClose(); onLineConfig?.(camera) }}
                        >
                          Konfigurasi Sekarang
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* ── TAB 2: Sumber ────────────────────────────────────── */}
                {tab === 2 && (
                  <>
                    <span className={styles.sectionTitle}>Koneksi</span>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Tipe</span>
                      <span className={`${styles.rowVal} ${styles.rowValAccent}`}>
                        {camera.source_type?.toUpperCase()}
                      </span>
                    </div>
                    {camera.rtsp_url && (
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>URL</span>
                        <span className={`${styles.rowVal} ${styles.rowValMono}`}
                          style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={camera.rtsp_url}>
                          {camera.rtsp_url}
                        </span>
                      </div>
                    )}
                    {camera.webcam_index != null && camera.source_type === 'webcam' && (
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>Indeks Webcam</span>
                        <span className={`${styles.rowVal} ${styles.rowValMono}`}>{camera.webcam_index}</span>
                      </div>
                    )}
                    {camera.video_path && (
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>File Video</span>
                        <span className={`${styles.rowVal} ${styles.rowValMono}`}
                          style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={camera.video_path}>
                          {camera.video_path.split('/').pop() || camera.video_path}
                        </span>
                      </div>
                    )}
                    <span className={styles.sectionTitle}>Model & Deteksi</span>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Model AI</span>
                      <span className={styles.rowVal}>{camera.model_name || 'YOLOv8n'}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Resolusi</span>
                      <span className={styles.rowVal}>{camera.resolution || '—'}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>FPS Target</span>
                      <span className={styles.rowVal}>{camera.fps ?? '—'}</span>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>Confidence Threshold</span>
                      <span className={styles.rowVal}>
                        {camera.confidence_threshold ? `${(camera.confidence_threshold * 100).toFixed(0)}%` : '—'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Footer actions */}
              <div className={styles.footer}>
                <div className={styles.footerLeft}>
                  <Btn variant="outline" size="sm" onClick={() => { onEdit?.(camera); onClose() }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M11.5 2.5a1.41 1.41 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                    </svg>
                    Edit
                  </Btn>
                  <Btn variant="outline" size="sm" onClick={() => { onLineConfig?.(camera); onClose() }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M2 14L14 2M5 2h7v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Garis
                  </Btn>
                </div>
                <div className={styles.footerRight}>
                  <Btn
                    variant="danger"
                    size="sm"
                    onClick={() => { onDelete?.(camera.id); onClose() }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Hapus
                  </Btn>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.loadingWrap}>
            <span className={styles.loadingText}>Kamera tidak ditemukan.</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
