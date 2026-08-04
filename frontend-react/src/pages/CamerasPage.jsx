import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCameras, deleteCamera, startCamera, stopCamera } from '../api'
import { Btn, Modal } from '../components/UI'
import { useWsStore } from '../store'
import { useToast } from '../hooks/useToast'
import CameraCard from '../components/CameraCard'
import CameraDetailModal from '../components/CameraDetailModal'
import AddCameraModal from '../components/AddCameraModal'
import LineConfigModal from '../components/LineConfigModal'
import styles from './CamerasPage.module.css'

const FILTERS = [
  { key: 'all',      label: 'Semua' },
  { key: 'active',   label: 'Aktif' },
  { key: 'inactive', label: 'Nonaktif' },
  { key: 'error',    label: 'Error' },
]

export default function CamerasPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showAdd,   setShowAdd]   = useState(false)
  const [editCam,   setEditCam]   = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [lineCam,   setLineCam]   = useState(null)
  const [detailId,  setDetailId]  = useState(null)
  const [filter,    setFilter]    = useState('all')
  const [search,    setSearch]    = useState('')

  const wsCounters = useWsStore(s => s.counters)
  const wsStatuses = useWsStore(s => s.cameraStatuses)

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn:  () => getCameras().then(r => r.data),
    refetchInterval: 30000,
  })

  const startMut = useMutation({
    mutationFn: (id) => startCamera(id),
    onSuccess:  (_, id) => {
      qc.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Kamera berhasil dijalankan')
    },
    onError: (e) => toast.error(`Gagal menjalankan kamera: ${e}`),
  })
  const stopMut = useMutation({
    mutationFn: (id) => stopCamera(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['cameras'] })
      toast.info('Kamera dihentikan')
    },
    onError: (e) => toast.error(`Gagal menghentikan kamera: ${e}`),
  })
  const restartMut = useMutation({
    mutationFn: async (id) => {
      await stopCamera(id)
      await startCamera(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Kamera berhasil direstart')
    },
    onError: (e) => toast.error(`Gagal restart kamera: ${e}`),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => deleteCamera(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['cameras'] })
      setConfirmId(null)
      toast.success('Kamera berhasil dihapus')
    },
    onError: (e) => toast.error(`Gagal menghapus kamera: ${e}`),
  })

  // Merge WS statuses — WS always freshest
  const mergedCameras = cameras.map(c => ({
    ...c,
    status: wsStatuses[c.id] ?? c.status,
  }))

  // Stats
  const activeCams   = mergedCameras.filter(c => c.status === 'active').length
  const errorCams    = mergedCameras.filter(c => c.status === 'error').length
  const inactiveCams = mergedCameras.filter(c => c.status !== 'active' && c.status !== 'error').length
  const confirmCam   = cameras.find(c => c.id === confirmId)

  // Filtered + searched list
  const filteredCameras = mergedCameras
    .filter(c => filter === 'all' || c.status === filter)
    .filter(c => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        c.name?.toLowerCase().includes(q) ||
        c.location_label?.toLowerCase().includes(q)
      )
    })

  // Bulk actions
  function startAll() {
    mergedCameras
      .filter(c => c.status !== 'active')
      .forEach(c => startMut.mutate(c.id))
  }
  function stopAll() {
    mergedCameras
      .filter(c => c.status === 'active')
      .forEach(c => stopMut.mutate(c.id))
  }

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
          {/* Bulk actions — only show if cameras exist */}
          {cameras.length > 0 && (
            <>
              {activeCams < cameras.length && (
                <Btn
                  variant="outline"
                  onClick={startAll}
                  disabled={startMut.isPending}
                  title="Jalankan semua kamera yang tidak aktif"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <polygon points="4,2 14,8 4,14" fill="currentColor"/>
                  </svg>
                  Mulai Semua
                </Btn>
              )}
              {activeCams > 0 && (
                <Btn
                  variant="outline"
                  onClick={stopAll}
                  disabled={stopMut.isPending}
                  title="Hentikan semua kamera yang aktif"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>
                  </svg>
                  Hentikan Semua
                </Btn>
              )}
            </>
          )}
          <Btn variant="primary" onClick={() => { setEditCam(null); setShowAdd(true) }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
            Tambah Kamera
          </Btn>
        </div>
      </div>

      {/* ── Search bar ────────────────────────────────────────────────────── */}
      {!isLoading && cameras.length > 0 && (
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.25"/>
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            className={styles.searchInput}
            placeholder="Cari nama atau lokasi kamera..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.searchClear} onClick={() => setSearch('')} aria-label="Hapus pencarian">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      {!isLoading && cameras.length > 0 && (
        <div className={styles.statsBar}>
          <div className={`${styles.statPill} ${styles.statPillActive}`}>
            <span className={`${styles.statPillDot} ${styles.dotActive}`} />
            <span className={styles.statPillNum}>{activeCams}</span>
            aktif
          </div>
          <div className={`${styles.statPill} ${styles.statPillTotal}`}>
            <span className={`${styles.statPillDot} ${styles.dotNeutral}`} />
            <span className={styles.statPillNum}>{cameras.length}</span>
            total
          </div>
          {inactiveCams > 0 && (
            <div className={`${styles.statPill} ${styles.statPillNeutral}`}>
              <span className={`${styles.statPillDot} ${styles.dotNeutral}`} />
              <span className={styles.statPillNum}>{inactiveCams}</span>
              nonaktif
            </div>
          )}
          {errorCams > 0 && (
            <div className={`${styles.statPill} ${styles.statPillError}`}>
              <span className={`${styles.statPillDot} ${styles.dotError}`} />
              <span className={styles.statPillNum}>{errorCams}</span>
              error
            </div>
          )}
        </div>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      {!isLoading && cameras.length > 0 && (
        <div className={styles.filterBar}>
          {FILTERS.map(f => {
            const count = f.key === 'all' ? cameras.length
              : f.key === 'active'   ? activeCams
              : f.key === 'inactive' ? inactiveCams
              : errorCams
            return (
              <button
                key={f.key}
                className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''} ${f.key === 'error' && errorCams > 0 ? styles.filterBtnError : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className={`${styles.filterCount} ${filter === f.key ? styles.filterCountActive : ''}`}>
                  {count}
                </span>
              </button>
            )
          })}
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
            Tambahkan kamera pertama untuk mulai memantau dan menghitung pengunjung secara real-time.
          </p>
          <Btn variant="primary" onClick={() => { setEditCam(null); setShowAdd(true) }}>
            Tambah Kamera Pertama
          </Btn>
        </div>
      ) : filteredCameras.length === 0 ? (
        <div className={styles.emptyWrap}>
          <p className={styles.emptyTitle}>Tidak ada kamera dengan status "{FILTERS.find(f => f.key === filter)?.label}"</p>
          <Btn variant="outline" onClick={() => setFilter('all')}>Tampilkan Semua</Btn>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredCameras.map(cam => (
            <CameraCard
              key={cam.id}
              camera={cam}
              counter={wsCounters[cam.id] ?? wsCounters[String(cam.id)]}
              onDetail={(id)    => setDetailId(id)}
              onEdit={(c)       => { setEditCam(c); setShowAdd(true) }}
              onDelete={(id)    => setConfirmId(id)}
              onLineConfig={(c) => setLineCam(c)}
              onStart={(id)     => startMut.mutate(id)}
              onStop={(id)      => stopMut.mutate(id)}
              onRestart={(id)   => restartMut.mutate(id)}
              startLoading={startMut.isPending   && startMut.variables   === cam.id}
              stopLoading={stopMut.isPending     && stopMut.variables    === cam.id}
              restartLoading={restartMut.isPending && restartMut.variables === cam.id}
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
            <span className={styles.deleteWarningText}>Tindakan ini tidak dapat dibatalkan.</span>
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
