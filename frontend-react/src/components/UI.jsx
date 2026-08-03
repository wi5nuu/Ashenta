import styles from './UI.module.css'

export function Card({ children, className = '' }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>
}

export function CardTitle({ children }) {
  return <div className={styles.cardTitle}>{children}</div>
}

export function Btn({ children, variant = 'outline', size = 'md', loading = false, className = '', ...props }) {
  return (
    <button
      className={`${styles.btn} ${styles[variant]} ${styles[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className={styles.spinner} /> : children}
    </button>
  )
}

export function Badge({ status }) {
  const cls = { active: styles.badgeActive, inactive: styles.badgeInactive, error: styles.badgeError }
  return <span className={`${styles.badge} ${cls[status] || styles.badgeInactive}`}>{status}</span>
}

export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>{title}</h3>
        {children}
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  )
}

export function FormGroup({ label, children, error }) {
  return (
    <div className={styles.formGroup}>
      {label && <label>{label}</label>}
      {children}
      {error && <div className={styles.fieldError}>{error}</div>}
    </div>
  )
}

export function Skeleton({ height = 40, width = '100%', style = {} }) {
  return <div className={styles.skeleton} style={{ height, width, ...style }} />
}

export function StatCard({ title, value, loading }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {loading
        ? <Skeleton height={36} width={80} />
        : <div className={styles.statVal}>{value ?? '–'}</div>
      }
    </Card>
  )
}

export function LiveDot() {
  return <span className={styles.liveDot} />
}
