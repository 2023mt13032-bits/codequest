"""Grading engine for all question types."""
import os
import re
import uuid

import httpx
import psycopg2
import psycopg2.extensions

EXECUTOR_URL = os.getenv("EXECUTOR_URL", "http://executor:8001")
EXECUTOR_SECRET = os.getenv("EXECUTOR_SECRET", "")
SANDBOX_DSN = os.getenv(
    "SANDBOX_DATABASE_URL",
    "postgresql://sandbox:sandbox@sqlsandbox:5432/sandbox",
)
STATEMENT_TIMEOUT_MS = int(os.getenv("SQL_TIMEOUT_MS", "10000"))


def _norm_output(s: str) -> str:
    lines = [ln.rstrip() for ln in (s or "").replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


# ---------------- Python ----------------

def run_python(code: str, stdin: str, time_limit: int) -> dict:
    """Send code to the isolated executor service."""
    try:
        headers = {}
        if EXECUTOR_SECRET:
            headers["X-Executor-Secret"] = EXECUTOR_SECRET
        r = httpx.post(
            f"{EXECUTOR_URL}/run",
            json={"code": code, "stdin": stdin, "time_limit": time_limit},
            headers=headers,
            timeout=time_limit + 15,
        )
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as e:
        return {"stdout": "", "stderr": f"Executor error: {e}", "timed_out": False, "exit_code": -1}


def grade_python(config: dict, code: str, only_visible: bool = False) -> dict:
    time_limit = int(config.get("time_limit") or 10)
    cases = config.get("test_cases", [])
    results, score, total = [], 0.0, 0.0
    for i, tc in enumerate(cases):
        visible = bool(tc.get("visible", False))
        marks = float(tc.get("marks", 1))
        total += marks
        if only_visible and not visible:
            continue
        out = run_python(code, tc.get("input", ""), time_limit)
        passed = (not out["timed_out"] and out["exit_code"] == 0 and
                  _norm_output(out["stdout"]) == _norm_output(tc.get("expected", "")))
        if passed:
            score += marks
        results.append({
            "index": i, "visible": visible, "passed": passed, "marks": marks,
            "timed_out": out["timed_out"],
            # only expose IO details for visible cases
            "input": tc.get("input", "") if visible else None,
            "expected": tc.get("expected", "") if visible else None,
            "actual": out["stdout"][:5000] if visible else None,
            "stderr": out["stderr"][:5000] if visible else ("(hidden)" if out["stderr"] else None),
        })
    return {"cases": results, "score": round(score, 2), "max": round(total, 2)}


# ---------------- SQL ----------------

FORBIDDEN_SQL = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|do)\b",
    re.IGNORECASE,
)


def _run_sql_case(seed_sql: str, query: str, correct_sql: str, order_sensitive: bool) -> dict:
    """Create throwaway schema, seed, run both queries, compare, drop schema."""
    schema = "run_" + uuid.uuid4().hex[:12]
    conn = psycopg2.connect(SANDBOX_DSN)
    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        cur = conn.cursor()
        cur.execute(f'CREATE SCHEMA "{schema}"')
        cur.execute(f'SET search_path TO "{schema}"')
        cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
        cur.execute(seed_sql)

        def fetch(sql):
            cur.execute(sql)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [tuple(str(v) if v is not None else None for v in r) for r in cur.fetchall()] if cur.description else []
            return cols, rows

        exp_cols, exp_rows = fetch(correct_sql)

        if FORBIDDEN_SQL.search(query or ""):
            return {"passed": False, "error": "Only read-only SELECT queries are allowed.",
                    "columns": [], "rows": [], "expected_columns": exp_cols}
        try:
            got_cols, got_rows = fetch(query)
        except Exception as e:
            return {"passed": False, "error": str(e).strip()[:2000],
                    "columns": [], "rows": [], "expected_columns": exp_cols}

        a, b = (got_rows, exp_rows) if order_sensitive else (sorted(got_rows), sorted(exp_rows))
        passed = ([c.lower() for c in got_cols] == [c.lower() for c in exp_cols]) and a == b
        return {"passed": passed, "error": None,
                "columns": got_cols, "rows": got_rows[:100],
                "expected_columns": exp_cols}
    finally:
        try:
            cur2 = conn.cursor()
            cur2.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        except Exception:
            pass
        conn.close()


