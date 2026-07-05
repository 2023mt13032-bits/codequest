import React, { useEffect, useRef, useState, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { marked } from 'marked'
import { api, fmtDate } from '../api'

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
          {c.columns && (
            <table className="result-table"><thead><tr>{c.columns.map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{(c.rows || []).map((r, j) => <tr key={j}>{r.map((v, k) => <td key={k}>{v ?? 'NULL'}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      ))}
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
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const saveTimers = useRef({})

  useEffect(() => {
    api(`/student/assessments/${aid}/start`, { method: 'POST' })
      .then(d => { setData(d); setAnswers(d.saved_answers || {}) })
      .catch(e => setErr(e.message))
  }, [aid])

  const save = useCallback((qid, payload) => {
    clearTimeout(saveTimers.current[qid])
    saveTimers.current[qid] = setTimeout(() => {
      api(`/student/assessments/${aid}/save`, { method: 'POST', body: { question_id: qid, payload } })
        .catch(() => {})
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

  const runCode = async () => {
    setBusy('run')
    try {
      const body = { question_id: q.question_id }
      if (q.qtype === 'python') body.code = ans.code ?? q.config.starter_code ?? ''
      if (q.qtype === 'sql') body.query = ans.query ?? ''
      const res = await api(`/student/assessments/${aid}/run`, { method: 'POST', body })
      setRunRes(r => ({ ...r, [q.question_id]: res }))
    } catch (e) { alert(e.message) }
    setBusy('')
  }

  const answered = qid => {
    const a = answers[qid]; if (!a) return false
    return !!(a.code || a.query || a.text || a.selected !== undefined || (a.blanks && a.blanks.some(x => x)))
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">Assess<span>Hub</span></div>
        <b>{data.title}</b>
        <div className="spacer" />
        <Timer seconds={data.seconds_left} onExpire={() => submitAll(true)} />
        <button className="btn primary" disabled={busy === 'submit'} onClick={() => submitAll(false)}>
          Submit assessment
        </button>
      </div>
      <div className="exam">
        <div className="exam-left">
          <div className="qnav">
            {data.questions.map((qq, i) => (
              <button key={qq.question_id}
                className={(i === idx ? 'cur ' : '') + (answered(qq.question_id) ? 'done' : '')}
                onClick={() => setIdx(i)}>{i + 1}</button>
            ))}
          </div>
          <h2>{q.title}</h2>
          <div className="muted" style={{ marginBottom: 10 }}>{q.marks} marks · {q.qtype.replace('_', ' ')}</div>
          {q.qtype !== 'fill_blank' && <MD text={q.statement} />}
          {q.qtype === 'fill_blank' && <p className="muted">Fill the blanks on the right.</p>}
        </div>

        <div className="exam-right">
          <div className="work">
            {q.qtype === 'python' && (
              <Editor height="100%" language="python" theme="vs-dark"
                value={ans.code ?? q.config.starter_code ?? ''}
                onChange={v => update(q.question_id, { code: v ?? '' })}
                options={{ minimap: { enabled: false }, fontSize: 14 }} />
            )}
            {q.qtype === 'sql' && (
              <Editor height="100%" language="sql" theme="vs-dark"
                value={ans.query ?? ''}
                onChange={v => update(q.question_id, { query: v ?? '' })}
                options={{ minimap: { enabled: false }, fontSize: 14 }} />
            )}
            {q.qtype === 'mcq_single' && (
              <div style={{ padding: 16 }}>
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
              <div style={{ padding: 16 }}>
                {q.config.partial && <p className="muted">Partial marking is on.</p>}
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
              <textarea style={{ flex: 1, margin: 16, width: 'auto', minHeight: 300 }}
                placeholder="Type your answer here…"
                value={ans.text || ''}
                onChange={e => update(q.question_id, { text: e.target.value })} />
            )}
            {(q.qtype === 'python' || q.qtype === 'sql') && rr && (
              <div style={{ padding: '0 14px 14px', maxHeight: '45%', overflowY: 'auto' }}>
                <b>Run result (visible test cases only): {rr.cases.filter(c => c.passed).length}/{rr.cases.length} passed</b>
                <CaseResults res={rr} />
              </div>
            )}
          </div>
          <div className="exam-actions">
            {(q.qtype === 'python' || q.qtype === 'sql') && (
              <button className="btn" disabled={busy === 'run'} onClick={runCode}>
                {busy === 'run' ? 'Running…' : '▶ Run (visible cases)'}
              </button>
            )}
            <span className="muted">Answers auto-save as you type.</span>
            <div className="spacer" />
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>← Prev</button>
            <button className="btn" disabled={idx === data.questions.length - 1} onClick={() => setIdx(i => i + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </>
  )
}

function ResultView({ aid, onBack }) {
  const [r, setR] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api(`/student/assessments/${aid}/result`).then(setR).catch(e => setErr(e.message)) }, [aid])
  return (
    <div className="page">
      <button className="btn sm" onClick={onBack}>← Back</button>
      {err && <div className="error">{err}</div>}
      {r && (
        <div className="card">
          <h2>{r.title}</h2>
          <h3>Score: {r.total} / {r.max}</h3>
          <table><thead><tr><th>Question</th><th>Type</th><th>Score</th></tr></thead>
            <tbody>{r.items.map((it, i) => (
              <tr key={i}><td>{it.title}</td><td>{it.qtype}</td>
                <td>{it.score === null ? 'Pending (manual grading)' : `${it.score} / ${it.marks}`}</td></tr>
            ))}</tbody></table>
        </div>
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
      <div className="topbar"><div className="brand">Assess<span>Hub</span></div><div className="spacer" />
        <span>{auth.username}</span><button className="btn sm" onClick={onLogout}>Log out</button></div>
      <ResultView aid={view.aid} onBack={() => setView({ name: 'home' })} />
    </>
  )

  return (
    <>
      <div className="topbar">
        <div className="brand">Assess<span>Hub</span></div>
        <div className="spacer" />
        <span>{auth.full_name || auth.username}</span>
        <button className="btn sm" onClick={onLogout}>Log out</button>
      </div>
      <div className="page">
        <h2>Your assessments</h2>
        {list.length === 0 && <p className="muted">Nothing assigned to you yet.</p>}
        {list.map(a => (
          <div className="card" key={a.id}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 16 }}>{a.title}</b>
                <div className="muted">{a.description}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {a.question_count} questions
                  {a.duration_minutes ? ` · ${a.duration_minutes} min limit` : ' · untimed'}
                  {a.start_at && ` · opens ${fmtDate(a.start_at)}`}
                  {a.end_at && ` · closes ${fmtDate(a.end_at)}`}
                </div>
              </div>
              <span className={'pill ' + a.status}>{a.status.replace('_', ' ')}</span>
              {(a.status === 'open' || a.status === 'in_progress') && (
                <button className="btn primary" onClick={() => setView({ name: 'exam', aid: a.id })}>
                  {a.status === 'open' ? 'Start' : 'Resume'}
                </button>
              )}
              {a.status === 'submitted' && a.show_results && (
                <button className="btn" onClick={() => setView({ name: 'result', aid: a.id })}>View result</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
