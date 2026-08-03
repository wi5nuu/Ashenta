import axios from 'axios'
import { useAuthStore } from './store'

const api = axios.create({ baseURL: '/api/v1' })

// Attach JWT to every request
api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// On 401, logout
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    const msg = err.response?.data?.detail || err.message || 'Request failed'
    return Promise.reject(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
)

// ── Auth ──────────────────────────────────────────────────────
export const login = (username, password) =>
  api.post('/auth/login', new URLSearchParams({ username, password }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
export const getMe          = ()     => api.get('/auth/me')
export const changePassword = (data) => api.post('/auth/change-password', data)

// ── Users (admin) ─────────────────────────────────────────────
export const getUsers   = ()        => api.get('/users/')
export const createUser = (data)    => api.post('/auth/register', data)
export const updateUser = (id, d)   => api.put(`/users/${id}`, d)
export const deleteUser = (id)      => api.delete(`/users/${id}`)

// ── Cameras ───────────────────────────────────────────────────
export const getCameras     = (params)           => api.get('/cameras/', { params })
export const getCamera      = (id)               => api.get(`/cameras/${id}`)
export const createCamera   = (data)             => api.post('/cameras/', data)
export const updateCamera   = (id, d)            => api.patch(`/cameras/${id}`, d)
export const deleteCamera   = (id)               => api.delete(`/cameras/${id}`)
export const startCamera    = (id)               => api.post(`/cameras/${id}/start`)
export const stopCamera     = (id)               => api.post(`/cameras/${id}/stop`)
export const setLineConfig  = (id, data)         => api.put(`/cameras/${id}/line`, data)
export const getStreamToken = (id)               => api.get(`/cameras/${id}/stream-token`)
export const getLiveCounter = (id)               => api.get(`/cameras/${id}/counter`)
export const uploadVideo    = (id, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/cameras/${id}/upload`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round(e.loaded * 100 / e.total)),
  })
}

// ── Analytics ─────────────────────────────────────────────────
export const getDaily      = (params) => api.get('/analytics/daily',      { params })
export const getTrend      = (params) => api.get('/analytics/trend',      { params })
export const getHourly     = (params) => api.get('/analytics/hourly',     { params })
export const getHeatmap    = (params) => api.get('/analytics/heatmap',    { params })
export const getForecast   = (params) => api.get('/analytics/forecast',   { params })
export const getPredictive = (params) => api.get('/analytics/predictive', { params })

// ── Alerts ────────────────────────────────────────────────────
export const getAlerts   = ()         => api.get('/alerts/')
export const createAlert = (data)     => api.post('/alerts/', data)
export const patchAlert  = (id, data) => api.patch(`/alerts/${id}`, data)
export const deleteAlert = (id)       => api.delete(`/alerts/${id}`)

export default api
