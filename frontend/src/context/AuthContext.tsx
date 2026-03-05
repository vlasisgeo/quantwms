import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import axios from 'axios'

interface AuthUser {
  id: number
  username: string
  email: string
  is_staff: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) {
      fetchMe(token).finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  async function fetchMe(token: string) {
    try {
      const res = await axios.get('/api/auth/me/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      setUser(res.data)
    } catch {
      // Token invalid / expired — let interceptor handle redirect
      setUser(null)
    }
  }

  async function login(username: string, password: string) {
    const { data } = await axios.post('/api/auth/token/', { username, password })
    localStorage.setItem('access_token', data.access)
    localStorage.setItem('refresh_token', data.refresh)
    await fetchMe(data.access)
  }

  function logout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
