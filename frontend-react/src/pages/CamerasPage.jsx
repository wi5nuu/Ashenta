import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCameras, deleteCamera, startCamera, stopCamera } from '../api'
import { Btn, Modal } from '../components/UI'
import { useWsStore } from '../store'
import CameraCard from '../components/CameraCard'
import CameraDetailModal from '../components/CameraDetailModal'
import AddCameraModal from '../components/AddCameraModal'
import LineConfigModal from '../components/LineConfigModal'
import styles from './CamerasPage.module.css'

export default function CamerasPage() {
  const qc = useQueryClient()
  const [showAdd,    setShowAdd]    = useState(false)
  const [editCam,    setEditCam]    = useState(null)
  const [confirmId,  setConfirmId]  = useState(null)
  const [lineCam,    setLineCam]    = useState(null)
  const [detailId,   setDetailId]   = useState(null) // ← detail modal

  const wsCounters  = useWsStore(s => s.counters)
  const wsStatuses  = useWsStore(s => s.cameraStatuses)

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn:  () => getCameras().then(r => r.data),
    refetchInterval: 30000, // fallback poll setiap 30s jika WS terputus
  })

  const startMut = useMutation({
    mutationFn: (id) => startCamera(id),
    onSuccess:  ()   => qc.invalidateQueries({ queryKey: ['cameras'] }),
  })
  const stopMut = useMutation({
    mutationFn: (id) => stopCamera(id),
    onSuccess:  ()   => qc.invalidateQueries({ queryKey: ['cameras'] }),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => deleteCamera(id),
    onSuccess:  ()   => { qc.invalidateQueries({ queryKey: ['cameras'] }); setConfirmId(null) },
  })

  // Merge WS statuses ke data kamera — WS selalu lebih fresh
  const mergedCameras = cameras.map(c => ({
    ...c,
    status: wsStatuses[c.id] ?? c.status,
  }))

  const activeCams = mergedCameras.filter(c => c.status === 'active').length
  const confirmCam = cameras.find(c => c.id === confirmId)

  return (
    <div className="fadeUp">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Kamera</h2>
          <p className={styles.sub}>
            {isLoading ? 'Memuat...' : `${cameras.length} kamera terdaftar`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Btn variant="primary" onClick={() => { setEditCam(null); setShowAdd(true) }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Tambah Kamera
          </Btn>
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      {!isLoading && cameras.length > 0 && (
        <div className={styles.statsBar}>
          <div className={`${styles.statPill} ${styles.statPillActive}`}>
            <span className={styles.statPillDot} />
            <span className={styles.statPillNum}>{activeCams}</span>
            aktif
          </div>
          <div className={`${styles.statPill} ${styles.statPillTotal}`}>
            <span className={styles.statPillDot} />
            <span className={styles.statPillNum}>{cameras.length}</span>
            total
          </div>
          {cameras.length - activeCams > 0 && (
            <div className={`${styles.statPill} ${styles.statPillTotal}`}>
              <span className={styles.statPillDot} style={{ background: 'var(--text5)' }} />
              <span className={styles.statPillNum}>{cameras.length - activeCams}</span>
              nonaktif
            </div>
          )}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className={styles.skeletonGrid}>
          {[1, 2, 3].map(i => <div key={i} className={styles.skeletonCard} />)}
        </div>
      ) : cameras.length === 0 ? (
        <div className={styles.emptyWrap}>
          <div className={styles.emptyIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="m17 9 4-2v6l-4-2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="9.5" cy="10" r="2" stroke="currentColor" strokeWidth="1.25"/>
            </svg>
          </div>
          <p className={styles.emptyTitle}>Belum ada kamera</p>
          <p className={styles.emptyDesc}>
            Tambahkan kamera pertama Anda untuk mulai memantau dan menghitung orang secara real-time.
          </p>
          <Btn variant="primary" onClick={() => { setEditCam(null); setShowAdd(true) }}>
            Tambah Kamera Pertama
          </Btn>
        </div>
      ) : (
        <div className={styles.grid}>
          {mergedCameras.map(cam => (
            <CameraCard
              key={cam.id}
              camera={cam}
              counter={wsCounters[cam.id]}
              onDetail={(id)    => setDetailId(id)}
              onEdit={(c)       => { setEditCam(c); setShowAdd(true) }}
              onDelete={(id)    => setConfirmId(id)}
              onLineConfig={(c) => setLineCam(c)}
              onStart={(id)     => startMut.mutate(id)}
              onStop={(id)      => stopMut.mutate(id)}
              startLoading={startMut.isPending && startMut.variables === cam.id}
              stopLoading={stopMut.isPending  && stopMut.variables  === cam.id}
            />
          ))}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <CameraDetailModal
        cameraId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        onEdit={(c)       => { setDetailId(null); setEditCam(c); setShowAdd(true) }}
        onDelete={(id)    => { setDetailId(null); setConfirmId(id) }}
        onLineConfig={(c) => { setDetailId(null); setLineCam(c) }}
      />

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
        onSaved={() => { qc.invalidateQueries({ queryKey: ['cameras'] }); setLineCam(null) }}
      />

      {/* ── Confirm Delete ────────────────────────────────────────────────── */}
      <Modal
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="Hapus kamera?"
        footer={
          <>
            <Btn variant="outline" onClick={() => setConfirmId(null)}>Batal</Btn>
            <Btn variant="danger" loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(confirmId)}>
              Hapus Permanen
            </Btn>
          </>
        }
      >
        <div className={styles.deleteBody}>
          <div className={styles.deleteWarning}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.deleteWarningIcon}>
              <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
              <path d="M8 6v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
            </svg>
            <span className={styles.deleteWarningText}>
              Tindakan ini tidak dapat dibatalkan.
            </span>
          </div>
          <p className={styles.deleteDesc}>
            Kamera <strong style={{ color: 'var(--text)' }}>{confirmCam?.name}</strong> beserta
            semua konfigurasi dan data historisnya akan dihapus secara permanen.
          </p>
        </div>
      </Modal>
    </div>
  )
}
