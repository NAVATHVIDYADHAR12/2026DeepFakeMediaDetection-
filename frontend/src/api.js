/**
 * Thin wrapper over the backend REST API.
 *
 * Paths are relative by default: in development Vite proxies /api to the
 * FastAPI server on :8000, and in production FastAPI serves this build itself,
 * so the same paths work in both cases.
 *
 * When the frontend is hosted separately from the backend — a static deploy on
 * Vercel, for instance — set VITE_API_BASE at build time to the backend's
 * origin (e.g. https://omniguard-api.onrender.com) and every call is redirected
 * there. Empty by default, which keeps the same-origin behaviour.
 */
export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '')

/** Prefix a path with the configured API origin. */
export const apiUrl = (path) => `${API_BASE}${path}`

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    credentials: API_BASE ? 'include' : 'same-origin',
    ...options,
  })

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      // response had no JSON body; keep the status line
    }
    const error = new Error(detail)
    error.status = res.status
    throw error
  }
  return res.json()
}

const upload = (path, formData) => request(path, { method: 'POST', body: formData })

export const api = {
  health: () => request('/api/health'),
  systemInfo: () => request('/api/system/info'),
  models: () => request('/api/models'),

  stats: () => request('/api/stats'),
  scans: ({ limit = 20, offset = 0, verdict } = {}) => {
    const q = new URLSearchParams({ limit, offset })
    if (verdict) q.set('verdict', verdict)
    return request(`/api/scans?${q}`)
  },
  scan: (id) => request(`/api/scan/${id}`),
  deleteScan: (id) => request(`/api/scan/${id}`, { method: 'DELETE' }),

  /** Routes to the image or video analyser based on file extension. */
  analyze: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload('/api/scan', fd)
  },

  identities: () => request('/api/identities'),
  enroll: (name, file, notes = '') => {
    const fd = new FormData()
    fd.append('name', name)
    fd.append('file', file)
    if (notes) fd.append('notes', notes)
    return upload('/api/identity/enroll', fd)
  },
  matchIdentity: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return upload('/api/identity/match', fd)
  },
  deleteIdentity: (name) =>
    request(`/api/identity/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

/** Verdict presentation. Icon + label always accompany the color, so meaning
 *  never rests on hue alone. */
export const VERDICT = {
  AUTHENTIC:  { label: 'Authentic',       color: 'var(--good)',     icon: '✓', tone: 'good' },
  SUSPICIOUS: { label: 'Suspicious',      color: 'var(--warning)',  icon: '!', tone: 'warning' },
  FAKE:       { label: 'Fake / Manipulated', color: 'var(--critical)', icon: '✕', tone: 'critical' },
}

export const verdictMeta = (v) => VERDICT[v] ?? {
  label: v ?? 'Unknown', color: 'var(--ink-muted)', icon: '?', tone: 'muted',
}

export const formatBytes = (n) => {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export const timeAgo = (iso) => {
  if (!iso) return '—'
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`
  return `${Math.floor(secs / 86400)} d ago`
}
