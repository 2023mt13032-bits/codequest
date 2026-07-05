import React, { useEffect, useState } from 'react'
import { api, downloadCsv, fmtDate, toLocalInput, fromLocalInput } from '../api'
import { ThemeToggle } from '../theme'

const TYPES = {
  python: 'Python coding', sql: 'SQL (PostgreSQL)', mcq_single: 'MCQ (single answer)',
  mcq_multi: 'MCQ (multiple answers)', fill_blank: 'Fill in the blanks', descriptive: 'Descriptive',
}

/* ---------------- Question editor ---------------- */

function defaultConfig(t) {
  if (t === 'python') return { starter_code: '', time_limit: 10, test_cases: [{ input: '', expected: '', marks: 1, visible: true }] }
  if (t === 'sql') return { correct_sql: '', order_sensitive: false, datasets: [{ seed_sql: '', marks: 1, visible: true }] }
  if (t === 'mcq_single') return { options: ['', ''], correct: 0 }
  if (t === 'mcq_multi') return { options: ['', ''], correct: [], partial: false }
  if (t === 'fill_blank') return { blanks: [{ answers: [''], case_sensitive: false }], all_or_nothing: false }
  return {}
}

function QuestionEditor({ initial, onSaved, onCancel }) {
  const [q, setQ] = useState(initial || {
    qtype: 'python', title: '', statement: '', marks: 10, tags: '', config: defaultConfig('python'),
  })
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const cfg = q.config
  const setCfg = c => setQ({ ...q, config: { ...cfg, ...c } })
  const setType = t => setQ({ ...q, qtype: t, config: defaultConfig(t) })

  const save = async () => {
    setErr('')
    try {
      const body = { ...q, marks: Number(q.marks) }
      const saved = q.id
        ? await api(`/admin/questions/${q.id}`, { method: 'PUT', body })
        : await api('/admin/questions', { method: 'POST', body })
      onSaved(saved)
    } catch (e) { setErr(e.message) }
  }

  const sqlPreview = async () => {
    setPreview({ loading: true })
    try {
      const ds = cfg.datasets?.[0] || {}
      const res = await api('/admin/questions/sql-preview', {
        method: 'POST', body: { seed_sql: ds.seed_sql || '', correct_sql: cfg.correct_sql || '' },
      })
      setPreview(res)
    } catch (e) { setPreview({ error: e.message }) }
  }

  return (
    <div className="card">
      <h3>{q.id ? 'Edit question' : 'New question'}</h3>
      <div className="grid2">
        <div>
          <label>Type</label>
          <select value={q.qtype} disabled={!!q.id} onChange={e => setType(e.target.value)}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label>Total marks</label>
          <input type="number" value={q.marks} onChange={e => setQ({ ...q, marks: e.target.value })} /></div>
      </div>
      <label>Title</label>
      <input value={q.title} onChange={e => setQ({ ...q, title: e.target.value })} />
      <label>Problem statement (Markdown supported{q.qtype === 'fill_blank' && '; use {{blank}} where each blank goes'})</label>
      <textarea rows={5} value={q.statement} onChange={e => setQ({ ...q, statement: e.target.value })} />
      <label>Tags (optional, comma separated)</label>
      <input value={q.tags} onChange={e => setQ({ ...q, tags: e.target.value })} />

      {q.qtype === 'python' && (
        <>
          <label>Starter code (optional)</label>
          <textarea rows={4} value={cfg.starter_code} onChange={e => setCfg({ starter_code: e.target.value })} />
          <label>Model solution (optional — shown to students in their post-submit review if results are visible)</label>
          <textarea rows={4} className="mono" value={cfg.solution || ''} onChange={e => setCfg({ solution: e.target.value })} />
          <label>Time limit per test case (seconds)</label>
          <input type="number" style={{ width: 120 }} value={cfg.time_limit}
            onChange={e => setCfg({ time_limit: Number(e.target.value) })} />
          <label style={{ margin: '10px 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={cfg.allow_free_run !== false}
              onChange={e => setCfg({ allow_free_run: e.target.checked })} />
            {' '}Allow "Run my code" (student can run with their own custom input; untick to only allow running your visible test cases)
          </label>
          <label>Test cases (hidden cases run only on final submit)</label>
          {cfg.test_cases.map((tc, i) => (
            <div className="tc-editor" key={i}>
              <div className="row">
                <b>Test case {i + 1}</b>
                <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={tc.visible}
                  onChange={e => { const t = [...cfg.test_cases]; t[i] = { ...tc, visible: e.target.checked }; setCfg({ test_cases: t }) }} /> visible to student</label>
                <span>Marks: <input type="number" style={{ width: 70, display: 'inline-block' }} value={tc.marks}
                  onChange={e => { const t = [...cfg.test_cases]; t[i] = { ...tc, marks: Number(e.target.value) }; setCfg({ test_cases: t }) }} /></span>
                <div className="spacer" />
                <button className="btn sm danger" onClick={() => setCfg({ test_cases: cfg.test_cases.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <div className="grid2">
                <div><label>Stdin input</label>
                  <textarea rows={3} value={tc.input}
                    onChange={e => { const t = [...cfg.test_cases]; t[i] = { ...tc, input: e.target.value }; setCfg({ test_cases: t }) }} /></div>
                <div><label>Expected stdout</label>
                  <textarea rows={3} value={tc.expected}
                    onChange={e => { const t = [...cfg.test_cases]; t[i] = { ...tc, expected: e.target.value }; setCfg({ test_cases: t }) }} /></div>
              </div>
            </div>
          ))}
          <button className="btn sm" onClick={() => setCfg({ test_cases: [...cfg.test_cases, { input: '', expected: '', marks: 1, visible: false }] })}>+ Add test case</button>
        </>
      )}

      {q.qtype === 'sql' && (
        <>
          <label>Correct SQL query (used to compute the expected result)</label>
          <textarea rows={3} className="mono" value={cfg.correct_sql} onChange={e => setCfg({ correct_sql: e.target.value })} />
          <label style={{ margin: '10px 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={cfg.order_sensitive}
              onChange={e => setCfg({ order_sensitive: e.target.checked })} /> Row order matters (use when the question asks for ORDER BY)
          </label>
          <label style={{ margin: '10px 0' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={cfg.allow_free_run !== false}
              onChange={e => setCfg({ allow_free_run: e.target.checked })} />
            {' '}Allow "Run my code" (student can see their query's raw result table; untick to only allow the graded visible-case check)
          </label>
          <label>Datasets (each is one graded test case with its own seed data)</label>
          {cfg.datasets.map((ds, i) => (
            <div className="tc-editor" key={i}>
              <div className="row">
                <b>Dataset {i + 1}</b>
                <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={ds.visible}
                  onChange={e => { const d = [...cfg.datasets]; d[i] = { ...ds, visible: e.target.checked }; setCfg({ datasets: d }) }} /> visible</label>
                <span>Marks: <input type="number" style={{ width: 70, display: 'inline-block' }} value={ds.marks}
                  onChange={e => { const d = [...cfg.datasets]; d[i] = { ...ds, marks: Number(e.target.value) }; setCfg({ datasets: d }) }} /></span>
                <div className="spacer" />
                <button className="btn sm danger" onClick={() => setCfg({ datasets: cfg.datasets.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <label>Seed SQL (CREATE TABLE + INSERTs)</label>
              <textarea rows={4} className="mono" value={ds.seed_sql}
                onChange={e => { const d = [...cfg.datasets]; d[i] = { ...ds, seed_sql: e.target.value }; setCfg({ datasets: d }) }} />
            </div>
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => setCfg({ datasets: [...cfg.datasets, { seed_sql: '', marks: 1, visible: false }] })}>+ Add dataset</button>
            <button className="btn sm" onClick={sqlPreview}>Preview expected result (dataset 1)</button>
          </div>
          {preview && (
            <div className="case">
              {preview.loading && 'Running…'}
              {preview.error && <span className="error">{preview.error}</span>}
              {preview.columns && (
                <table className="result-table"><thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? 'NULL'}</td>)}</tr>)}</tbody></table>
              )}
            </div>
          )}
        </>
      )}

      {(q.qtype === 'mcq_single' || q.qtype === 'mcq_multi') && (
        <>
          <label>Options — mark the correct one{q.qtype === 'mcq_multi' && 's'}</label>
          {cfg.options.map((o, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              {q.qtype === 'mcq_single'
                ? <input type="radio" style={{ width: 'auto' }} checked={cfg.correct === i} onChange={() => setCfg({ correct: i })} />
                : <input type="checkbox" style={{ width: 'auto' }} checked={cfg.correct.includes(i)}
                    onChange={e => setCfg({ correct: e.target.checked ? [...cfg.correct, i] : cfg.correct.filter(x => x !== i) })} />}
              <input style={{ flex: 1 }} value={o} placeholder={`Option ${i + 1}`}
                onChange={e => { const opts = [...cfg.options]; opts[i] = e.target.value; setCfg({ options: opts }) }} />
              <button className="btn sm danger" onClick={() => setCfg({
                options: cfg.options.filter((_, j) => j !== i),
                correct: q.qtype === 'mcq_single' ? (cfg.correct === i ? 0 : cfg.correct > i ? cfg.correct - 1 : cfg.correct)
                  : cfg.correct.filter(x => x !== i).map(x => x > i ? x - 1 : x),
              })}>✕</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setCfg({ options: [...cfg.options, ''] })}>+ Add option</button>
          {q.qtype === 'mcq_multi' && (
            <label style={{ marginTop: 10 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={cfg.partial}
                onChange={e => setCfg({ partial: e.target.checked })} /> Partial marking (otherwise all-or-nothing)
            </label>
          )}
        </>
      )}

      {q.qtype === 'fill_blank' && (
        <>
          <p className="muted">Number of blanks here must match the number of {'{{blank}}'} markers in the statement.</p>
          {cfg.blanks.map((b, i) => (
            <div className="tc-editor" key={i}>
              <div className="row">
                <b>Blank {i + 1}</b>
                <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={b.case_sensitive}
                  onChange={e => { const bl = [...cfg.blanks]; bl[i] = { ...b, case_sensitive: e.target.checked }; setCfg({ blanks: bl }) }} /> case sensitive</label>
                <div className="spacer" />
                <button className="btn sm danger" onClick={() => setCfg({ blanks: cfg.blanks.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <label>Accepted answers (comma separated — any one is correct)</label>
              <input value={b.answers.join(', ')}
                onChange={e => { const bl = [...cfg.blanks]; bl[i] = { ...b, answers: e.target.value.split(',').map(s => s.trim()) }; setCfg({ blanks: bl }) }} />
            </div>
          ))}
          <button className="btn sm" onClick={() => setCfg({ blanks: [...cfg.blanks, { answers: [''], case_sensitive: false }] })}>+ Add blank</button>
          <label style={{ marginTop: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={cfg.all_or_nothing}
              onChange={e => setCfg({ all_or_nothing: e.target.checked })} /> All-or-nothing (otherwise marks split equally across blanks)
          </label>
        </>
      )}

      {q.qtype === 'descriptive' && <p className="muted">Graded manually by you from the Results screen.</p>}

      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={save}>Save question</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function QuestionsTab() {
  const [list, setList] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | question
  const load = () => api('/admin/questions').then(setList)
  useEffect(() => { load() }, [])

  if (editing) return (
    <QuestionEditor initial={editing === 'new' ? null : editing}
      onSaved={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
  )
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Question bank</h2><div className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>+ New question</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Marks</th><th>Tags</th><th></th></tr></thead>
          <tbody>{list.map(q => (
            <tr key={q.id}>
              <td>{q.id}</td><td>{q.title}</td><td>{TYPES[q.qtype]}</td><td>{q.marks}</td><td className="muted">{q.tags}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => setEditing(q)}>Edit</button>{' '}
                <button className="btn sm" onClick={() => api(`/admin/questions/${q.id}/duplicate`, { method: 'POST' }).then(load)}>Duplicate</button>{' '}
                <button className="btn sm danger" onClick={() => {
                  if (confirm('Delete this question?')) api(`/admin/questions/${q.id}`, { method: 'DELETE' }).then(load).catch(e => alert(e.message))
                }}>Delete</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {list.length === 0 && <p className="muted">No questions yet. Create your first one.</p>}
      </div>
    </>
  )
}

/* ---------------- Assessments ---------------- */

function AssessmentEditor({ initial, questions, students, onSaved, onCancel }) {
  const [a, setA] = useState(initial || {
    title: '', description: '', start_at: null, end_at: null, duration_minutes: null,
    published: false, show_results: false, assign_all: true,
    questions: [], assigned_user_ids: [],
  })
  const [err, setErr] = useState('')
  const picked = a.questions.map(x => x.question_id)

  const save = async () => {
    setErr('')
    const body = {
      title: a.title, description: a.description,
      start_at: a.start_at, end_at: a.end_at,
      duration_minutes: a.duration_minutes ? Number(a.duration_minutes) : null,
      published: a.published, show_results: a.show_results, assign_all: a.assign_all,
      question_ids: a.questions.map(x => ({ question_id: x.question_id, marks_override: x.marks_override })),
      assigned_user_ids: a.assigned_user_ids,
    }
    try {
      if (a.id) await api(`/admin/assessments/${a.id}`, { method: 'PUT', body })
      else await api('/admin/assessments', { method: 'POST', body })
      onSaved()
    } catch (e) { setErr(e.message) }
  }

  const move = (i, d) => {
    const qs = [...a.questions]
    const j = i + d; if (j < 0 || j >= qs.length) return
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    setA({ ...a, questions: qs })
  }

  return (
    <div className="card">
      <h3>{a.id ? 'Edit assessment' : 'New assessment'}</h3>
      <label>Title</label>
      <input value={a.title} onChange={e => setA({ ...a, title: e.target.value })} />
      <label>Description</label>
      <textarea rows={2} value={a.description} onChange={e => setA({ ...a, description: e.target.value })} />

      <div className="grid2">
        <div>
          <label>Opens at (leave empty = no start restriction)</label>
          <input type="datetime-local" value={toLocalInput(a.start_at)}
            onChange={e => setA({ ...a, start_at: fromLocalInput(e.target.value) })} />
        </div>
        <div>
          <label>Closes at (leave empty = no end restriction)</label>
          <input type="datetime-local" value={toLocalInput(a.end_at)}
            onChange={e => setA({ ...a, end_at: fromLocalInput(e.target.value) })} />
        </div>
      </div>
      <label>Duration limit in minutes once a student starts (leave empty = untimed)</label>
      <input type="number" style={{ width: 200 }} value={a.duration_minutes ?? ''}
        placeholder="e.g. 90" onChange={e => setA({ ...a, duration_minutes: e.target.value || null })} />

      <div className="row" style={{ marginTop: 12 }}>
        <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={a.published}
          onChange={e => setA({ ...a, published: e.target.checked })} /> Published (visible to students)</label>
        <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={a.show_results}
          onChange={e => setA({ ...a, show_results: e.target.checked })} /> Students can see their score after submitting</label>
      </div>

      <label>Assign to</label>
      <div className="row">
        <label style={{ margin: 0 }}><input type="radio" style={{ width: 'auto' }} checked={a.assign_all}
          onChange={() => setA({ ...a, assign_all: true })} /> All students</label>
        <label style={{ margin: 0 }}><input type="radio" style={{ width: 'auto' }} checked={!a.assign_all}
          onChange={() => setA({ ...a, assign_all: false })} /> Selected students</label>
      </div>
      {!a.assign_all && (
        <div className="row" style={{ marginTop: 8 }}>
          {students.map(s => (
            <label key={s.id} style={{ margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={a.assigned_user_ids.includes(s.id)}
                onChange={e => setA({
                  ...a, assigned_user_ids: e.target.checked
                    ? [...a.assigned_user_ids, s.id] : a.assigned_user_ids.filter(x => x !== s.id),
                })} /> {s.username}
            </label>
          ))}
        </div>
      )}

      <label>Questions in this assessment (in order)</label>
      {a.questions.map((x, i) => {
        const q = questions.find(qq => qq.id === x.question_id)
        return (
          <div className="row" key={x.question_id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <b>{i + 1}.</b> <span style={{ flex: 1 }}>{q?.title} <span className="muted">({TYPES[q?.qtype]})</span></span>
            <span>Marks: <input type="number" style={{ width: 80, display: 'inline-block' }}
              placeholder={String(q?.marks)} value={x.marks_override ?? ''}
              onChange={e => {
                const qs = [...a.questions]; qs[i] = { ...x, marks_override: e.target.value === '' ? null : Number(e.target.value) }
                setA({ ...a, questions: qs })
              }} /></span>
            <button className="btn sm" onClick={() => move(i, -1)}>↑</button>
            <button className="btn sm" onClick={() => move(i, 1)}>↓</button>
            <button className="btn sm danger" onClick={() => setA({ ...a, questions: a.questions.filter((_, j) => j !== i) })}>✕</button>
          </div>
        )
      })}
      <label>Add question from bank</label>
      <select value="" onChange={e => {
        const id = Number(e.target.value); if (!id) return
        setA({ ...a, questions: [...a.questions, { question_id: id, marks_override: null }] })
      }}>
        <option value="">— pick a question —</option>
        {questions.filter(q => !picked.includes(q.id)).map(q => (
          <option key={q.id} value={q.id}>{q.title} ({TYPES[q.qtype]}, {q.marks} marks)</option>
        ))}
      </select>

      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={save}>Save assessment</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function AssessmentsTab({ onOpenResults }) {
  const [list, setList] = useState([])
  const [questions, setQuestions] = useState([])
  const [students, setStudents] = useState([])
  const [editing, setEditing] = useState(null)
  const load = () => Promise.all([
    api('/admin/assessments').then(setList),
    api('/admin/questions').then(setQuestions),
    api('/admin/students').then(setStudents),
  ])
  useEffect(() => { load() }, [])

  if (editing) return (
    <AssessmentEditor initial={editing === 'new' ? null : editing} questions={questions} students={students}
      onSaved={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
  )
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Assessments</h2><div className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>+ New assessment</button>
      </div>
      {list.map(a => (
        <div className="card" key={a.id}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 16 }}>{a.title}</b>{' '}
              <span className={'pill ' + (a.published ? 'open' : 'closed')}>{a.published ? 'Published' : 'Draft'}</span>
              <div className="muted" style={{ marginTop: 4 }}>
                {a.questions.length} questions · {a.duration_minutes ? `${a.duration_minutes} min limit` : 'untimed'}
                {a.start_at && ` · opens ${fmtDate(a.start_at)}`}{a.end_at && ` · closes ${fmtDate(a.end_at)}`}
                {' · '}{a.assign_all ? 'all students' : `${a.assigned_user_ids.length} students`}
                {' · '}{a.attempt_count} attempts
              </div>
            </div>
            <button className="btn sm" onClick={() => onOpenResults(a)}>Results / responses</button>
            <button className="btn sm" onClick={() => setEditing(a)}>Edit</button>
            <button className="btn sm danger" onClick={() => {
              if (confirm('Delete this assessment AND all its attempts?'))
                api(`/admin/assessments/${a.id}`, { method: 'DELETE' }).then(load)
            }}>Delete</button>
          </div>
        </div>
      ))}
      {list.length === 0 && <p className="muted">No assessments yet.</p>}
    </>
  )
}

/* ---------------- Students ---------------- */

function StudentsTab() {
  const [list, setList] = useState([])
  const [form, setForm] = useState({ username: '', password: '', full_name: '' })
  const [err, setErr] = useState('')
  const load = () => api('/admin/students').then(setList)
  useEffect(() => { load() }, [])

  const create = async () => {
    setErr('')
    try {
      await api('/admin/students', { method: 'POST', body: form })
      setForm({ username: '', password: '', full_name: '' }); load()
    } catch (e) { setErr(e.message) }
  }

  return (
    <>
      <h2>Students</h2>
      <div className="card">
        <b>Create student login (share these credentials with the student)</b>
        <div className="row" style={{ marginTop: 10 }}>
          <input style={{ width: 180 }} placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          <input style={{ width: 180 }} placeholder="Password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <input style={{ width: 200 }} placeholder="Full name (optional)" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <button className="btn primary" disabled={!form.username || !form.password} onClick={create}>Create</button>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.map(s => (
            <tr key={s.id}>
              <td className="mono">{s.username}</td><td>{s.full_name}</td>
              <td>{s.active ? 'Active' : <span className="error">Deactivated</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => {
                  const p = prompt(`New password for ${s.username}:`)
                  if (p) api(`/admin/students/${s.id}/password`, { method: 'POST', body: { password: p } }).then(() => alert('Password updated'))
                }}>Reset password</button>{' '}
                <button className="btn sm" onClick={() => api(`/admin/students/${s.id}/toggle`, { method: 'POST' }).then(load)}>
                  {s.active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {list.length === 0 && <p className="muted">No students yet.</p>}
      </div>
    </>
  )
}

/* ---------------- Results ---------------- */

function AttemptView({ attemptId, onBack }) {
  const [d, setD] = useState(null)
  const load = () => api(`/admin/attempts/${attemptId}`).then(setD)
  useEffect(() => { load() }, [attemptId])
  if (!d) return <p className="muted">Loading…</p>

  const override = async (answerId, current) => {
    const v = prompt('Manual score (leave empty to clear the override):', current ?? '')
    if (v === null) return
    await api(`/admin/answers/${answerId}/override`, {
      method: 'POST', body: { manual_score: v === '' ? null : Number(v) },
    })
    load()
  }

  return (
    <>
      <button className="btn sm" onClick={onBack}>← Back to results</button>
      <div className="card" style={{ marginTop: 12 }}>
        <h3>{d.summary.username} — {d.assessment_title}</h3>
        <p className="muted">Started {fmtDate(d.summary.started_at)} · Submitted {fmtDate(d.summary.submitted_at)} ·
          Score <b>{d.summary.score} / {d.summary.max}</b>{d.summary.pending_manual && ' · has ungraded descriptive answers'}</p>
      </div>
      {d.items.map((it, i) => (
        <div className="card" key={i}>
          <div className="row">
            <b>Q{i + 1}. {it.title}</b> <span className="muted">({TYPES[it.qtype]}, {it.marks} marks)</span>
            <div className="spacer" />
            <span>Auto: <b>{it.auto_score ?? '—'}</b> · Manual: <b>{it.manual_score ?? '—'}</b></span>
            {it.answer_id && <button className="btn sm" onClick={() => override(it.answer_id, it.manual_score)}>Set / clear manual score</button>}
          </div>
          {!it.payload && <p className="muted">Not attempted.</p>}
          {it.payload?.code !== undefined && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{it.payload.code}</pre>}
          {it.payload?.query !== undefined && <pre className="case mono" style={{ whiteSpace: 'pre-wrap' }}>{it.payload.query}</pre>}
          {it.payload?.text !== undefined && <pre className="case" style={{ whiteSpace: 'pre-wrap' }}>{it.payload.text}</pre>}
          {it.payload?.selected !== undefined && (
            <p>Selected: <b>{Array.isArray(it.payload.selected)
              ? it.payload.selected.map(x => it.config.options?.[x]).join(', ') || '—'
              : it.config.options?.[it.payload.selected]}</b>
              {' '}<span className="muted">(correct: {Array.isArray(it.config.correct)
                ? it.config.correct.map(x => it.config.options?.[x]).join(', ')
                : it.config.options?.[it.config.correct]})</span></p>
          )}
          {it.payload?.blanks && (
            <p>Answers: {it.payload.blanks.map((b, j) => <code key={j} style={{ marginRight: 8 }}>{b || '—'}</code>)}
              <span className="muted"> (accepted: {(it.config.blanks || []).map(bb => bb.answers.join('/')).join(' , ')})</span></p>
          )}
          {it.detail?.cases && (
            <p className="muted">Test cases passed: {it.detail.cases.filter(c => c.passed).length}/{it.detail.cases.length}
              {' — '}{it.detail.cases.map((c, j) => (
                <span key={j} className={'pill ' + (c.passed ? 'pass' : 'fail')} style={{ marginRight: 4 }}>TC{c.index + 1}</span>
              ))}</p>
          )}
        </div>
      ))}
    </>
  )
}

function ResultsTab({ assessment, onBack }) {
  const [rows, setRows] = useState([])
  const [attempt, setAttempt] = useState(null)
  const load = () => api(`/admin/assessments/${assessment.id}/results`).then(setRows)
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [assessment.id])

  if (attempt) return <AttemptView attemptId={attempt} onBack={() => { setAttempt(null); load() }} />

  const action = async (id, act, msg) => {
    if (!confirm(msg)) return
    await api(`/admin/attempts/${id}/action`, { method: 'POST', body: { action: act } })
    load()
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn sm" onClick={onBack}>← Assessments</button>
        <h2 style={{ margin: 0 }}>{assessment.title} — results</h2>
        <div className="spacer" />
        <span className="muted">Auto-refreshes every 15s</span>
        <button className="btn" onClick={() => downloadCsv(`/admin/assessments/${assessment.id}/export`, `${assessment.title}_results.csv`)}>Export CSV</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Student</th><th>Status</th><th>Started</th><th>Submitted</th><th>Score</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.attempt_id}>
              <td>{r.username}{r.full_name && <span className="muted"> ({r.full_name})</span>}</td>
              <td><span className={'pill ' + r.status}>{r.status.replace('_', ' ')}</span></td>
              <td>{fmtDate(r.started_at)}</td><td>{fmtDate(r.submitted_at)}</td>
              <td><b>{r.score} / {r.max}</b>{r.pending_manual && <span className="muted"> (manual grading pending)</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => setAttempt(r.attempt_id)}>View responses</button>{' '}
                {r.status === 'in_progress'
                  ? <button className="btn sm" onClick={() => action(r.attempt_id, 'force_submit', 'Force-submit this attempt now?')}>Force submit</button>
                  : <button className="btn sm" onClick={() => action(r.attempt_id, 'reopen', 'Reopen this attempt so the student can continue?')}>Reopen</button>}{' '}
                <button className="btn sm danger" onClick={() => action(r.attempt_id, 'reset', 'Delete this attempt completely so the student can start fresh?')}>Reset</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {rows.length === 0 && <p className="muted">No attempts yet.</p>}
      </div>
    </>
  )
}

/* ---------------- Shell ---------------- */

export default function AdminApp({ auth, onLogout }) {
  const [tab, setTab] = useState('assessments')
  const [resultsFor, setResultsFor] = useState(null)

  return (
    <>
      <div className="topbar">
        <div className="brand">Assess<span>Hub</span></div>
        <div className="tabs">
          {['assessments', 'questions', 'students'].map(t => (
            <div key={t} className={'tab' + (tab === t && !resultsFor ? ' active' : '')}
              onClick={() => { setTab(t); setResultsFor(null) }}>
              {t[0].toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>
        <div className="spacer" />
        <ThemeToggle />
        <span>Admin: {auth.username}</span>
        <button className="btn sm" onClick={onLogout}>Log out</button>
      </div>
      <div className="page">
        {resultsFor
          ? <ResultsTab assessment={resultsFor} onBack={() => setResultsFor(null)} />
          : tab === 'assessments' ? <AssessmentsTab onOpenResults={setResultsFor} />
          : tab === 'questions' ? <QuestionsTab />
          : <StudentsTab />}
      </div>
    </>
  )
}