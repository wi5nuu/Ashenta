import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore, useWsStore } from '../store'

const BASE_DELAY = 1000
const MAX_DELAY  = 30000
const PING_INTERVAL = 25000 // keep-alive ping setiap 25s

export function useWebSocket() {
  // Subscribe ke token — effect re-run saat login/logout
  const token = useAuthStore(s => s.token)

  // Gunakan ref untuk setter agar tidak jadi dependency effect
  // tapi selalu fresh (tidak captured di mount time)
  const setStatusRef       = useRef(useWsStore.getState().setStatus)
  const setCounterRef      = useRef(useWsStore.getState().setCounter)
  const setCameraStatusRef = useRef(useWsStore.getState().setCameraStatus)
  const resetCountersRef   = useRef(useWsStore.getState().resetCounters)

  // Selalu update ref ke nilai terbaru
  useEffect(() => {
    setStatusRef.current       = useWsStore.getState().setStatus
    setCounterRef.current      = useWsStore.getState().setCounter
    setCameraStatusRef.current = useWsStore.getState().setCameraStatus
    resetCountersRef.current   = useWsStore.getState().resetCounters
  })

  // Helper agar kode di bawah tetap ringkas
  const setStatus       = useCallback((...a) => setStatusRef.current(...a),       [])
  const setCounter      = useCallback((...a) => setCounterRef.current(...a),      [])
  const setCameraStatus = useCallback((...a) => setCameraStatusRef.current(...a), [])

  const wsRef    = useRef(null)
  const retryRef = useRef(null)
  const pingRef  = useRef(null)
  const delay    = useRef(BASE_DELAY)
  const alive    = useRef(true)

  const clearTimers = useCallback(() => {
    clearTimeout(retryRef.current)
    clearInterval(pingRef.current)
  }, [])

  useEffect(() => {
    if (!token) {
      // User logout — bersihkan store
      resetCountersRef.current()
      setStatus('disconnected')
      return
    }

    alive.current = true

    function connect() {
      if (!alive.current) return
      clearTimers()
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

        // Keep-alive ping agar proxy/nginx tidak putus koneksi idle
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, PING_INTERVAL)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)

          // Abaikan pong / pesan sistem
          if (msg.type === 'pong' || msg.type === 'ping') return

          if (msg.type === 'counter_update' && msg.camera_id != null) {
            setCounter(msg.camera_id, {
              in:  msg.entries ?? 0,
              out: msg.exits   ?? 0,
              net: (msg.entries ?? 0) - (msg.exits ?? 0),
            })
            return
          }

          if (msg.type === 'camera_status' && msg.camera_id != null) {
            setCameraStatus(msg.camera_id, msg.status)
            return
          }

          // Bulk snapshot saat koneksi pertama buka atau kamera baru start
          if (msg.type === 'bulk_counters' && Array.isArray(msg.cameras)) {
            msg.cameras.forEach(c => {
              setCounter(c.camera_id, {
                in:  c.entries ?? 0,
                out: c.exits   ?? 0,
                net: (c.entries ?? 0) - (c.exits ?? 0),
              })
            })
            return
          }

          // Bulk status snapshot
          if (msg.type === 'bulk_statuses' && Array.isArray(msg.cameras)) {
            msg.cameras.forEach(c => {
              if (c.camera_id != null && c.status) {
                setCameraStatus(c.camera_id, c.status)
              }
            })
            return
          }
        } catch (_) { /* abaikan pesan malformed */ }
      }

      ws.onerror = () => {
        setStatus('error')
      }

      ws.onclose = (ev) => {
        clearInterval(pingRef.current)
        if (!alive.current) return

        setStatus('disconnected')

        // Jangan retry jika token tidak valid (4001/4003) atau normal close
        if (ev.code === 4001 || ev.code === 4003) return

        retryRef.current = setTimeout(() => {
          delay.current = Math.min(delay.current * 2, MAX_DELAY)
          connect()
        }, delay.current)
      }
    }

    connect()

    return () => {
      alive.current = false
      clearTimers()
      if (wsRef.current) {
        wsRef.current.onclose = null // cegah retry loop saat unmount
        wsRef.current.close()
      }
      setStatus('disconnected')
    }
  }, [token, clearTimers]) // eslint-disable-line react-hooks/exhaustive-deps
}
