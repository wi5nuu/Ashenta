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

// Auth
export const login = (username, password) =>
  api.post('/auth/login', new URLSearchParams({ username, password }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

export const getMe = () => api.get('/auth/me')

// Cameras
export const getCameras     = (params) => api.get('/cameras', { params })
export const getCamera      = (id)     => api.get(`/cameras/${id}`)
export const createCamera   = (data)   => api.post('/cameras', data)
export const updateCamera   = (id, d)  => api.put(`/cameras/${id}`, d)
export const deleteCamera   = (id)     => api.delete(`/cameras/${id}`)
export const toggleCamera   = (id)     => api.post(`/cameras/${id}/toggle`)
export const getStreamToken = (id)     => api.post(`/cameras/${id}/stream-token`)
export const uploadVideo    = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/cameras/${id}/upload`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// Analytics
export const getDaily    = (params) => api.get('/analytics/daily',   { params })
export const getHourly   = (params) => api.get('/analytics/hourly',  { params })
export const getSummary  = (params) => api.get('/analytics/summary', { params })
export const getPredictive = (params) => api.get('/analytics/predictive', { params })

// Settings / users (admin)
export const getUsers    = ()        => api.get('/users')
export const createUser  = (data)    => api.post('/users', data)
export const updateUser  = (id, d)   => api.put(`/users/${id}`, d)
export const deleteUser  = (id)      => api.delete(`/users/${id}`)
export const changePassword = (data) => api.post('/auth/change-password', data)

export default api
