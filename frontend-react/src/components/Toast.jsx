import { createPortal } from 'react-dom'
import { useToastStore } from '../hooks/useToast'
import styles from './Toast.module.css'

const ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  warn: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
      <path d="M8 6v3M8 11h.01" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M8 7v4M8 5h.01" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  ),
}

function ToastItem({ toast }) {
  const remove = useToastStore(s => s.remove)
  return (
    <div className={`${styles.toast} ${styles[toast.type]}`} role="alert">
      <span className={styles.icon}>{ICONS[toast.type]}</span>
      <span className={styles.msg}>{toast.msg}</span>
      <button className={styles.close} onClick={() => remove(toast.id)} aria-label="Tutup">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)
  if (!toasts.length) return null
  return createPortal(
    <div className={styles.container}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>,
    document.body
  )
}
