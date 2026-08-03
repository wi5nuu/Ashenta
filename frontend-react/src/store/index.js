import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Auth store — persisted to localStorage
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user:  null,
      setToken: (token) => set({ token }),
      setUser:  (user)  => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'ashenta-auth' }
  )
)

// WebSocket store — live counters & statuses
export const useWsStore = create((set) => ({
  status:         'disconnected', // connected | connecting | disconnected | error
  counters:       {},             // { [camera_id]: { in, out, net } }
  cameraStatuses: {},             // { [camera_id]: 'active' | 'inactive' | 'error' }

  setStatus:        (status)            => set({ status }),
  setCounter:       (id, data)          => set(s => ({ counters: { ...s.counters, [id]: data } })),
  setCameraStatus:  (id, status)        => set(s => ({ cameraStatuses: { ...s.cameraStatuses, [id]: status } })),
  setAllCounters:   (counters)          => set({ counters }),
  resetCounters:    ()                  => set({ counters: {}, cameraStatuses: {} }),
}))
