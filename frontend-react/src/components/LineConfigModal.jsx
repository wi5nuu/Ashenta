import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { getStreamToken, setLineConfig } from '../api'
import { Btn } from './UI'
import styles from './LineConfigModal.module.css'

/**
 * LineConfigModal — draw multiple virtual counting lines on a camera snapshot.
 *
 * Each line is defined by two clicks (A → B). Multiple lines can be added,
 * labelled, and deleted independently. All lines are saved together as an array.
 *
 * Coordinates are normalised 0–1 relative to canvas intrinsic size.
 */

// Distinct colours for up to 5 lines (cycles if more)
const LINE_COLOURS = ['#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa']

function getLineColour(idx) {
  return LINE_COLOURS[idx % LINE_COLOURS.length]
}

// Parse line_config JSON → array of {x1,y1,x2,y2,label?}
function parseExistingLines(lineConfig) {
  if (!lineConfig) return []
  try {
    const parsed = JSON.parse(lineConfig)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object' && 'x1' in parsed) return [parsed]
  } catch (_) {}
  return []
}

export default function LineConfigModal({ open, camera, onClose, onSaved }) {
  const canvasRef = useRef(null)
  const bgRef     = useRef(null)   // background HTMLImageElement
  const [loading,       setLoading]       = useState(false)
  // savedLines: array of fully-defined lines {x1,y1,x2,y2,label,_px:{p1,p2}}
  const [savedLines,    setSavedLines]    = useState([])
  // draftPoints: 0, 1, or 2 canvas-px points for the line being drawn
  const [draftPoints,   setDraftPoints]   = useState([])
  // which line index is selected for label editing (-1 = none)
  const [selectedLine,  setSelectedLine]  = useState(-1)

  // ── Canvas dimensions (intrinsic) ─────────────────────────────────────────
  const canvasW = () => canvasRef.current?.width  || 640
  const canvasH = () => canvasRef.current?.height || 360

  // ── Draw blank placeholder ────────────────────────────────────────────────
  const drawPlaceholder = useCallback((canvas) => {
    const W = 640, H = 360
    canvas.width  = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#1e2a3a'
    ctx.lineWidth = 1
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo((W / 8) * i, 0); ctx.lineTo((W / 8) * i, H); ctx.stroke()
    }
    for (let i = 1; i < 5; i++) {
      ctx.beginPath(); ctx.moveTo(0, (H / 5) * i); ctx.lineTo(W, (H / 5) * i); ctx.stroke()
    }
    ctx.strokeStyle = '#2d3f55'; ctx.lineWidth = 1.5
    ctx.strokeRect(1, 1, W - 2, H - 2)
    ctx.fillStyle = '#3a5070'; ctx.font = '48px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('📷', W / 2, H / 2 - 16)
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#5a7a9a'
    ctx.fillText('Tidak ada frame — klik dua titik untuk menentukan garis', W / 2, H / 2 + 24)
    ctx.textAlign = 'left'
  }, [])

  // ── Load snapshot when modal opens ───────────────────────────────────────
  useEffect(() => {
    if (!open || !camera) return
    setDraftPoints([])
    setSelectedLine(-1)
    bgRef.current = null

    // Restore existing lines converted to canvas-px (will be re-scaled after img loads)
    const existing = parseExistingLines(camera.line_config)

    let cancelled = false
    setLoading(true)

    getStreamToken(camera.id)
      .then(res => {
        if (cancelled) return
        const token = res.data.stream_token
        const snapshotUrl = `/api/v1/stream/${camera.id}/snapshot?token=${encodeURIComponent(token)}`
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          if (cancelled) return
          bgRef.current = img
          setLoading(false)
          const canvas = canvasRef.current
          if (!canvas) return
          canvas.width  = img.naturalWidth  || 640
          canvas.height = img.naturalHeight || 360
          canvas.getContext('2d').drawImage(img, 0, 0)
          // Restore lines in canvas-px using actual canvas dimensions
          const W = canvas.width, H = canvas.height
          setSavedLines(existing.map((lc, i) => ({
            ...lc,
            label: lc.label || `Garis ${i + 1}`,
            _px: {
              p1: { x: lc.x1 * W, y: lc.y1 * H },
              p2: { x: lc.x2 * W, y: lc.y2 * H },
            },
          })))
        }
        img.onerror = () => {
          if (cancelled) return
          setLoading(false)
          const canvas = canvasRef.current
          if (canvas) {
            drawPlaceholder(canvas)
            const W = canvas.width, H = canvas.height
            setSavedLines(existing.map((lc, i) => ({
              ...lc,
              label: lc.label || `Garis ${i + 1}`,
              _px: {
                p1: { x: lc.x1 * W, y: lc.y1 * H },
                p2: { x: lc.x2 * W, y: lc.y2 * H },
              },
            })))
          }
        }
        img.src = snapshotUrl
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
        const canvas = canvasRef.current
        if (canvas) {
          drawPlaceholder(canvas)
          const W = canvas.width, H = canvas.height
          setSavedLines(existing.map((lc, i) => ({
            ...lc,
            label: lc.label || `Garis ${i + 1}`,
            _px: {
              p1: { x: lc.x1 * W, y: lc.y1 * H },
              p2: { x: lc.x2 * W, y: lc.y2 * H },
            },
          })))
        }
      })

    return () => { cancelled = true }
  }, [open, camera?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redraw canvas whenever lines or draft changes ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height

    // Background
    if (bgRef.current) {
      ctx.drawImage(bgRef.current, 0, 0)
    } else {
      ctx.fillStyle = '#0d1117'
      ctx.fillRect(0, 0, W, H)
    }

    // Draw all saved lines
    savedLines.forEach((line, idx) => {
      const colour = getLineColour(idx)
      const { p1, p2 } = line._px
      const isSelected = idx === selectedLine

      // Line
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.strokeStyle = colour
      ctx.lineWidth   = isSelected ? 4 : 2.5
      ctx.setLineDash(isSelected ? [6, 3] : [])
      ctx.stroke()
      ctx.setLineDash([])

      // Points
      ;[p1, p2].forEach((pt, pi) => {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, isSelected ? 9 : 7, 0, Math.PI * 2)
        ctx.fillStyle = pi === 0 ? colour : '#fff'
        ctx.fill()
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 1.5
        ctx.stroke()
      })

      // Arrow at midpoint
      const mx    = (p1.x + p2.x) / 2
      const my    = (p1.y + p2.y) / 2
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.PI / 2
      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(0, -12)
      ctx.lineTo(7, 4)
      ctx.lineTo(-7, 4)
      ctx.closePath()
      ctx.fillStyle = colour
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.restore()

      // Label
      const label = line.label || `L${idx + 1}`
      ctx.font      = `bold ${Math.max(11, W * 0.018)}px monospace`
      ctx.fillStyle = colour
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      ctx.strokeText(label, p1.x + 10, p1.y - 6)
      ctx.fillText(label, p1.x + 10, p1.y - 6)
    })

    // Draw draft line being placed
    if (draftPoints.length >= 1) {
      const colour = getLineColour(savedLines.length)
      const p = draftPoints[0]
      ctx.beginPath()
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
      ctx.fillStyle = colour
      ctx.fill()
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.font = `bold ${Math.max(11, W * 0.018)}px monospace`
      ctx.fillStyle = colour
      ctx.fillText('A', p.x + 10, p.y - 6)
    }
  }, [savedLines, draftPoints, selectedLine])

  // ── Canvas click handler ──────────────────────────────────────────────────
  function handleCanvasClick(e) {
    const canvas = canvasRef.current
    if (!canvas || loading) return

    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top)  * scaleY

    if (draftPoints.length === 0) {
      // First click: start new line
      setDraftPoints([{ x, y }])
      setSelectedLine(-1)
    } else {
      // Second click: complete the line
      const p1 = draftPoints[0]
      const p2 = { x, y }
      const W  = canvasW(), H = canvasH()
      const newLine = {
        x1: p1.x / W, y1: p1.y / H,
        x2: p2.x / W, y2: p2.y / H,
        label: `Garis ${savedLines.length + 1}`,
        _px: { p1, p2 },
      }
      setSavedLines(prev => [...prev, newLine])
      setDraftPoints([])
      setSelectedLine(savedLines.length) // auto-select new line
    }
  }

  function deleteLine(idx) {
    setSavedLines(prev => prev.filter((_, i) => i !== idx))
    setSelectedLine(-1)
  }

  function updateLabel(idx, label) {
    setSavedLines(prev => prev.map((l, i) => i === idx ? { ...l, label } : l))
  }

  function cancelDraft() {
    setDraftPoints([])
  }

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (savedLines.length === 0) throw new Error('Tambahkan minimal satu garis')
      // Strip internal _px before sending
      const lines = savedLines.map(({ _px: _ignored, ...rest }) => rest)
      await setLineConfig(camera.id, { lines })
    },
    onSuccess: () => onSaved(),
  })

  if (!open || !camera) return null

  const draftActive   = draftPoints.length === 1
  const canAddMore    = savedLines.length < 5

  return createPortal(
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>Garis Virtual — {camera.name}</div>
            <p className={styles.subtitle}>
              Klik titik <strong style={{ color: '#38bdf8' }}>A</strong> lalu titik{' '}
              <strong style={{ color: '#fff' }}>B</strong> untuk membuat garis counting.
              Bisa tambah hingga 5 garis. Klik garis untuk memilih &amp; edit label.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Tutup">✕</button>
        </div>

        {/* Canvas */}
        <div className={styles.canvasWrap}>
          {loading && (
            <div className={styles.canvasLoader}>
              <span className={styles.spinner} />
              Memuat snapshot kamera...
            </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className={!loading ? styles.canvas : styles.canvasHidden}
            style={{ cursor: loading ? 'default' : 'crosshair' }}
          />
        </div>

        {/* Status bar */}
        <div className={`${styles.status} ${
          draftActive        ? styles.statusProgress :
          savedLines.length  ? styles.statusReady    :
          styles.statusWaiting
        }`}>
          <span className={styles.statusDot} />
          <span className={styles.statusText}>
            {loading        && 'Memuat snapshot...'}
            {!loading && draftActive  && 'Klik titik B untuk menyelesaikan garis'}
            {!loading && !draftActive && savedLines.length === 0 && 'Klik frame untuk menentukan titik A garis pertama'}
            {!loading && !draftActive && savedLines.length > 0  && (
              <span className={styles.statusReadyText}>
                {savedLines.length} garis terdefinisi
                {canAddMore ? ' — klik frame untuk tambah garis baru' : ' (maks 5 garis)'}
              </span>
            )}
          </span>
          {draftActive && (
            <button className={styles.cancelDraftBtn} onClick={cancelDraft}>Batal</button>
          )}
        </div>

        {/* Line list */}
        {savedLines.length > 0 && (
          <div className={styles.lineList}>
            {savedLines.map((line, idx) => (
              <div
                key={idx}
                className={`${styles.lineItem} ${selectedLine === idx ? styles.lineItemSelected : ''}`}
                onClick={() => setSelectedLine(idx === selectedLine ? -1 : idx)}
              >
                <span
                  className={styles.lineColourDot}
                  style={{ background: getLineColour(idx) }}
                />
                <input
                  className={styles.lineLabelInput}
                  value={line.label || `Garis ${idx + 1}`}
                  onChange={e => { e.stopPropagation(); updateLabel(idx, e.target.value) }}
                  onClick={e => e.stopPropagation()}
                  placeholder={`Garis ${idx + 1}`}
                  maxLength={30}
                />
                <span className={styles.lineCoords}>
                  ({Math.round(line.x1 * 100)}%,{Math.round(line.y1 * 100)}%) →
                  ({Math.round(line.x2 * 100)}%,{Math.round(line.y2 * 100)}%)
                </span>
                <button
                  className={styles.deleteLineBtn}
                  onClick={e => { e.stopPropagation(); deleteLine(idx) }}
                  title="Hapus garis ini"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {saveMut.isError && (
          <div className={styles.saveError}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {saveMut.error?.message || 'Gagal menyimpan garis'}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <Btn variant="outline" onClick={() => { setSavedLines([]); setDraftPoints([]); setSelectedLine(-1) }}>
            Reset Semua
          </Btn>
          <Btn variant="outline" onClick={onClose}>Batal</Btn>
          <Btn
            variant="primary"
            disabled={savedLines.length === 0 || draftActive}
            loading={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            Simpan {savedLines.length > 0 ? `(${savedLines.length} Garis)` : ''}
          </Btn>
        </div>
      </div>
    </div>,
    document.body
  )
}
