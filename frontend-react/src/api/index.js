import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ashenta_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ashenta_token')
      window.location.href = '/'
    }
    return Promise.reject(err.response?.data?.detail || err.message || 'Error')
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────
export const login = (username, password) => {
  const form = new FormData()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/login', form)
}
export const register = (data) => api.post('/auth/register', data)
export const getMe = () => api.get('/auth/me')

// ── Cameras ───────────────────────────────────────────────────
export const getCameras     = () => api.get('/cameras/')
export const getCamera      = (id) => api.get(`/cameras/${id}`)
export const createCamera   = (data) => api.post('/cameras/', data)
export const updateCamera   = (id, data) => api.patch(`/cameras/${id}`, data)
export const deleteCamera   = (id) => api.delete(`/cameras/${id}`)
export const setLineConfig  = (id, data) => api.put(`/cameras/${id}/line`, data)
export const startCamera    = (id) => api.post(`/cameras/${id}/start`)
export const stopCamera     = (id) => api.post(`/cameras/${id}/stop`)
export const getStreamToken = (id) => api.get(`/cameras/${id}/stream-token`)
export const getLiveCounter = (id) => api.get(`/cameras/${id}/counter`)
export const uploadVideo    = (id, file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/cameras/${id}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round(e.loaded * 100 / e.total))
  })
}

// ── Analytics ─────────────────────────────────────────────────
export const getDaily    = (params) => api.get('/analytics/daily', { params })
export const getTrend    = (params) => api.get('/analytics/trend', { params })
export const getHeatmap  = (params) => api.get('/analytics/heatmap', { params })
export const getForecast = (params) => api.get('/analytics/forecast', { params })

// ── Alerts ────────────────────────────────────────────────────
export const getAlerts    = () => api.get('/alerts/')
export const createAlert  = (data) => api.post('/alerts/', data)
export const patchAlert   = (id, data) => api.patch(`/alerts/${id}`, data)
export const deleteAlert  = (id) => api.delete(`/alerts/${id}`)
