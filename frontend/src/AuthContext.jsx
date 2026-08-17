import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { API_BASE, apiUrl } from './api.js'

/**
 * Session state.
 *
 * The token itself is never held here — the backend sets it as an HttpOnly
 * cookie, so it is unreadable from JavaScript by design. This only tracks who
 * the browser is currently signed in as.
 */

const AuthContext = createContext({
  user: null, loading: true, signUp: async () => {}, signIn: async () => {}, signOut: async () => {},
})

export const useAuth = () => useContext(AuthContext)

async function post(path, fields) {
  const body = new FormData()
  Object.entries(fields).forEach(([k, v]) => body.append(k, v))

  const res = await fetch(apiUrl(path), {
    method: 'POST', body,
    credentials: API_BASE ? 'include' : 'same-origin',
  })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.')
  }
  return data
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/auth/me'), {
        credentials: API_BASE ? 'include' : 'same-origin',
      })
      const data = await res.json()
      setUser(data.authenticated ? data.user : null)
    } catch {
      setUser(null)      // backend unreachable — treat as signed out
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const signUp = useCallback(async (email, name, password) => {
    const data = await post('/api/auth/signup', { email, name, password })
    setUser(data.user)
    return data.user
  }, [])

  const signIn = useCallback(async (email, password) => {
    const data = await post('/api/auth/login', { email, password })
    setUser(data.user)
    return data.user
  }, [])

  const signOut = useCallback(async () => {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: API_BASE ? 'include' : 'same-origin',
    })
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
