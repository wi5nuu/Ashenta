import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import { login } from '../api'
import { Btn, FormGroup } from '../components/UI'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const setToken = useAuthStore(s => s.setToken)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!username || !password) { setError('Username dan password wajib diisi.'); return }
    setLoading(true)
    try {
      const res = await login(username, password)
      setToken(res.data.access_token)
      navigate('/')
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Username atau password salah.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoArea}>
          <img src="/android-chrome-192x192.png" alt="Ashenta" className={styles.logoMark} />
          <span className={styles.logoName}>Ashenta</span>
        </div>

        <h2 className={styles.heading}>Masuk ke akun Anda</h2>
        <p className={styles.sub}>Platform analitik pengunjung berbasis AI</p>

        <form className={styles.form} onSubmit={handleLogin}>
          <FormGroup label="Username">
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Masukkan username"
              autoComplete="username"
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Password">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </FormGroup>

          {error && (
            <div className={styles.error}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <Btn variant="primary" className={styles.submitBtn} loading={loading} type="submit">
            Masuk
          </Btn>
        </form>

        <div className={styles.footer}>
          Ashenta &copy; {new Date().getFullYear()}
        </div>
      </div>
    </div>
  )
}
