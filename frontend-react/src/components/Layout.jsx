import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore, useWsStore } from '../store'
import styles from './Layout.module.css'

const NAV = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.25"/>
      </svg>
    ),
    live: true,
  },
  {
    to: '/cameras',
    label: 'Kamera',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M1 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5Z" stroke="currentColor" strokeWidth="1.25"/>
        <path d="m10 7.5 4-2v5l-4-2" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    to: '/analytics',
    label: 'Analitik',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M1 12 5 8l3 3 3-4 3 2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Pengaturan',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.42M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      </svg>
    ),
  },
]

const WS_LABEL = {
  connected:    'Terhubung',
  connecting:   'Menghubungkan...',
  disconnected: 'Terputus',
  error:        'Error koneksi',
}

export default function Layout() {
  const logout   = useAuthStore(s => s.logout)
  const wsStatus = useWsStore(s => s.status)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  function handleLogout() { logout(); navigate('/login') }

  function toggleSidebar(val) {
    const next = typeof val === 'boolean' ? val : !open
    setOpen(next)
    document.body.classList.toggle('sidebar-open', next)
  }

  const links = NAV.map(n => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.to === '/'}
      onClick={() => toggleSidebar(false)}
      className={({ isActive }) => `${styles.navItem}${isActive ? ' ' + styles.active : ''}`}
      onClick={() => setOpen(false)}
    >
      <span className={styles.navIcon}>{n.icon}</span>
      {n.label}
      {n.live && wsStatus === 'connected' && <span className={styles.navLiveDot} />}
    </NavLink>
  ))

  return (
    <div className={styles.root}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${open ? styles.open : ''}`}>
        <div className={styles.logoWrap}>
          <img src="/android-chrome-192x192.png" alt="Ashenta" className={styles.logoMark} />
          <span className={styles.logoName}>Ashenta</span>
          <span className={styles.logoVersion}>v1</span>
        </div>

        <nav className={styles.navSection}>
          <div className={styles.navGroup}>
            <span className={styles.navGroupLabel}>Navigasi</span>
            {links}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={`${styles.wsRow} ${styles[wsStatus] || ''}`}>
            <span className={styles.wsDot} />
            <span className={styles.wsLabel}>{WS_LABEL[wsStatus] || wsStatus}</span>
          </div>
          <button className={styles.logoutItem} onClick={handleLogout}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: .6 }}>
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Keluar
          </button>
        </div>
      </aside>

      {/* Topbar mobile */}
      <div className={styles.topbar}>
        <img src="/android-chrome-192x192.png" alt="Ashenta" className={styles.topbarLogo} />
        <span className={styles.topbarName}>Ashenta</span>
        <div className={`${styles.wsRow} ${styles[wsStatus] || ''}`} style={{ padding: '.2rem .4rem' }}>
          <span className={styles.wsDot} />
        </div>
        <button className={styles.hamburger} onClick={() => toggleSidebar()} aria-label="Menu">
          <span /><span /><span />
        </button>
      </div>

      {/* Overlay */}
      {open && <div className={`${styles.mobileOverlay} ${styles.mobileOverlayOpen}`} onClick={() => toggleSidebar(false)} />}

      {/* Main */}
      <div className={styles.main}>
        <div className={styles.mainInner}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
