import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAlerts, patchAlert, deleteAlert, createAlert, getCameras } from '../api'
import { Card, CardTitle, Btn, Modal, FormGroup, Skeleton } from '../components/UI'
import { useToast } from '../hooks/useToast'
import styles from './AlertsPage.module.css'

const TYPE_LABEL = {
  threshold: 'Ambang Batas',
  schedule:  'Jadwal',
  anomaly:   'Anomali',
}
const TYPE_COLOR = {
  threshold: 'var(--warn)',
  schedule:  'var(--accent)',
  anomaly:   'var(--danger)',
}

function AlertRow({ alert, onToggle, onDelete }) {
  return (
    <div className={`${styles.row} ${!alert.is_active ? styles.rowInactive : ''}`}>
      <div className={styles.rowLeft}>
        <span className={styles.typeBadge} style={{ color: TYPE_COLOR[alert.alert_type] || 'var(--text3)' }}>
          {TYPE_LABEL[alert.alert_type] || alert.alert_type}
        </span>
        <div className={styles.rowInfo}>
          <span className={styles.rowName}>{alert.name || `Alert #${alert.id}`}</span>
          {alert.camera_id && (
            <span className={styles.rowMeta}>Kamera #{alert.camera_id}</span>
          )}
          {alert.condition && (
            <span className={styles.rowMeta}>{alert.condition}</span>
          )}
        </div>
      </div>
      <div className={styles.rowRight}>
        <button
          className={`${styles.toggleBtn} ${alert.is_active ? styles.toggleActive : ''}`}
          onClick={() => onToggle(alert)}
          title={alert.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        >
          <span className={styles.toggleKnob} />
        </button>
        <button
          className={styles.deleteBtn}
          onClick={() => onDelete(alert.id)}
          title="Hapus alert"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"
              stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function AlertsPage() {
  const qc    = useQueryClient()
  const toast = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', alert_type: 'threshold', camera_id: '', condition: '' })

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn:  () => getAlerts().then(r => r.data),
    refetchInterval: 30000,
  })
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn:  () => getCameras().then(r => r.data),
  })

  const toggleMut = useMutation({
    mutationFn: (alert) => patchAlert(alert.id, { is_active: !alert.is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Status alert diperbarui')
    },
    onError: () => toast.error('Gagal memperbarui alert'),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => deleteAlert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alert dihapus')
    },
    onError: () => toast.error('Gagal menghapus alert'),
  })
  const createMut = useMutation({
    mutationFn: () => createAlert({
      ...form,
      camera_id: form.camera_id ? Number(form.camera_id) : null,
      is_active: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('Alert berhasil dibuat')
      setShowAdd(false)
      setForm({ name: '', alert_type: 'threshold', camera_id: '', condition: '' })
    },
    onError: (e) => toast.error(`Gagal membuat alert: ${e}`),
  })

  const active   = alerts.filter(a => a.is_active).length
  const inactive = alerts.filter(a => !a.is_active).length

  return (
    <div className="fadeUp">
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Notifikasi</h2>
          <p className={styles.sub}>
            {isLoading ? 'Memuat...' : `${alerts.length} alert terdaftar`}
          </p>
        </div>
        <Btn variant="primary" onClick={() => setShowAdd(true)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
          Tambah Alert
        </Btn>
      </div>

      {/* Stats */}
      {!isLoading && alerts.length > 0 && (
        <div className={styles.statsBar}>
          <div className={styles.statPill}>
            <span className={styles.statDot} style={{ background: 'var(--success)' }} />
            <span className={styles.statNum}>{active}</span> aktif
          </div>
          <div className={styles.statPill}>
            <span className={styles.statDot} style={{ background: 'var(--text4)' }} />
            <span className={styles.statNum}>{inactive}</span> nonaktif
          </div>
        </div>
      )}

      {/* List */}
      <Card>
        <CardTitle>Daftar Alert</CardTitle>
        {isLoading ? (
          <div className={styles.skeletons}>
            {[0,1,2].map(i => <Skeleton key={i} height={52} />)}
          </div>
        ) : alerts.length === 0 ? (
          <div className={styles.empty}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ opacity: .25 }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p>Belum ada alert. Tambahkan alert untuk mendapat notifikasi otomatis.</p>
            <Btn variant="primary" onClick={() => setShowAdd(true)}>Tambah Alert Pertama</Btn>
          </div>
        ) : (
          <div className={styles.list}>
            {alerts.map(a => (
              <AlertRow
                key={a.id}
                alert={a}
                onToggle={(alert) => toggleMut.mutate(alert)}
                onDelete={(id)   => deleteMut.mutate(id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Tambah Alert Baru"
        footer={
          <>
            <Btn variant="outline" onClick={() => setShowAdd(false)}>Batal</Btn>
            <Btn variant="primary" loading={createMut.isPending} onClick={() => createMut.mutate()}>
              Simpan
            </Btn>
          </>
        }
      >
        <div className={styles.form}>
          <FormGroup label="Nama Alert">
            <input
              placeholder="cth. Pengunjung terlalu banyak"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            />
          </FormGroup>
          <FormGroup label="Tipe">
            <select value={form.alert_type} onChange={e => setForm(p => ({ ...p, alert_type: e.target.value }))}>
              <option value="threshold">Ambang Batas (Threshold)</option>
              <option value="schedule">Jadwal (Schedule)</option>
              <option value="anomaly">Anomali</option>
            </select>
          </FormGroup>
          <FormGroup label="Kamera (opsional)">
            <select value={form.camera_id} onChange={e => setForm(p => ({ ...p, camera_id: e.target.value }))}>
              <option value="">Semua kamera</option>
              {cameras.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </FormGroup>
          <FormGroup label="Kondisi / Keterangan">
            <input
              placeholder="cth. Masuk > 100 per jam"
              value={form.condition}
              onChange={e => setForm(p => ({ ...p, condition: e.target.value }))}
            />
          </FormGroup>
        </div>
      </Modal>
    </div>
  )
}
