import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getStreamToken, setLineConfig } from '../api'
import { Btn } from './UI'
import styles from './LineConfigModal.module.css'

/**
 * LineConfigModal — draw a virtual counting line on a camera snapshot.
 *
 * Uses GET /stream/{id}/snapshot (returns a static JPEG) instead of the
 * MJPEG stream, so the browser can load it as a normal <img> and we can
 * draw on top of it with a <canvas>.
 *
 * Click two points to define the line. Coordinates are normalised 0–1
 * relative to the canvas intrinsic size (= image pixel size).
 */
export default function LineConfigModal({ open, camera, onClose, onSaved }) {
  const canvasRef = useRef(null)
  const bgRef     = useRef(null)   // background HTMLImageElement
  const [points,  setPoints]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // ── Load snapshot each time the modal opens ──────────────────────────────
  useEffect(() => {
    if (!open || !camera) return
    setError('')
    setPoints([])
    bgRef.current = null

    let cancelled = false
    setLoading(true)

    getStreamToken(camera.id)
      .then(res => {
        if (cancelled) return
        const token = res.data.stream_token

        // Use the static JPEG snapshot endpoint — NOT the MJPEG stream.
        // Browsers cannot load a multipart/x-mixed-replace stream as an img src.
        const snapshotUrl =
          `/api/v1/stream/${camera.id}/snapshot?token=${encodeURIComponent(token)}`

        const img = new Image()
        img.crossOrigin = 'anonymous'

        img.onload = () => {
          if (cancelled) return
          bgRef.current = img
          setLoading(false)

          const canvas = canvasRef.current
          if (!canvas) return
          // Set canvas intrinsic size = image pixel size for 1:1 coordinate mapping
          canvas.width  = img.naturalWidth  || 640
          canvas.height = img.naturalHeight || 360
          canvas.getContext('2d').drawImage(img, 0, 0)

          // Restore existing line_config if any
          if (camera.line_config) {
            try {
              const lc = JSON.parse(camera.line_config)
              // line_config stores normalised coords (0–1); convert to canvas px
              setPoints([
                { x: lc.x1 * canvas.width,  y: lc.y1 * canvas.height },
                { x: lc.x2 * canvas.width,  y: lc.y2 * canvas.height },
              ])
            } catch (_) { /* ignore malformed */ }
          }
        }

        img.onerror = () => {
          if (cancelled) return
          setLoading(false)
          setError(
            'Frame belum tersedia. Pastikan kamera aktif dan sedang memproses video, lalu coba lagi.'
          )
        }

        img.src = snapshotUrl
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          setError('Gagal mendapatkan token stream.')
        }
      })

    return () => { cancelled = true }
  }, [open, camera?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redraw overlay whenever points change ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bgRef.current) return

    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height

    // Redraw background
    ctx.drawImage(bgRef.current, 0, 0)
    if (points.length === 0) return

    // Points are already in canvas-px (intrinsic space)
    const p = points

    // Point A
    ctx.beginPath()
    ctx.arc(p[0].x, p[0].y, 8, 0, Math.PI * 2)
    ctx.fillStyle   = '#38bdf8'
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth   = 2
    ctx.stroke()

    if (p.length < 2) return

    // Line A→B
    ctx.beginPath()
    ctx.moveTo(p[0].x, p[0].y)
    ctx.lineTo(p[1].x, p[1].y)
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth   = 3
    ctx.setLineDash([10, 5])
    ctx.stroke()
    ctx.setLineDash([])

    // Point B
    ctx.beginPath()
    ctx.arc(p[1].x, p[1].y, 8, 0, Math.PI * 2)
    ctx.fillStyle   = '#f472b6'
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth   = 2
    ctx.stroke()

    // Arrow at midpoint perpendicular to line (shows IN direction)
    const mx    = (p[0].x + p[1].x) / 2
    const my    = (p[0].y + p[1].y) / 2
    const angle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) - Math.PI / 2
    ctx.save()
    ctx.translate(mx, my)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, -14)
    ctx.lineTo(8, 4)
    ctx.lineTo(-8, 4)
    ctx.closePath()
    ctx.fillStyle = '#4ade80'
    ctx.fill()
    ctx.restore()

    // Labels
    ctx.font      = `bold ${Math.max(12, W * 0.022)}px monospace`
    ctx.fillStyle = '#38bdf8'
    ctx.fillText('A (IN)',  p[0].x + 12, p[0].y - 8)
    ctx.fillStyle = '#f472b6'
    ctx.fillText('B (OUT)', p[1].x + 12, p[1].y + 18)
  }, [points])

  // ── Canvas click handler ─────────────────────────────────────────────────
  function handleCanvasClick(e) {
    const canvas = canvasRef.current
    if (!canvas || loading || error) return

    const rect = canvas.getBoundingClientRect()
    // Scale display-px → canvas intrinsic-px
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left)  * scaleX
    const y = (e.clientY - rect.top)   * scaleY

    setPoints(prev => prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }])
  }

  // ── Save mutation ────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (points.length !== 2) throw new Error('Tentukan dua titik terlebih dahulu')
      const canvas = canvasRef.current
      const W = canvas?.width  || 640
      const H = canvas?.height || 360
      // Normalise canvas-px → 0–1 using intrinsic canvas size
      await setLineConfig(camera.id, {
        x1: points[0].x / W,
        y1: points[0].y / H,
        x2: points[1].x / W,
        y2: points[1].y / H,
      })
    },
    onSuccess: () => onSaved(),
    onError:   (e) => setError(typeof e === 'string' ? e : 'Gagal menyimpan garis'),
  })

  if (!open || !camera) return null

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>Set Garis Virtual — {camera.name}</div>
            <p className={styles.subtitle}>
              Klik titik <strong style={{ color: '#38bdf8' }}>A</strong> lalu titik{' '}
              <strong style={{ color: '#f472b6' }}>B</strong> di atas frame untuk menentukan garis counting.
              Orang yang menyeberangi dari sisi <strong>A ke B</strong> dihitung sebagai{' '}
              <strong>masuk (IN)</strong>. Klik lagi untuk menggambar ulang.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Tutup">✕</button>
        </div>

        {/* Canvas area */}
        <div className={styles.canvasWrap}>
          {loading && (
            <div className={styles.canvasLoader}>
              <span className={styles.spinner} />
              Memuat snapshot kamera...
            </div>
          )}

          {!loading && error && (
            <div className={styles.canvasError}>
              <span className={styles.canvasErrorIcon}>&#128247;</span>
              <span className={styles.canvasErrorMsg}>{error}</span>
              <Btn size="sm" variant="outline" onClick={() => {
                setError('')
                setLoading(true)
                // Retry by closing and reopening — trigger useEffect
                bgRef.current = null
                getStreamToken(camera.id)
                  .then(res => {
                    const token = res.data.stream_token
                    const img = new Image()
                    img.crossOrigin = 'anonymous'
                    img.onload = () => {
                      bgRef.current = img
                      setLoading(false)
                      const canvas = canvasRef.current
                      if (!canvas) return
                      canvas.width  = img.naturalWidth  || 640
                      canvas.height = img.naturalHeight || 360
                      canvas.getContext('2d').drawImage(img, 0, 0)
                    }
                    img.onerror = () => {
                      setLoading(false)
                      setError('Frame belum tersedia. Pastikan kamera aktif.')
                    }
                    img.src = `/api/v1/stream/${camera.id}/snapshot?token=${encodeURIComponent(token)}`
                  })
                  .catch(() => { setLoading(false); setError('Gagal mendapatkan token.') })
              }}>
                Coba Lagi
              </Btn>
            </div>
          )}

          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className={(!loading && !error) ? styles.canvas : styles.canvasHidden}
          />
        </div>

        {/* Status */}
        {!error && (
          <div className={`${styles.status} ${
            points.length === 0 ? styles.statusWaiting :
            points.length === 1 ? styles.statusProgress :
            styles.statusReady
          }`}>
            <span className={styles.statusDot} />
            <span className={styles.statusText}>
              {points.length === 0 && !loading && 'Klik pada frame untuk menentukan titik A (IN)'}
              {points.length === 1 && 'Klik lagi untuk menentukan titik B (OUT)'}
              {points.length === 2 && (
                <span className={styles.statusReadyText}>
                  Garis siap — klik "Simpan" atau klik frame untuk menggambar ulang
                </span>
              )}
            </span>
          </div>
        )}

        {saveMut.isError && (
          <div className={styles.saveError}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {typeof saveMut.error === 'string' ? saveMut.error : 'Gagal menyimpan garis'}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <Btn variant="outline" onClick={() => setPoints([])}>Reset</Btn>
          <Btn variant="outline" onClick={onClose}>Batal</Btn>
          <Btn
            variant="primary"
            disabled={points.length !== 2 || !!error}
            loading={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            Simpan Garis
          </Btn>
        </div>
      </div>
    </div>
  )
}
