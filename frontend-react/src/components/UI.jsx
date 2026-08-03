import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './UI.module.css'

/* ── Card ─────────────────────────────────────────────────────────────────── */
export function Card({ children, className = '', style }) {
  return <div className={`${styles.card} ${className}`} style={style}>{children}</div>
}

export function CardTitle({ children, icon }) {
  return (
    <div className={styles.cardTitle}>
      {icon && <span style={{ opacity: .55 }}>{icon}</span>}
      {children}
    </div>
  )
}

/* ── Button ───────────────────────────────────────────────────────────────── */
export function Btn({ children, variant = 'outline', size, loading = false, className = '', ...props }) {
  const sizeClass = size ? styles[size] : ''
  return (
    <button
      className={`${styles.btn} ${styles[variant] || ''} ${sizeClass} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className={styles.spinner} /> : children}
    </button>
  )
}

/* ── Badge ────────────────────────────────────────────────────────────────── */
export function Badge({ status }) {
  const map = {
    active:   [styles.badgeActive,   'Aktif'],
    inactive: [styles.badgeInactive, 'Nonaktif'],
    error:    [styles.badgeError,    'Error'],
  }
  const [cls, label] = map[status] || map.inactive
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

/* ── Modal ────────────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, footer, maxWidth = 480 }) {
  const overlayRef = useRef(null)
  const modalRef   = useRef(null)

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    document.body.classList.add('modal-open')
    return () => document.body.classList.remove('modal-open')
  }, [open])

  // Focus first focusable element
  useEffect(() => {
    if (!open || !modalRef.current) return
    const focusable = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length) focusable[0].focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={e => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={modalRef} className={styles.modal} style={{ maxWidth }}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.modalClose} onClick={onClose} aria-label="Tutup modal">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* ── FormGroup ────────────────────────────────────────────────────────────── */
export function FormGroup({ label, children, error, hint }) {
  return (
    <div className={styles.formGroup}>
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <div className={styles.formHint}>{hint}</div>}
      {error && <div className={styles.fieldError}>{error}</div>}
    </div>
  )
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
export function Skeleton({ height = 32, width = '100%', style = {} }) {
  return <span className={styles.skeleton} style={{ height, width, display: 'block', ...style }} />
}

/* ── StatCard ─────────────────────────────────────────────────────────────── */
export function StatCard({ title, value, sub, loading }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {loading
        ? <Skeleton height={36} width={80} />
        : <div className={styles.statVal}>{value ?? '–'}</div>
      }
      {sub && !loading && <div className={styles.statSub}>{sub}</div>}
    </Card>
  )
}

/* ── LiveDot ──────────────────────────────────────────────────────────────── */
export function LiveDot() {
  return <span className={styles.liveDot} aria-label="Live" />
}

/* ── Tag ──────────────────────────────────────────────────────────────────── */
export function Tag({ children }) {
  return <span className={styles.tag}>{children}</span>
}

/* ── Divider ──────────────────────────────────────────────────────────────── */
export function Divider() {
  return <div className={styles.divider} />
}

/* ── Alert ────────────────────────────────────────────────────────────────── */
export function Alert({ type = 'info', children }) {
  const cls  = { success: styles.alertSuccess, danger: styles.alertDanger, warn: styles.alertWarn, info: styles.alertInfo }
  const icon = { success: '✓', danger: '✕', warn: '!', info: 'i' }
  return (
    <div className={`${styles.alert} ${cls[type]}`} role="alert">
      <span className={styles.alertIcon}>{icon[type]}</span>
      <span>{children}</span>
    </div>
  )
}
