import React, { useEffect, useRef, useState, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { marked } from 'marked'
import { api, fmtDate } from '../api'
import { ThemeToggle } from '../theme'

const MD = ({ text }) => (
  <div className="statement" dangerouslySetInnerHTML={{ __html: marked.parse(text || '') }} />
)

function Timer({ seconds, onExpire }) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => setLeft(seconds), [seconds])
  useEffect(() => {
    if (left === null) return
    if (left <= 0) { onExpire(); return }
    const t = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  if (left === null) return <span className="pill open">Untimed</span>
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60
  const p = n => String(n).padStart(2, '0')
  return <span className={'timer' + (left < 300 ? ' low' : '')}>{p(h)}:{p(m)}:{p(s)}</span>
}

function SqlTable({ columns, rows }) {
  if (!columns || columns.length === 0) return <p className="muted">Query ran but returned no result set.</p>
  return (
    <table className="result-table"><thead><tr>{columns.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{(rows || []).map((r, j) => <tr key={j}>{r.map((v, k) => <td key={k}>{v ?? 'NULL'}</td>)}</tr>)}</tbody>
    </table>
  )
}

function CaseResults({ res }) {
  if (!res) return null
  return (
    <div>
      {res.cases.map((c, i) => (
        <div className="case" key={i}>
          <div className="row">
            <b>Test case {c.index + 1}</b>
            <span className={'pill ' + (c.passed ? 'pass' : 'fail')}>{c.passed ? 'Passed' : 'Failed'}</span>
            {!c.visible && <span className="muted">(hidden)</span>}
            <span className="muted">{c.marks} marks</span>
            {c.timed_out && <span className="pill fail">Timed out</span>}
          </div>
          {c.error && <pre>{c.error}</pre>}
          {c.visible && c.input !== undefined && c.input !== null && (
            <>
              {c.input !== '' && <pre>Input:{'\n'}{c.input}</pre>}
              <pre>Expected:{'\n'}{c.expected}</pre>
              <pre>Your output:{'\n'}{c.actual}</pre>
              {c.stderr && <pre style={{ color: 'var(--bad)' }}>{c.stderr}</pre>}
            </>
          )}
          {c.columns && <SqlTable columns={c.columns} rows={c.rows} />}
        </div>
      ))}
    </div>
  )
}

function FreeRunResult({ res }) {
  if (!res) return null
  if (res.kind === 'python') return (
    <div className="case">
      {res.timed_out && <span className="pill fail">Timed out</span>}
      <pre>Output:{'\n'}{res.stdout || '(empty)'}</pre>
      {res.stderr && <pre style={{ color: 'var(--bad)' }}>{res.stderr}</pre>}
    </div>
  )
  return (
    <div className="case">
      {res.error
        ? <pre style={{ color: 'var(--bad)' }}>{res.error}</pre>
        : <SqlTable columns={res.columns} rows={res.rows} />}
    </div>
  )
}

function FillBlanks({ statement, count, value, onChange }) {
  const blanks = value || Array(count).fill('')
  const parts = (statement || '').split('{{blank}}')
  return (
    <div className="statement" style={{ padding: 16 }}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <span dangerouslySetInnerHTML={{ __html: marked.parseInline(p) }} />
          {i < parts.length - 1 && (
            <input className="mono" style={{ width: 160, display: 'inline-block', margin: '0 6px' }}
              value={blanks[i] || ''} placeholder={`blank ${i + 1}`}
              onChange={e => { const b = [...blanks]; b[i] = e.target.value; onChange(b) }} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function Exam({ aid, onExit }) {
  const [data, setData] = useState(null)
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState({})
  const [runRes, setRunRes] = useState({})
  const [freeRes, setFreeRes] = useState({})
  const [stdin, setStdin] = useState({})
  const [showStdin, setShowStdin] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const saveTimers = useRef({})

  const [leftW, setLeftW] = useState(44)
  const [outH, setOutH] = useState(42)
  const examRef = useRef(null)
  const rightRef = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    const move = e => {
      if (!drag.current) return
      const x = e.touches ? e.touches[0].clientX : e.clientX
      const y = e.touches ? e.touches[0].clientY : e.clientY
      if (drag.current === 'v' && examRef.current) {
        const r = examRef.current.getBoundingClientRect()
        setLeftW(Math.min(75, Math.max(20, ((x - r.left) / r.width) * 100)))
      }
      if (drag.current === 'h' && rightRef.current) {
        const r = rightRef.current.getBoundingClientRect()
        setOutH(Math.min(80, Math.max(12, ((r.bottom - y) / r.height) * 100)))
      }
      e.preventDefault()
    }
    const stop = () => { drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = '' }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', stop)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', stop)
    }
  }, [])

  const startDrag = (kind, cursor) => e => {
    drag.current = kind
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  useEffect(() => {
    api(`/student/assessments/${aid}/start`, { method: 'POST' })
      .then(d => { setData(d); setAnswers(d.saved_answers || {}) })
      .catch(e => setErr(e.message))
  }, [aid])

  const [saveErr, setSaveErr] = useState(false)
  const save = useCallback((qid, payload) => {
    clearTimeout(saveTimers.current[qid])
    saveTimers.current[qid] = setTimeout(() => {
      api(`/student/assessments/${aid}/save`, { method: 'POST', body: { question_id: qid, payload } })
        .then(() => setSaveErr(false))
        .catch(() => setSaveErr(true))
    }, 800)
  }, [aid])

  const update = (qid, payload) => {
    setAnswers(a => ({ ...a, [qid]: payload }))
    save(qid, payload)
  }

  const submitAll = async (auto = false) => {
    if (!auto && !confirm('Submit the whole assessment? You cannot change answers after this.')) return
    setBusy('submit')
    try { await api(`/student/assessments/${aid}/submit`, { method: 'POST' }); onExit() }
    catch (e) { setErr(e.message); onExit() }
  }

  if (err && !data) return <div className="page"><div className="error">{err}</div><button className="btn" onClick={onExit}>Back</button></div>
  if (!data) return <div className="page muted">Loading…</div>
  if (data.status === 'submitted') return (
    <div className="page"><div className="card">This assessment is already submitted.
      <div style={{ marginTop: 10 }}><button className="btn" onClick={onExit}>Back to dashboard</button></div></div></div>
  )

  const q = data.questions[idx]
  const ans = answers[q.question_id] || {}
  const rr = runRes[q.question_id]
  const fr = freeRes[q.question_id]
  const isCoding = q.qtype === 'python' || q.qtype === 'sql'
  const freeAllowed = isCoding && q.config.allow_free_run !== false

  const currentCode = () => q.qtype === 'python'
    ? (ans.code ?? q.config.starter_code ?? '')
    : (ans.query ?? '')

  const runGraded = async () => {
    setBusy('run')
    try {
      const body = { question_id: q.question_id }
      if (q.qtype === 'python') body.code = currentCode()
      if (q.qtype === 'sql') body.query = currentCode()
      const res = await api(`/student/assessments/${aid}/run`, { method: 'POST', body })
      setRunRes(r => ({ ...r, [q.question_id]: res }))
      setFreeRes(r => ({ ...r, [q.question_id]: null }))
    } catch (e) { alert(e.message) }
    setBusy('')
  }

  const runFree = async () => {
    setBusy('free')
    try {
      const body = { question_id: q.question_id }
      if (q.qtype === 'python') { body.code = currentCode(); body.stdin = stdin[q.question_id] || '' }
      if (q.qtype === 'sql') body.query = currentCode()
      const res = await api(`/student/assessments/${aid}/run-free`, { method: 'POST', body })
      setFreeRes(r => ({ ...r, [q.question_id]: res }))
      setRunRes(r => ({ ...r, [q.question_id]: null }))
    } catch (e) { alert(e.message) }
    setBusy('')
  }

  const answered = qid => {
    const a = answers[qid]; if (!a) return false
    return !!(a.code || a.query || a.text || a.selected !== undefined || (a.blanks && a.blanks.some(x => x)))
  }

  const hasOutput = isCoding && (rr || fr || (q.qtype === 'python' && freeAllowed && showStdin))

  return (
    <>
      <div className="topbar">
        <div>
          <div className="brand">Assess<span>Hub</span></div>
          <div className="company-badge">Kantaka Sodhana</div>
        </div>
        <b style={{ fontSize: 14 }}>{data.title}</b>
        <div className="spacer" />
        <ThemeToggle />
        <Timer seconds={data.seconds_left} onExpire={() => submitAll(true)} />
        <button className="btn primary" disabled={busy === 'submit'} onClick={() => submitAll(false)}>
          Submit assessment
        </button>
      </div>
      <div className="exam" ref={examRef}
        style={{ gridTemplateColumns: `${leftW}% 8px 1fr` }}>
        <div className="exam-left">
          <div className="qnav">
            {data.questions.map((qq, i) => (
              <button key={qq.question_id}
                className={(i === idx ? 'cur ' : '') + (answered(qq.question_id) ? 'done' : '')}
                onClick={() => setIdx(i)}>{i + 1}</button>
            ))}
          </div>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>{q.title}</h2>
          <div className="muted" style={{ marginBottom: 14, fontSize: 12 }}>
            <span className="pill open" style={{ fontSize: 10, marginRight: 8 }}>{q.marks} marks</span>
            {q.qtype.replace('_', ' ')}
          </div>
          {q.qtype !== 'fill_blank' && <MD text={q.statement} />}
          {q.qtype === 'fill_blank' && <p className="muted">Fill the blanks on the right.</p>}
        </div>

        <div className="v-divider" title="Drag to resize"
          onMouseDown={startDrag('v', 'col-resize')} onTouchStart={startDrag('v', 'col-resize')} />

        <div className="exam-right" ref={rightRef}>
          <div className="work">
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {q.qtype === 'python' && (
                <Editor height="100%" language="python" theme="vs-dark"
                  value={ans.code ?? q.config.starter_code ?? ''}
                  onChange={v => update(q.question_id, { code: v ?? '' })}
                  options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true,
                    padding: { top: 16 }, smoothScrolling: true, cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on' }} />
              )}
              {q.qtype === 'sql' && (
                <Editor height="100%" language="sql" theme="vs-dark"
                  value={ans.query ?? ''}
                  onChange={v => update(q.question_id, { query: v ?? '' })}
                  options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true,
                    padding: { top: 16 }, smoothScrolling: true, cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on' }} />
              )}
              {q.qtype === 'mcq_single' && (
                <div style={{ padding: 18, overflowY: 'auto' }}>
                  {q.config.options.map((o, i) => (
                    <label className="opt" key={i}>
                      <input type="radio" name={'q' + q.question_id} checked={ans.selected === i}
                        onChange={() => update(q.question_id, { selected: i })} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.qtype === 'mcq_multi' && (
                <div style={{ padding: 18, overflowY: 'auto' }}>
                  {q.config.partial && <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Partial marking is on.</p>}
                  {q.config.options.map((o, i) => {
                    const sel = ans.selected || []
                    return (
                      <label className="opt" key={i}>
                        <input type="checkbox" checked={sel.includes(i)}
                          onChange={e => {
                            const next = e.target.checked ? [...sel, i] : sel.filter(x => x !== i)
                            update(q.question_id, { selected: next })
                          }} />
                        <span>{o}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              {q.qtype === 'fill_blank' && (
                <FillBlanks statement={q.statement} count={q.config.blank_count}
                  value={ans.blanks} onChange={b => update(q.question_id, { blanks: b })} />
              )}
              {q.qtype === 'descriptive' && (
                <textarea style={{ flex: 1, margin: 16, width: 'auto', minHeight: 200 }}
                  placeholder="Type your answer here…"
                  value={ans.text || ''}
                  onChange={e => update(q.question_id, { text: e.target.value })} />
              )}
            </div>

            {hasOutput && (
              <>
                <div className="h-divider" title="Drag to resize"
                  onMouseDown={startDrag('h', 'row-resize')} onTouchStart={startDrag('h', 'row-resize')} />
                <div style={{ height: `${outH}%`, minHeight: 100, overflowY: 'auto', flexShrink: 0,
                              padding: '12px 16px', background: 'var(--panel)' }}>
                {q.qtype === 'python' && showStdin && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ margin: '0 0 4px', textTransform: 'none' }}>Custom input (stdin) for "Run my code"</label>
                    <textarea rows={2} value={stdin[q.question_id] || ''}
                      onChange={e => setStdin(s => ({ ...s, [q.question_id]: e.target.value }))} />
                  </div>
                )}
                {rr && (
                  <>
                    <b style={{ fontSize: 13 }}>Visible test cases: {rr.cases.filter(c => c.passed).length}/{rr.cases.length} passed</b>
                    <CaseResults res={rr} />
                  </>
                )}
                {fr && (
                  <>
                    <b style={{ fontSize: 13 }}>Your output</b>
                    <FreeRunResult res={fr} />
                  </>
                )}
                </div>
              </>
            )}
          </div>
          <div className="exam-actions">
            {isCoding && (
              <>
                {freeAllowed && (
                  <button className="btn" disabled={busy === 'free'} onClick={runFree}
                    style={busy !== 'free' ? { background: 'var(--ok-bg)', color: 'var(--ok)', borderColor: 'var(--ok)' } : {}}>
                    {busy === 'free' ? 'Running…' : '▶ Run my code'}
                  </button>
                )}
                <button className="btn" disabled={busy === 'run'} onClick={runGraded}>
                  {busy === 'run' ? 'Running…' : '✓ Run visible cases'}
                </button>
                {q.qtype === 'python' && freeAllowed && (
                  <button className="btn sm" onClick={() => setShowStdin(s => !s)}>
                    {showStdin ? 'Hide input' : 'Custom input'}
                  </button>
                )}
              </>
            )}
            <div className="auto-save-indicator">
              {saveErr
                ? <><span className="save-dot" style={{ background: 'var(--bad)', animation: 'none' }}></span> <span style={{ color: 'var(--bad)' }}>Save failed — check connection</span></>
                : <><span className="save-dot"></span> Auto-saved</>
              }
            </div>
            <div className="spacer" />
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>← Prev</button>
            <button className="btn" disabled={idx === data.questions.length - 1} onClick={() => setIdx(i => i + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </>
  )
}

function ReviewItem({ it, index }) {
  const [open, setOpen] = useState(false)
  const p = it.payload || {}
  const rv = it.review || {}

  const scorePercent = it.score !== null && it.marks > 0 ? Math.round((it.score / it.marks) * 100) : null
  const circumference = 2 * Math.PI * 28
  const offset = scorePercent !== null ? circumference - (scorePercent / 100) * circumference : circumference

  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
      <div className="row">
        {scorePercent !== null && (
          <div className="score-ring">
            <svg viewBox="0 0 64 64">
              <circle className="ring-bg" cx="32" cy="32" r="28" />
              <circle className="ring-fg animated" cx="32" cy="32" r="28"
                style={{ '--offset': offset, strokeDashoffset: offset }} />
            </svg>
            <div className="ring-text" style={{ color: scorePercent >= 70 ? 'var(--ok)' : scorePercent >= 40 ? 'var(--warn)' : 'var(--bad)' }}>
              {scorePercent}%
            </div>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <b>Q{index + 1}. {it.title}</b>
          <div className="muted" style={{ fontSize: 12 }}>{it.qtype.replace('_', ' ')} · {it.marks} marks</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <b style={{ fontSize: 18, color: it.score === null ? 'var(--warn)' : 'var(--accent)' }}>
            {it.score === null ? 'Pending' : `${it.score} / ${it.marks}`}
          </b>
        </div>
        <span className="muted" style={{ fontSize: 18 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
          <MD text={it.statement} />

          <h4 style={{ margin: '16px 0 8px', color: 'var(--accent)' }}>Your answer</h4>
          {!it.payload && <p className="muted">Not attempted.</p>}
          {p.code !== undefined && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{p.code}</pre>}
          {p.query !== undefined && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{p.query}</pre>}
          {p.text !== undefined && <pre className="case" style={{ whiteSpace: 'pre-wrap' }}>{p.text}</pre>}
          {p.selected !== undefined && (
            <p>You selected: <b>{Array.isArray(p.selected)
              ? p.selected.map(x => rv.options?.[x]).join(', ') || '—'
              : rv.options?.[p.selected] ?? '—'}</b></p>
          )}
          {p.blanks && <p>You wrote: {p.blanks.map((b, j) => <code key={j} style={{ marginRight: 8 }}>{b || '—'}</code>)}</p>}

          {it.detail?.cases && (
            <div style={{ display: 'flex', gap: 5, margin: '8px 0' }}>
              {it.detail.cases.map((c, j) => (
                <span key={j} className={'pill ' + (c.passed ? 'pass' : 'fail')}>
                  TC{c.index + 1} {c.passed ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}

          {(rv.solution || rv.correct_sql || rv.correct !== undefined || rv.accepted) && (
            <h4 style={{ margin: '16px 0 8px', color: 'var(--ok)' }}>Expected answer</h4>
          )}
          {rv.solution && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{rv.solution}</pre>}
          {it.qtype === 'python' && !rv.solution && (rv.correct !== undefined || rv.test_cases) && (
            <p className="muted">No model solution was provided for this question.</p>
          )}
          {rv.test_cases && rv.test_cases.filter(tc => tc.visible).map((tc, j) => (
            <div className="case" key={j}>
              {tc.input !== '' && <pre>Input:{'\n'}{tc.input}</pre>}
              <pre>Expected output:{'\n'}{tc.expected}</pre>
            </div>
          ))}
          {rv.correct_sql && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{rv.correct_sql}</pre>}
          {rv.correct !== undefined && rv.options && (
            <p>Correct: <b style={{ color: 'var(--ok)' }}>{Array.isArray(rv.correct)
              ? rv.correct.map(x => rv.options[x]).join(', ')
              : rv.options[rv.correct]}</b></p>
          )}
          {rv.accepted && (
            <p>Accepted answers: {rv.accepted.map((arr, j) => (
              <code key={j} style={{ marginRight: 10, color: 'var(--ok)' }}>{arr.join(' / ')}</code>
            ))}</p>
          )}
        </div>
      )}
    </div>
  )
}

function ResultView({ aid, onBack }) {
  const [r, setR] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api(`/student/assessments/${aid}/result`).then(setR).catch(e => setErr(e.message)) }, [aid])

  const totalPercent = r && r.max > 0 ? Math.round((r.total / r.max) * 100) : 0

  return (
    <div className="page">
      <button className="btn sm" onClick={onBack}>← Back</button>
      {err && <div className="error">{err}</div>}
      {r && (
        <>
          <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <h2 style={{ marginBottom: 4 }}>{r.title}</h2>
            <div style={{ fontSize: 42, fontWeight: 700, color: 'var(--accent)', margin: '16px 0 4px' }}>
              {r.total} <span style={{ fontSize: 20, color: 'var(--muted)' }}>/ {r.max}</span>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>{totalPercent}% overall</div>
            <div style={{
              width: '100%', height: 6, borderRadius: 3,
              background: 'var(--line)', margin: '16px 0 8px', overflow: 'hidden'
            }}>
              <div style={{
                width: `${totalPercent}%`, height: '100%', borderRadius: 3,
                background: 'linear-gradient(90deg, var(--accent), var(--accent2))',
                transition: 'width 1s cubic-bezier(0.16,1,0.3,1)'
              }} />
            </div>
            <p className="muted" style={{ fontSize: 12 }}>Click any question below to review your answer.</p>
          </div>
          {r.items.map((it, i) => <ReviewItem key={i} it={it} index={i} />)}
        </>
      )}
    </div>
  )
}

export default function StudentApp({ auth, onLogout }) {
  const [view, setView] = useState({ name: 'home' })
  const [list, setList] = useState([])
  const load = () => api('/student/assessments').then(setList).catch(() => {})
  useEffect(() => { load() }, [view])

  if (view.name === 'exam') return <Exam aid={view.aid} onExit={() => setView({ name: 'home' })} />
  if (view.name === 'result') return (
    <>
      <div className="topbar">
        <div>
          <div className="brand">Assess<span>Hub</span></div>
          <div className="company-badge">Kantaka Sodhana</div>
        </div>
        <div className="spacer" />
        <ThemeToggle />
        <span style={{ fontSize: 13 }}>{auth.username}</span>
        <button className="btn sm" onClick={onLogout}>Log out</button>
      </div>
      <ResultView aid={view.aid} onBack={() => setView({ name: 'home' })} />
    </>
  )

  const STATUS_CONFIG = {
    open: { label: 'Open', icon: '🟢' },
    in_progress: { label: 'In progress', icon: '🔵' },
    submitted: { label: 'Submitted', icon: '✅' },
    upcoming: { label: 'Upcoming', icon: '🕐' },
    closed: { label: 'Closed', icon: '🔴' },
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="brand">Assess<span>Hub</span></div>
          <div className="company-badge">Kantaka Sodhana</div>
        </div>
        <div className="spacer" />
        <ThemeToggle />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 600, fontSize: 13
          }}>
            {(auth.username?.[0] || '?').toUpperCase()}
          </div>
          <span style={{ fontSize: 13 }}>{auth.full_name || auth.username}</span>
        </div>
        <button className="btn sm" onClick={onLogout}>Log out</button>
      </div>
      <div className="page">
        <h2 style={{ marginBottom: 20 }}>Your assessments</h2>
        {list.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: 40 }}>Nothing assigned to you yet.</p>}
        {list.map(a => {
          const sc = STATUS_CONFIG[a.status] || { label: a.status, icon: '' }
          return (
            <div className="assess-card-wrap" key={a.id}>
              <div className={`assess-icon ${a.status === 'open' ? 'green' : a.status === 'in_progress' ? 'blue' : a.status === 'submitted' ? 'green' : 'amber'}`}>
                <span style={{ fontSize: 20 }}>{sc.icon}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
                {a.description && <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{a.description}</div>}
                <div className="muted" style={{ fontSize: 12 }}>
                  {a.question_count} questions
                  {a.duration_minutes ? ` · ${a.duration_minutes} min limit` : ' · untimed'}
                  {a.start_at && ` · opens ${fmtDate(a.start_at)}`}
                  {a.end_at && ` · closes ${fmtDate(a.end_at)}`}
                </div>
              </div>
              <span className={'pill ' + a.status}>{sc.label}</span>
              {(a.status === 'open' || a.status === 'in_progress') && (
                <button className="btn primary" onClick={() => setView({ name: 'exam', aid: a.id })}>
                  {a.status === 'open' ? 'Start' : 'Resume'}
                </button>
              )}
              {a.status === 'submitted' && a.show_results && (
                <button className="btn" onClick={() => setView({ name: 'result', aid: a.id })}>Review answers</button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
