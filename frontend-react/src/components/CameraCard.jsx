import { useState, useRef } from 'react'
import { useWsStore } from '../store'
import { getStreamToken } from '../api'
import { Badge, Btn } from './UI'
import styles from './CameraCard.module.css'

export default function CameraCard({ camera, counter }) {
  const [streaming, setStreaming] = useState(false)
  const [error,     setError]     = useState(false)
  const imgRef = useRef(null)

  // Live status from WS overrides DB status
  const wsStatuses = useWsStore(s => s.cameraStatuses)
  const status = wsStatuses[camera.id] || camera.status

  const cnt = counter || { in: 0, out: 0, net: 0 }

  async function startStream() {
    setError(false)
    try {
      const res = await getStreamToken(camera.id)
      const token = res.data.stream_token
      if (imgRef.current) {
        imgRef.current.src = `/api/v1/stream/${camera.id}/mjpeg?token=${encodeURIComponent(token)}`
        imgRef.current.style.display = 'block'
        setStreaming(true)
      }
    } catch (e) {
      setError(true)
    }
  }

  function stopStream() {
    if (imgRef.current) {
      imgRef.current.src = ''
      imgRef.current.style.display = 'none'
    }
    setStreaming(false)
    setError(false)
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title} title={camera.location_label}>{camera.name}</span>
        <Badge status={status} />
        <div className={styles.counter}>
          <span>IN <strong>{cnt.in}</strong></span>
          <span>OUT <strong>{cnt.out}</strong></span>
          <span>NET <strong>{cnt.net}</strong></span>
        </div>
      </div>

      <div className={styles.video}>
        <img
          ref={imgRef}
          alt={`stream ${camera.name}`}
          style={{ display: 'none' }}
          onError={() => { setError(true); setStreaming(false) }}
        />
        {!streaming && (
          <div className={styles.overlay}>
            <span className={styles.icon}>&#x1F4F9;</span>
            <span>{error ? 'Stream error — kamera offline?' : status === 'active' ? 'Klik Lihat Live' : 'Kamera tidak aktif'}</span>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {streaming
          ? <Btn size="sm" variant="outline" onClick={stopStream}>&#9646;&#9646; Stop</Btn>
          : <Btn size="sm" variant="outline" onClick={startStream} disabled={status !== 'active'}>&#9654; Lihat Live</Btn>
        }
        {camera.location_label && (
          <span className={styles.location}>{camera.location_label}</span>
        )}
      </div>
    </div>
  )
}
