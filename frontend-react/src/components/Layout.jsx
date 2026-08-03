import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore, useWsStore } from '../store'
import styles from './Layout.module.css'

const NAV = [
  { to: '/',          label: 'Dashboard' },
  { to: '/cameras',   label: 'Kamera'    },
  { to: '/analytics', label: 'Analitik'  },
  { to: '/settings',  label: 'Pengaturan'},
]

const WS_LABEL = {
  connected:    'Live',
  connecting:   'Menghubungkan...',
  disconnected: 'Terputus',
  error:        'Error',
}

export default function Layout() {
  const logout   = useAuthStore(s => s.logout)
  const wsStatus = useWsStore(s => s.status)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <span className={styles.logo}>Ashenta</span>
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `${styles.navBtn} ${isActive ? styles.active : ''}`
            }
          >
            {n.label}
          </NavLink>
        ))}
        <div className={`${styles.wsStatus} ${styles[wsStatus]}`}>
          <span className={styles.dot} />
          <span>{WS_LABEL[wsStatus] || wsStatus}</span>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>Keluar</button>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
