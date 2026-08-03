import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, changePassword, getUsers, createUser, deleteUser } from '../api'
import { Card, Btn, FormGroup, Modal, Alert, Skeleton } from '../components/UI'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const qc = useQueryClient()

  const [pw,    setPw]    = useState({ current: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState(null)

  const pwMut = useMutation({
    mutationFn: () => changePassword({ current_password: pw.current, new_password: pw.next }),
    onSuccess: () => {
      setPwMsg({ ok: true, text: 'Password berhasil diubah.' })
      setPw({ current: '', next: '', confirm: '' })
    },
    onError: (e) => setPwMsg({ ok: false, text: typeof e === 'string' ? e : 'Gagal mengubah password.' }),
  })

  function submitPw(e) {
    e.preventDefault()
    setPwMsg(null)
    if (!pw.current || !pw.next) return setPwMsg({ ok: false, text: 'Semua field wajib diisi.' })
    if (pw.next !== pw.confirm) return setPwMsg({ ok: false, text: 'Konfirmasi password tidak cocok.' })
    if (pw.next.length < 8) return setPwMsg({ ok: false, text: 'Password minimal 8 karakter.' })
    pwMut.mutate()
  }

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe().then(r => r.data),
  })
  const { data: users = [], isLoading: uLoad } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
    enabled: me?.role === 'admin',
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'viewer' })
  const [userMsg, setUserMsg] = useState(null)
  const [delId,   setDelId]   = useState(null)

  function validateNewUser() {
    if (!newUser.username.trim()) return 'Username wajib diisi.'
    if (newUser.username.trim().length < 3) return 'Username minimal 3 karakter.'
    if (!/^[a-zA-Z0-9_]+$/.test(newUser.username.trim())) return 'Username hanya boleh huruf, angka, dan underscore.'
    if (!newUser.email.trim()) return 'Email wajib diisi.'
    if (!newUser.password) return 'Password wajib diisi.'
    if (newUser.password.length < 8) return 'Password minimal 8 karakter.'
    return null
  }

  const createMut = useMutation({
    mutationFn: () => {
      const err = validateNewUser()
      if (err) return Promise.reject(err)
      return createUser({
        username: newUser.username.trim(),
        email: newUser.email.trim(),
        password: newUser.password,
        role: newUser.role,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowAdd(false)
      setNewUser({ username: '', email: '', password: '', role: 'viewer' })
      setUserMsg(null)
    },
    onError: (e) => setUserMsg(typeof e === 'string' ? e : 'Gagal membuat user.'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setDelId(null) },
  })

  function initial(u) { return (u || '?').charAt(0).toUpperCase() }

  return (
    <div className={`${styles.page} fadeUp`}>
      <div className={styles.header}>
        <h2 className={styles.title}>Pengaturan</h2>
        <p className={styles.sub}>Kelola akun dan pengguna sistem</p>
      </div>

      {/* Password */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Keamanan</div>
        <Card>
          {me && (
            <div className={styles.profileRow}>
              <div className={styles.avatar}>{initial(me.username)}</div>
              <div className={styles.profileInfo}>
                <div className={styles.profileName}>{me.username}</div>
                <div className={styles.profileEmail}>{me.email || 'Tidak ada email'}</div>
              </div>
              <span className={`${styles.rolePill} ${me.role === 'admin' ? styles.roleAdmin : ''}`}>
                {me.role}
              </span>
            </div>
          )}

          <div className={styles.divider} />

          <form onSubmit={submitPw} className={styles.form}>
            <h4 className={styles.formHead}>Ubah Password</h4>
            <FormGroup label="Password Saat Ini">
              <input type="password" value={pw.current} placeholder="Password lama"
                autoComplete="current-password"
                onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
            </FormGroup>
            <FormGroup label="Password Baru" hint="Minimal 8 karakter">
              <input type="password" value={pw.next} placeholder="Password baru"
                autoComplete="new-password"
                onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
            </FormGroup>
            <FormGroup label="Konfirmasi Password Baru">
              <input type="password" value={pw.confirm} placeholder="Ulangi password baru"
                autoComplete="new-password"
                onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
            </FormGroup>
            {pwMsg && <Alert type={pwMsg.ok ? 'success' : 'danger'}>{pwMsg.text}</Alert>}
            <div style={{ marginTop: '.25rem' }}>
              <Btn variant="primary" type="submit" loading={pwMut.isPending}>
                Simpan Password
              </Btn>
            </div>
          </form>
        </Card>
      </section>

      {/* Users — admin only */}
      {me?.role === 'admin' && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>Pengguna</div>
            <Btn size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              Tambah Pengguna
            </Btn>
          </div>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {uLoad ? (
              <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {[1,2,3].map(i => <Skeleton key={i} height={48} />)}
              </div>
            ) : users.length === 0 ? (
              <div className={styles.emptyUsers}>Belum ada pengguna lain.</div>
            ) : (
              <div>
                {users.map((u, i) => (
                  <div key={u.id}
                    className={styles.userRow}
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div className={styles.avatar} style={{ width: 32, height: 32, fontSize: '.7rem' }}>
                      {initial(u.username)}
                    </div>
                    <div className={styles.userInfo}>
                      <div className={styles.userName}>
                        {u.username}
                        {u.id === me?.id && <span className={styles.youTag}>Anda</span>}
                      </div>
                      <div className={styles.userEmail}>{u.email || '—'}</div>
                    </div>
                    <span className={`${styles.rolePill} ${u.role === 'admin' ? styles.roleAdmin : ''}`}>
                      {u.role}
                    </span>
                    {u.id !== me?.id && (
                      <Btn size="xs" variant="ghost"
                        style={{ color: 'var(--danger)', marginLeft: '.25rem' }}
                        onClick={() => setDelId(u.id)}>
                        Hapus
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Add user modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setUserMsg(null) }}
        title="Tambah Pengguna"
        footer={
          <>
            <Btn variant="outline" onClick={() => { setShowAdd(false); setUserMsg(null) }}>Batal</Btn>
            <Btn variant="primary" loading={createMut.isPending} onClick={() => createMut.mutate()}>
              Buat Akun
            </Btn>
          </>
        }>
        <FormGroup label="Username">
          <input value={newUser.username} placeholder="nama pengguna"
            onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Email">
          <input type="email" value={newUser.email} placeholder="email@contoh.com (opsional)"
            onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Password" hint="Minimal 8 karakter">
          <input type="password" value={newUser.password} placeholder="password awal"
            onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Role">
          <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </FormGroup>
        {userMsg && <Alert type="danger">{userMsg}</Alert>}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!delId} onClose={() => setDelId(null)} title="Hapus pengguna?"
        footer={
          <>
            <Btn variant="outline" onClick={() => setDelId(null)}>Batal</Btn>
            <Btn variant="danger" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(delId)}>Hapus</Btn>
          </>
        }>
        <p style={{ fontSize: '.875rem', color: 'var(--text3)', lineHeight: 1.6 }}>
          Akun ini akan dihapus secara permanen dan tidak dapat dikembalikan.
        </p>
      </Modal>
    </div>
  )
}
