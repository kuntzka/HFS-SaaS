import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  withCredentials: true, // needed for HttpOnly refresh-token cookie
})

// Attach access token from memory (not localStorage — avoids XSS risk)
let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

client.interceptors.request.use(config => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// Refresh token interceptor (retry once on 401)
client.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const res = await axios.post('/api/auth/refresh', {}, { withCredentials: true })
        setAccessToken(res.data.accessToken)
        original.headers.Authorization = `Bearer ${res.data.accessToken}`
        return client(original)
      } catch {
        setAccessToken(null)
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default client
