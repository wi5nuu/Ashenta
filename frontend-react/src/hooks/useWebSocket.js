import { useEffect, useRef } from 'react'
import { useAuthStore, useWsStore } from '../store'

const BASE_DELAY = 1000
const MAX_DELAY  = 30000

export function useWebSocket() {
  const token     = useAuthStore(s => s.token)
  const setStatus = useWsStore(s => s.setStatus)
  const setCounter        = useWsStore(s => s.setCounter)
  const setCameraStatus   = useWsStore(s => s.setCameraStatus)

  const wsRef    = useRef(null)
  const retryRef = useRef(null)
  const delay    = useRef(BASE_DELAY)
  const alive    = useRef(true)

  useEffect(() => {
    if (!token) return
    alive.current = true

    function connect() {
      if (!alive.current) return
      setStatus('connecting')

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host  = window.location.host
      const ws    = new WebSocket(
        `${proto}://${host}/api/v1/ws/counters?token=${encodeURIComponent(token)}`
      )
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        delay.current = BASE_DELAY
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'counter_update' && msg.camera_id) {
            setCounter(msg.camera_id, {
              in:  msg.entries ?? 0,
              out: msg.exits   ?? 0,
              net: (msg.entries ?? 0) - (msg.exits ?? 0),
            })
          }
          if (msg.type === 'camera_status' && msg.camera_id) {
            setCameraStatus(msg.camera_id, msg.status)
          }
          if (msg.type === 'bulk_counters' && Array.isArray(msg.cameras)) {
            msg.cameras.forEach(c => {
              setCounter(c.camera_id, {
                in:  c.entries ?? 0,
                out: c.exits   ?? 0,
                net: (c.entries ?? 0) - (c.exits ?? 0),
              })
            })
          }
        } catch (_) { /* ignore malformed */ }
      }

      ws.onerror = () => setStatus('error')

      ws.onclose = () => {
        if (!alive.current) return
        setStatus('disconnected')
        retryRef.current = setTimeout(() => {
          delay.current = Math.min(delay.current * 2, MAX_DELAY)
          connect()
        }, delay.current)
      }
    }

    connect()

    return () => {
      alive.current = false
      clearTimeout(retryRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
      setStatus('disconnected')
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
}
