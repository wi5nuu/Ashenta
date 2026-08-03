import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getStreamToken, setLineConfig } from '../api'
import { Btn } from './UI'

/**
 * LineConfigModal — draw a virtual counting line on a live camera frame.
 * Click two points to define the line. Coordinates are normalised to 0–1.
 */
export default function LineConfigModal({ open, camera, onClose, onSaved }) {
  const canvasRef = useRef(null)
  const bgRef     = useRef(null)   // stores the background HTMLImageElement
  const [points,  setPoints]  = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // Reset state and fetch frame each time modal opens
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
        const img   = new Image()
        img.crossOrigin = 'anonymous'

        img.onload = () => {
          if (cancelled) return
          bgRef.current = img
          setLoading(false)

          // Draw background immediately
          const canvas = canvasRef.current
          if (!canvas) return
          canvas.width  = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d').drawImage(img, 0, 0)

          // Restore existing line_config if any
          if (camera.line_config) {
            try {
              const lc = JSON.parse(camera.line_config)
              // Convert normalised → display coords (canvas is CSS-scaled)
              const dw = canvas.offsetWidth  || canvas.width
              const dh = canvas.offsetHeight || canvas.height
              setPoints([
                { x: lc.x1 * dw, y: lc.y1 * dh },
                { x: lc.x2 * dw, y: lc.y2 * dh },
              ])
            } catch (_) { /* ignore malformed */ }
          }
        }

        img.onerror = () => {
          if (cancelled) return
          setLoading(false)
          setError('Gagal memuat frame. Pastikan kamera aktif.')
        }

        img.src = `/api/v1/stream/${camera.id}/mjpeg?token=${encodeURIComponent(token)}`
        // Abort after 5s if stream doesn't deliver a frame
        setTimeout(() => { if (!img.complete) { img.src = ''; } }, 5000)
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false)
          setError('Gagal mendapatkan token stream.')
        }
      })

    return () => { cancelled = true }
  }, [open, camera?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw overlay whenever points change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bgRef.current) return

    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height

    // Restore background
    ctx.drawImage(bgRef.current, 0, 0)

    if (points.length === 0) return

    // Convert display-px → canvas-px
    const sx = W / (canvas.offsetWidth  || W)
    const sy = H / (canvas.offsetHeight || H)
    const p  = points.map(pt => ({ x: pt.x * sx, y: pt.y * sy }))

    // Point A
    ctx.beginPath()
    ctx.arc(p[0].x, p[0].y, 8, 0, Math.PI * 2)
    ctx.fillStyle   = '#38bdf8'
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth   = 2
    ctx.stroke()

    if (p.length < 2) return

    // Line
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
    ctx.font      = `bold ${Math.max(12, W * 0.02)}px monospace`
    ctx.fillStyle = '#38bdf8'
    ctx.fillText('A (IN)',  p[0].x + 12, p[0].y - 8)
    ctx.fillStyle = '#f472b6'
    ctx.fillText('B (OUT)', p[1].x + 12, p[1].y + 18)
  }, [points])

  function handleCanvasClick(e) {
    const canvas = canvasRef.current
    if (!canvas || loading) return
    const rect = canvas.getBoundingClientRect()
    const x    = e.clientX - rect.left
    const y    = e.clientY - rect.top
    setPoints(prev => prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }])
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (points.length !== 2) throw new Error('Tentukan dua titik terlebih dahulu')
      const canvas = canvasRef.current
      const dw     = canvas?.offsetWidth  || 640
      const dh     = canvas?.offsetHeight || 360
      await setLineConfig(camera.id, {
        x1: points[0].x / dw,
        y1: points[0].y / dh,
        x2: points[1].x / dw,
        y2: points[1].y / dh,
      })
    },
    onSuccess: () => onSaved(),
    onError:   (e) => setError(typeof e === 'string' ? e : 'Gagal menyimpan garis'),
  })

  if (!open || !camera) return null

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,.78)',
      zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '1.5rem',
        width: 'min(780px, 96vw)',
        boxShadow: '0 25px 80px rgba(0,0,0,.6)',
      }}>
        {/* Header */}
        <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '.5rem' }}>
          Set Garis Virtual — {camera.name}
        </div>
        <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.9rem', lineHeight: 1.5 }}>
          Klik titik <strong style={{ color: '#38bdf8' }}>A</strong> lalu titik{' '}
          <strong style={{ color: '#f472b6' }}>B</strong> di atas frame untuk menentukan garis counting.
          Orang yang menyeberangi dari sisi A ke B dihitung sebagai <strong>masuk (IN)</strong>.
          Klik lagi untuk menggambar ulang.
        </p>

        {/* Canvas area */}
        <div style={{
          position: 'relative',
          background: '#0f172a',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: '1rem',
          minHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: '.85rem', zIndex: 2,
              background: '#0f172a',
            }}>
              Memuat frame kamera...
            </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              cursor: 'crosshair',
              borderRadius: 8,
              opacity: loading ? 0 : 1,
            }}
          />
        </div>

        {/* Status */}
        <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.5rem' }}>
          {points.length === 0 && 'Klik pada frame untuk menentukan titik A (IN)'}
          {points.length === 1 && 'Klik lagi untuk menentukan titik B (OUT)'}
          {points.length === 2 && (
            <span style={{ color: '#4ade80' }}>
              Garis siap — klik "Simpan" atau klik frame untuk menggambar ulang
            </span>
          )}
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: '.82rem', marginBottom: '.75rem' }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
          <Btn variant="outline" onClick={() => { setPoints([]); setError('') }}>
            Reset
          </Btn>
          <Btn variant="outline" onClick={onClose}>
            Batal
          </Btn>
          <Btn
            variant="primary"
            disabled={points.length !== 2}
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
