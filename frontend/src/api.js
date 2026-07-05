const BASE = '/api'

export function getAuth() {
  try { return JSON.parse(localStorage.getItem('auth')) } catch { return null }
}
export function setAuth(a) {
  if (a) localStorage.setItem('auth', JSON.stringify(a))
  else localStorage.removeItem('auth')
}

export async function api(path, { method = 'GET', body } = {}) {
  const auth = getAuth()
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) { setAuth(null); location.reload(); throw new Error('Session expired') }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`)
  return data
}

export function downloadCsv(path, filename) {
  const auth = getAuth()
  fetch(BASE + path, { headers: { Authorization: `Bearer ${auth.token}` } })
    .then(r => r.blob())
    .then(b => {
      const url = URL.createObjectURL(b)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    })
}

export function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + (s.endsWith('Z') ? '' : 'Z')).toLocaleString()
}

// datetime-local <-> UTC ISO helpers (server stores naive UTC)
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function fromLocalInput(v) {
  if (!v) return null
  return new Date(v).toISOString().slice(0, 19)
}
