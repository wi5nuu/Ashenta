import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, changePassword, getUsers, createUser, deleteUser } from '../api'
import { Card, CardTitle, Btn, FormGroup, Modal } from '../components/UI'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const qc = useQueryClient()

  // Password change
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
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

  // User management
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => getMe().then(r => r.data) })
  const { data: users = [], isLoading: uLoad } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
    enabled: me?.role === 'admin',
  })

  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'viewer' })
  const [userMsg, setUserMsg] = useState(null)
  const [delId, setDelId] = useState(null)

  const createMut = useMutation({
    mutationFn: () => createUser(newUser),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowAddUser(false)
      setNewUser({ username: '', email: '', password: '', role: 'viewer' })
      setUserMsg(null)
    },
    onError: (e) => setUserMsg(typeof e === 'string' ? e : 'Gagal membuat user.'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setDelId(null) },
  })

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Pengaturan</h2>

      {/* Change password */}
      <Card className={styles.section}>
        <CardTitle>Ubah Password</CardTitle>
        <form onSubmit={submitPw} className={styles.form}>
          <FormGroup label="Password Saat Ini">
            <input type="password" value={pw.current}
              onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
          </FormGroup>
          <FormGroup label="Password Baru">
            <input type="password" value={pw.next}
              onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
          </FormGroup>
          <FormGroup label="Konfirmasi Password Baru">
            <input type="password" value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          </FormGroup>
          {pwMsg && (
            <div className={pwMsg.ok ? styles.ok : styles.err}>{pwMsg.text}</div>
          )}
          <Btn variant="primary" type="submit" loading={pwMut.isPending}>Simpan Password</Btn>
        </form>
      </Card>

      {/* User management (admin only) */}
      {me?.role === 'admin' && (
        <Card className={styles.section}>
          <div className={styles.sectionHeader}>
            <CardTitle>Manajemen User</CardTitle>
            <Btn variant="outline" size="sm" onClick={() => setShowAddUser(true)}>+ Tambah User</Btn>
          </div>
          {uLoad ? (
            <div className={styles.muted}>Memuat...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong> {u.id === me.id && <span className={styles.you}>(kamu)</span>}</td>
                    <td>{u.email}</td>
                    <td><span className={styles.role}>{u.role}</span></td>
                    <td>
                      {u.id !== me.id && (
                        <Btn size="sm" variant="danger" onClick={() => setDelId(u.id)}>Hapus</Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Add user modal */}
      <Modal
        open={showAddUser}
        onClose={() => { setShowAddUser(false); setUserMsg(null) }}
        title="Tambah User Baru"
        footer={
          <>
            <Btn variant="outline" onClick={() => setShowAddUser(false)}>Batal</Btn>
            <Btn variant="primary" loading={createMut.isPending} onClick={() => createMut.mutate()}>Buat User</Btn>
          </>
        }
      >
        <FormGroup label="Username">
          <input value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Email">
          <input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Password">
          <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
        </FormGroup>
        <FormGroup label="Role">
          <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </FormGroup>
        {userMsg && <div className={styles.err}>{userMsg}</div>}
      </Modal>

      {/* Confirm delete user */}
      <Modal
        open={!!delId}
        onClose={() => setDelId(null)}
        title="Hapus User?"
        footer={
          <>
            <Btn variant="outline" onClick={() => setDelId(null)}>Batal</Btn>
            <Btn variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate(delId)}>Hapus</Btn>
          </>
        }
      >
        <p className={styles.muted}>Aksi ini tidak dapat dibatalkan.</p>
      </Modal>
    </div>
  )
}
