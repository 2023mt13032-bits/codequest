import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, getAuth, setAuth } from './api'
import AdminApp from './pages/AdminApp'
import StudentApp from './pages/StudentApp'
import { ThemeToggle } from './theme'
import './styles.css'

function Login({ onLogin }) {
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const data = await api('/login', { method: 'POST', body: { username, password } })
      setAuth(data); onLogin(data)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ alignSelf: 'flex-end' }}><ThemeToggle /></div>
        <div className="brand">Assess<span>Hub</span></div>
        <p className="muted">Sign in with the credentials given to you.</p>
        <input placeholder="Username" value={username} onChange={e => setU(e.target.value)} />
        <input placeholder="Password" type="password" value={password}
          onChange={e => setP(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()} />
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy || !username || !password} onClick={submit}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}

function Root() {
  const [auth, set] = useState(getAuth())
  const logout = () => { setAuth(null); set(null) }
  if (!auth) return <Login onLogin={set} />
  return auth.role === 'admin'
    ? <AdminApp auth={auth} onLogout={logout} />
    : <StudentApp auth={auth} onLogout={logout} />
}

createRoot(document.getElementById('root')).render(<Root />)