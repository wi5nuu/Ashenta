import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCameras, getHourly, getDaily, getPredictive } from '../api'
import { Card, CardTitle, Skeleton } from '../components/UI'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import styles from './AnalyticsPage.module.css'

const TT = {
  contentStyle: {
    background: '#161618',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    fontSize: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    padding: '8px 12px',
  },
  labelStyle:   { color: '#71717a', fontWeight: 600, marginBottom: 4, fontSize: 11 },
  itemStyle:    { color: '#a1a1aa' },
  cursor:       { fill: 'rgba(255,255,255,.03)' },
}

export default function AnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date,  setDate]  = useState(today)
  const [camId, setCamId] = useState('')

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => getCameras().then(r => r.data),
  })
  const params = { date, ...(camId ? { camera_id: camId } : {}) }

  const isToday = date === today

  const { data: hourlyResp, isLoading: hLoad } = useQuery({
    queryKey: ['hourly', params],
    queryFn: () => getHourly(params).then(r => r.data),
    refetchInterval: isToday ? 60_000 : false, // refresh tiap 1 menit jika hari ini
  })
  const { data: daily, isLoading: dLoad } = useQuery({
    queryKey: ['daily', params],
    queryFn: () => getDaily(params).then(r => r.data),
    refetchInterval: isToday ? 60_000 : false,
  })
  const { data: predictive = [], isLoading: pLoad } = useQuery({
    queryKey: ['predictive', { camera_id: camId }],
    queryFn: () => getPredictive(camId ? { camera_id: camId } : {}).then(r => r.data),
    staleTime: 300_000,
    refetchInterval: isToday ? 300_000 : false, // refresh tiap 5 menit jika hari ini
  })

  const hourly = Array.isArray(hourlyResp) ? hourlyResp : (hourlyResp?.data ?? [])
  const hourlyFmt = hourly.map(h => ({
    hour:   `${String(h.hour).padStart(2,'0')}:00`,
    Masuk:  h.entries || 0,
    Keluar: h.exits   || 0,
    Bersih: h.net     || 0,
  }))
  const predFmt = predictive.map(p => ({
    hour:   `${String(p.hour).padStart(2,'0')}:00`,
    Masuk:  p.predicted_entries || 0,
    Keluar: p.predicted_exits   || 0,
  }))
  const peak = hourlyFmt.reduce((mx, h) => h.Masuk > (mx?.Masuk||0) ? h : mx, null)

  const axisProps = {
    tick:     { fill: '#52525b', fontSize: 11 },
    axisLine: false,
    tickLine: false,
  }

  return (
    <div className="fadeUp">
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Analitik</h2>
          <p className={styles.sub}>Statistik lalu lintas pengunjung</p>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterItem}>
          <label>Tanggal</label>
          <input type="date" value={date} max={today}
            onChange={e => setDate(e.target.value)} />
        </div>
        <div className={styles.filterItem}>
          <label>Kamera</label>
          <select value={camId} onChange={e => setCamId(e.target.value)}>
            <option value="">Semua Kamera</option>
            {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className={styles.summary}>
        <Card>
          <CardTitle>Total Masuk</CardTitle>
          {dLoad ? <Skeleton height={28} width={60} /> :
            <div className={styles.sumVal}>{daily?.entries ?? '–'}</div>}
          <div className={styles.sumSub}>pengunjung</div>
        </Card>
        <Card>
          <CardTitle>Total Keluar</CardTitle>
          {dLoad ? <Skeleton height={28} width={60} /> :
            <div className={styles.sumVal}>{daily?.exits ?? '–'}</div>}
          <div className={styles.sumSub}>pengunjung</div>
        </Card>
        <Card>
          <CardTitle>Jam Puncak</CardTitle>
          {hLoad ? <Skeleton height={28} width={60} /> :
            <div className={styles.sumVal}>{peak ? peak.hour : '–'}</div>}
          <div className={styles.sumSub}>{peak ? `${peak.Masuk} masuk` : 'tidak ada data'}</div>
        </Card>
      </div>

      {/* Hourly bar */}
      <Card style={{ marginBottom: '.75rem' }}>
        <div className={styles.chartHead}>
          <div className={styles.chartTitle}>Lalu Lintas Per Jam</div>
          <div className={styles.chartSub}>{date}</div>
        </div>
        {hLoad ? <Skeleton height={240} /> : hourlyFmt.length === 0 ? (
          <div className={styles.empty}>Tidak ada data untuk tanggal ini.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourlyFmt} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={2} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(255,255,255,.04)" vertical={false} />
              <XAxis dataKey="hour" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
              <Bar dataKey="Masuk"  fill="#ededed" radius={[3,3,0,0]} maxBarSize={24} />
              <Bar dataKey="Keluar" fill="#52525b" radius={[3,3,0,0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Net area */}
      <Card style={{ marginBottom: '.75rem' }}>
        <div className={styles.chartHead}>
          <div className={styles.chartTitle}>Net Pengunjung</div>
          <div className={styles.chartSub}>estimasi di dalam toko per jam</div>
        </div>
        {hLoad ? <Skeleton height={180} /> : hourlyFmt.length === 0 ? (
          <div className={styles.empty}>Tidak ada data.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourlyFmt} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="netG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#ededed" stopOpacity={.08} />
                  <stop offset="100%" stopColor="#ededed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(255,255,255,.04)" vertical={false} />
              <XAxis dataKey="hour" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...TT} />
              <Area type="monotone" dataKey="Bersih" stroke="#ededed" strokeWidth={1.5}
                fill="url(#netG)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Predictive */}
      <Card>
        <div className={styles.chartHead}>
          <div className={styles.chartTitle}>Prediksi Besok</div>
          <div className={styles.chartSub}>berdasarkan data historis 7 hari</div>
        </div>
        {pLoad ? <Skeleton height={180} /> : predFmt.length === 0 ? (
          <div className={styles.empty}>
            Dibutuhkan minimal 7 hari data historis untuk prediksi.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={predFmt} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(255,255,255,.04)" vertical={false} />
              <XAxis dataKey="hour" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
              <Line type="monotone" dataKey="Masuk"  stroke="#ededed" strokeWidth={1.5}
                dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="Keluar" stroke="#52525b" strokeWidth={1.5}
                dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  )
}