def run_sql_free(config: dict, query: str) -> dict:
    """Run the student's query against the first visible dataset, no grading —
    just return the result table so they can see their own output."""
    datasets = config.get("datasets") or [{"seed_sql": config.get("seed_sql", ""), "visible": True}]
    ds = next((d for d in datasets if d.get("visible", True)), datasets[0])
    schema = "run_" + uuid.uuid4().hex[:12]
    conn = psycopg2.connect(SANDBOX_DSN)
    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        cur = conn.cursor()
        cur.execute(f'CREATE SCHEMA "{schema}"')
        cur.execute(f'SET search_path TO "{schema}"')
        cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
        cur.execute(ds.get("seed_sql", ""))
        if FORBIDDEN_SQL.search(query or ""):
            return {"error": "Only read-only SELECT queries are allowed.", "columns": [], "rows": []}
        try:
            cur.execute(query)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [tuple(str(v) if v is not None else None for v in r)
                    for r in cur.fetchall()][:200] if cur.description else []
            return {"error": None, "columns": cols, "rows": rows}
        except Exception as e:
            return {"error": str(e).strip()[:2000], "columns": [], "rows": []}
    finally:
        try:
            cur2 = conn.cursor()
            cur2.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        except Exception:
            pass
        conn.close()


def grade_sql(config: dict, query: str, only_visible: bool = False) -> dict:
    correct_sql = config.get("correct_sql", "")
    order_sensitive = bool(config.get("order_sensitive", False))
    datasets = config.get("datasets") or [
        {"seed_sql": config.get("seed_sql", ""), "marks": 1, "visible": True}
    ]
    results, score, total = [], 0.0, 0.0
    for i, ds in enumerate(datasets):
        visible = bool(ds.get("visible", True))
        marks = float(ds.get("marks", 1))
        total += marks
        if only_visible and not visible:
            continue
        try:
            res = _run_sql_case(ds.get("seed_sql", ""), query, correct_sql, order_sensitive)
        except Exception as e:
            res = {"passed": False, "error": f"Sandbox error: {e}", "columns": [], "rows": []}
        if res["passed"]:
            score += marks
        results.append({
            "index": i, "visible": visible, "passed": res["passed"], "marks": marks,
            "error": res.get("error"),
            "columns": res.get("columns") if visible else None,
            "rows": res.get("rows") if visible else None,
        })
    return {"cases": results, "score": round(score, 2), "max": round(total, 2)}


# ---------------- Objective types ----------------

def grade_mcq_single(config: dict, selected, marks: float) -> dict:
    correct = config.get("correct")
    ok = selected is not None and int(selected) == int(correct)
    return {"score": marks if ok else 0.0, "correct": ok}


def grade_mcq_multi(config: dict, selected, marks: float) -> dict:
    correct = set(int(x) for x in config.get("correct", []))
    chosen = set(int(x) for x in (selected or []))
    if config.get("partial"):
        if not correct:
            return {"score": 0.0, "correct": False}
        right = len(chosen & correct)
        wrong = len(chosen - correct)
        frac = max(0.0, (right - wrong) / len(correct))
        return {"score": round(marks * frac, 2), "correct": chosen == correct}
    ok = chosen == correct
    return {"score": marks if ok else 0.0, "correct": ok}


def grade_fill_blank(config: dict, blanks, marks: float) -> dict:
    defs = config.get("blanks", [])
    blanks = blanks or []
    per, hits = [], 0
    for i, d in enumerate(defs):
        given = (blanks[i] if i < len(blanks) else "") or ""
        answers = d.get("answers", [])
        cs = bool(d.get("case_sensitive", False))
        g = given.strip()
        ok = any((g == a.strip()) if cs else (g.lower() == a.strip().lower()) for a in answers)
        hits += 1 if ok else 0
        per.append(ok)
    if not defs:
        return {"score": 0.0, "per_blank": []}
    if config.get("all_or_nothing"):
        return {"score": marks if hits == len(defs) else 0.0, "per_blank": per}
    return {"score": round(marks * hits / len(defs), 2), "per_blank": per}


def effective_marks(aq) -> float:
    return aq.marks_override if aq.marks_override is not None else aq.question.marks


def grade_answer(question, marks: float, payload: dict) -> tuple:
    """Returns (auto_score, detail). Descriptive returns (None, {})."""
    t, cfg = question.qtype, question.config or {}
    if t == "python":
        res = grade_python(cfg, payload.get("code", ""))
        scale = marks / res["max"] if res["max"] else 0
        return round(res["score"] * scale, 2), res
    if t == "sql":
        res = grade_sql(cfg, payload.get("query", ""))
        scale = marks / res["max"] if res["max"] else 0
        return round(res["score"] * scale, 2), res
    if t == "mcq_single":
        res = grade_mcq_single(cfg, payload.get("selected"), marks)
        return res["score"], res
    if t == "mcq_multi":
        res = grade_mcq_multi(cfg, payload.get("selected"), marks)
        return res["score"], res
    if t == "fill_blank":
        res = grade_fill_blank(cfg, payload.get("blanks"), marks)
        return res["score"], res
    return None, {}