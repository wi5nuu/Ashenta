import { useQuery } from '@tanstack/react-query'
import { useWsStore } from '../store'
import { getCameras, getDaily } from '../api'
import { Card, CardTitle, StatCard, LiveDot, Badge, Btn } from '../components/UI'
import CameraCard from '../components/CameraCard'
import styles from './DashboardPage.module.css'

export default function DashboardPage() {
  const counters = useWsStore(s => s.counters)

  const { data: cameras = [], isLoading: camLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => getCameras().then(r => r.data),
    refetchInterval: 30_000,
  })

  const today = new Date().toISOString().slice(0, 10)
  const { data: daily, isLoading: dailyLoading } = useQuery({
    queryKey: ['daily', today],
    queryFn: () => getDaily({ date: today }).then(r => r.data),
    refetchInterval: 60_000,
  })

  // Merge WS live counters with DB daily totals
  const totalIn  = Object.values(counters).reduce((s, c) => s + (c.in  || 0), 0) || daily?.entries || 0
  const totalOut = Object.values(counters).reduce((s, c) => s + (c.out || 0), 0) || daily?.exits   || 0
  const activeCams = cameras.filter(c => c.status === 'active').length

  const dateStr = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <div>
      <div className={styles.header}>
        <h2>Dashboard Live</h2>
        <LiveDot />
        <span className={styles.date}>{dateStr}</span>
      </div>

      <div className={styles.statsRow}>
        <StatCard title="Total Masuk Hari Ini" value={totalIn}  loading={dailyLoading} />
        <StatCard title="Total Keluar Hari Ini" value={totalOut} loading={dailyLoading} />
        <StatCard title="Net Pengunjung" value={totalIn - totalOut} loading={dailyLoading} />
        <StatCard title="Kamera Aktif" value={`${activeCams} / ${cameras.length}`} loading={camLoading} />
      </div>

      <div className={styles.sectionHeader}>
        <h3>Live Feed</h3>
      </div>

      {camLoading ? (
        <div className={styles.grid}>
          {[1,2].map(i => <div key={i} className={styles.skeletonCard} />)}
        </div>
      ) : cameras.length === 0 ? (
        <Card><p style={{color:'var(--muted)',textAlign:'center',padding:'2rem'}}>
          Belum ada kamera. Tambahkan di tab <strong>Kamera</strong>.
        </p></Card>
      ) : (
        <div className={styles.grid}>
          {cameras.map(cam => (
            <CameraCard key={cam.id} camera={cam} counter={counters[cam.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
