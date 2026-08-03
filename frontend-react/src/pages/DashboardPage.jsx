import { useQuery } from '@tanstack/react-query'
import { useWsStore } from '../store'
import { getCameras, getDaily } from '../api'
import { Card, CardTitle, LiveDot, Skeleton } from '../components/UI'
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

  // WS counters = live realtime, fallback ke daily REST jika WS belum ada data
  const wsHasData  = Object.keys(counters).length > 0
  const totalIn    = wsHasData
    ? Object.values(counters).reduce((s, c) => s + (c.in  || 0), 0)
    : (daily?.entries || 0)
  const totalOut   = wsHasData
    ? Object.values(counters).reduce((s, c) => s + (c.out || 0), 0)
    : (daily?.exits   || 0)
  const net        = totalIn - totalOut

  // Merge WS statuses ke camera list
  const wsStatuses = useWsStore(s => s.cameraStatuses)
  const activeCams = cameras.filter(c => (wsStatuses[c.id] ?? c.status) === 'active').length

  const dateStr = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="fadeUp">
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>Dashboard</h2>
        <LiveDot />
        <span className={styles.date}>{dateStr}</span>
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <Card>
          <CardTitle>Total Masuk</CardTitle>
          {dailyLoading
            ? <Skeleton height={28} width={64} />
            : <div className={styles.statNum}>{totalIn}</div>
          }
          <div className={styles.statLabel}>pengunjung hari ini</div>
        </Card>

        <Card>
          <CardTitle>Total Keluar</CardTitle>
          {dailyLoading
            ? <Skeleton height={28} width={64} />
            : <div className={styles.statNum}>{totalOut}</div>
          }
          <div className={styles.statLabel}>pengunjung hari ini</div>
        </Card>

        <Card>
          <CardTitle>Di Dalam</CardTitle>
          {dailyLoading
            ? <Skeleton height={28} width={64} />
            : <div className={styles.statNum} style={{ color: net < 0 ? 'var(--danger)' : 'var(--text)' }}>{net}</div>
          }
          <div className={styles.statLabel}>estimasi saat ini</div>
        </Card>

        <Card>
          <CardTitle>Kamera Aktif</CardTitle>
          {camLoading
            ? <Skeleton height={28} width={64} />
            : <div className={styles.statNum}>
                {activeCams}
                <span className={styles.statDen}> / {cameras.length}</span>
              </div>
          }
          <div className={styles.statLabel}>dari total kamera</div>
        </Card>
      </div>

      {/* Live feed */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitle}>
            <LiveDot />
            Live Feed
          </div>
          <span className={styles.sectionMeta}>{cameras.length} kamera</span>
        </div>

        {camLoading ? (
          <div className={styles.grid}>
            {[1, 2, 3].map(i => <div key={i} className={styles.skeletonCard} />)}
          </div>
        ) : cameras.length === 0 ? (
          <Card>
            <div className={styles.empty}>
              Belum ada kamera. Tambahkan di halaman <strong>Kamera</strong>.
            </div>
          </Card>
        ) : (
          <div className={styles.grid}>
            {cameras.map(cam => (
              <CameraCard key={cam.id} camera={cam} counter={counters[cam.id]} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
