import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCameras, getHourly, getDaily, getSummary, getPredictive } from '../api'
import { Card, CardTitle, StatCard, Skeleton } from '../components/UI'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import styles from './AnalyticsPage.module.css'

const CHART_COLORS = { in: '#38bdf8', out: '#818cf8', net: '#4ade80' }

export default function AnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date,     setDate]     = useState(today)
  const [camId,    setCamId]    = useState('')

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => getCameras().then(r => r.data),
  })

  const params = { date, ...(camId ? { camera_id: camId } : {}) }

  const { data: hourlyResp, isLoading: hLoad } = useQuery({
    queryKey: ['hourly', params],
    queryFn: () => getHourly(params).then(r => r.data),
  })

  const { data: daily, isLoading: dLoad } = useQuery({
    queryKey: ['daily', params],
    queryFn: () => getDaily(params).then(r => r.data),
  })

  const { data: predictive = [], isLoading: pLoad } = useQuery({
    queryKey: ['predictive', { camera_id: camId }],
    queryFn: () => getPredictive(camId ? { camera_id: camId } : {}).then(r => r.data),
    staleTime: 300_000,
  })

  // backend returns { date, camera_id, data: [...] }
  const hourly = Array.isArray(hourlyResp) ? hourlyResp : (hourlyResp?.data ?? [])

  const hourlyFormatted = hourly.map(h => ({
    hour:    `${String(h.hour).padStart(2,'0')}:00`,
    Masuk:   h.entries  || 0,
    Keluar:  h.exits    || 0,
    Bersih:  h.net      || 0,
  }))

  const predFormatted = predictive.map(p => ({
    hour:   `${String(p.hour).padStart(2,'0')}:00`,
    Masuk:  p.predicted_entries || 0,
    Keluar: p.predicted_exits   || 0,
  }))

  return (
    <div>
      <div className={styles.header}>
        <h2>Analitik</h2>
        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <label>Tanggal</label>
            <input type="date" value={date} max={today}
              onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          </div>
          <div className={styles.filterGroup}>
            <label>Kamera</label>
            <select value={camId} onChange={e => setCamId(e.target.value)} style={{ width: 180 }}>
              <option value="">Semua Kamera</option>
              {cameras.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className={styles.statsRow}>
        <StatCard title="Total Masuk"   value={daily?.entries} loading={dLoad} />
        <StatCard title="Total Keluar"  value={daily?.exits}   loading={dLoad} />
        <StatCard title="Net Pengunjung" value={daily?.net}    loading={dLoad} />
        <StatCard title="Jam Tersibuk"  value={daily?.peak_hour != null ? `${daily.peak_hour}:00` : '–'} loading={dLoad} />
      </div>

      {/* Hourly bar chart */}
      <Card className={styles.chartCard}>
        <CardTitle>Lalu Lintas Per Jam — {date}</CardTitle>
        {hLoad ? <Skeleton height={260} /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={hourlyFormatted} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="hour" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Masuk"  fill={CHART_COLORS.in}  radius={[3,3,0,0]} />
              <Bar dataKey="Keluar" fill={CHART_COLORS.out} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Predictive line chart */}
      <Card className={styles.chartCard}>
        <CardTitle>Prediksi Lalu Lintas (AI)</CardTitle>
        {pLoad ? <Skeleton height={220} /> : predFormatted.length === 0 ? (
          <div className={styles.empty}>Data prediksi belum tersedia. Dibutuhkan minimal 7 hari data historis.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={predFormatted} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="hour" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Masuk"  stroke={CHART_COLORS.in}  strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Keluar" stroke={CHART_COLORS.out} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}
