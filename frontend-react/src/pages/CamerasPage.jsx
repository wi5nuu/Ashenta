import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCameras, deleteCamera, toggleCamera } from '../api'
import { Card, Btn, Badge, Modal } from '../components/UI'
import AddCameraModal from '../components/AddCameraModal'
import LineConfigModal from '../components/LineConfigModal'
import styles from './CamerasPage.module.css'

export default function CamerasPage() {
  const qc = useQueryClient()
  const [showAdd,   setShowAdd]   = useState(false)
  const [editCam,   setEditCam]   = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [lineCam,   setLineCam]   = useState(null)

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => getCameras().then(r => r.data),
  })

  const toggleMut = useMutation({
    mutationFn: (id) => toggleCamera(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cameras'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => deleteCamera(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cameras'] })
      setConfirmId(null)
    },
  })

  return (
    <div>
      <div className={styles.header}>
        <h2>Manajemen Kamera</h2>
        <Btn variant="primary" onClick={() => { setEditCam(null); setShowAdd(true) }}>
          + Tambah Kamera
        </Btn>
      </div>

      <Card>
        {isLoading ? (
          <div className={styles.empty}>Memuat...</div>
        ) : cameras.length === 0 ? (
          <div className={styles.empty}>Belum ada kamera. Klik "Tambah Kamera" untuk mulai.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Lokasi</th>
                <th>Tipe Sumber</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {cameras.map(cam => (
                <tr key={cam.id}>
                  <td><strong>{cam.name}</strong></td>
                  <td>{cam.location_label || <span style={{color:'var(--muted)'}}>—</span>}</td>
                  <td><span className={styles.tag}>{cam.source_type || 'rtsp'}</span></td>
                  <td><Badge status={cam.status} /></td>
                  <td>
                    <div className={styles.actions}>
                      <Btn size="sm" variant="outline"
                        onClick={() => { setEditCam(cam); setShowAdd(true) }}>
                        Edit
                      </Btn>
                      <Btn size="sm" variant="outline"
                        loading={toggleMut.isPending && toggleMut.variables === cam.id}
                        onClick={() => toggleMut.mutate(cam.id)}>
                        {cam.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                      </Btn>
                      <Btn size="sm" variant="outline"
                        onClick={() => setLineCam(cam)}>
                        Set Garis
                      </Btn>
                      <Btn size="sm" variant="danger"
                        onClick={() => setConfirmId(cam.id)}>
                        Hapus
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AddCameraModal
        open={showAdd}
        camera={editCam}
        onClose={() => { setShowAdd(false); setEditCam(null) }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['cameras'] })
          setShowAdd(false)
          setEditCam(null)
        }}
      />

      <LineConfigModal
        open={!!lineCam}
        camera={lineCam}
        onClose={() => setLineCam(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['cameras'] })
          setLineCam(null)
        }}
      />

      <Modal
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="Hapus Kamera?"
        footer={
          <>
            <Btn variant="outline" onClick={() => setConfirmId(null)}>Batal</Btn>
            <Btn variant="danger"
              loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(confirmId)}>
              Hapus
            </Btn>
          </>
        }
      >
        <p style={{color:'var(--muted)'}}>
          Aksi ini tidak dapat dibatalkan. Semua rekaman &amp; data kamera ini akan dihapus.
        </p>
      </Modal>
    </div>
  )
}
