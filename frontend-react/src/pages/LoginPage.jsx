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
      setError(typeof err === 'string' ? err : 'Login gagal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleLogin}>
        <h2 className={styles.title}>Ashenta</h2>
        <p className={styles.sub}>Sistem Deteksi &amp; Analitik Pengunjung Toko</p>
        <FormGroup label="Username">
          <input value={username} onChange={e => setUsername(e.target.value)}
            placeholder="admin" autoComplete="username" autoFocus />
        </FormGroup>
        <FormGroup label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="current-password" />
        </FormGroup>
        {error && <div className={styles.error}>{error}</div>}
        <Btn variant="primary" className={styles.fullBtn} loading={loading} type="submit">
          Masuk
        </Btn>
      </form>
    </div>
  )
}
