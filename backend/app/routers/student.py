from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user
from ..grading import (grade_answer, grade_python, grade_sql, effective_marks,
                       run_python, run_sql_free)

router = APIRouter(prefix="/api/student")


def _now():
    return datetime.utcnow()


def _assigned(a: models.Assessment, user: models.User, db: Session) -> bool:
    if a.assign_all:
        return True
    return db.query(models.AssessmentAssignment).filter_by(
        assessment_id=a.id, user_id=user.id).first() is not None


def _deadline(a: models.Assessment, att: models.Attempt | None):
    """Server-authoritative end time for an in-progress attempt (None = no limit)."""
    ends = []
    if a.end_at:
        ends.append(a.end_at)
    if a.duration_minutes and att:
        ends.append(att.started_at + timedelta(minutes=a.duration_minutes))
    return min(ends) if ends else None


def _auto_submit_if_expired(a, att, db) -> bool:
    if att and att.status == "in_progress":
        dl = _deadline(a, att)
        if dl and _now() > dl:
            att.status, att.submitted_at = "submitted", dl
            db.commit()
            return True
    return False


def _availability(a: models.Assessment, att):
    now = _now()
    if att and att.status == "submitted":
        return "submitted"
    if att:
        return "in_progress"
    if a.start_at and now < a.start_at:
        return "upcoming"
    if a.end_at and now > a.end_at:
        return "closed"
    return "open"


@router.get("/assessments")
def my_assessments(user=Depends(get_current_user), db: Session = Depends(get_db)):
    out = []
    for a in db.query(models.Assessment).filter_by(published=True).order_by(models.Assessment.id.desc()):
        if not _assigned(a, user, db):
            continue
        att = db.query(models.Attempt).filter_by(assessment_id=a.id, user_id=user.id).first()
        _auto_submit_if_expired(a, att, db)
        d = _deadline(a, att) if att and att.status == "in_progress" else None
        out.append({
            "id": a.id, "title": a.title, "description": a.description,
            "start_at": a.start_at, "end_at": a.end_at,
            "duration_minutes": a.duration_minutes,
            "status": _availability(a, att),
            "seconds_left": max(0, int((d - _now()).total_seconds())) if d else None,
            "show_results": a.show_results,
            "question_count": len(a.questions),
        })
    return out


def _student_question_view(aq):
    q = aq.question
    cfg, safe = q.config or {}, {}
    if q.qtype == "python":
        safe = {"starter_code": cfg.get("starter_code", ""),
                "time_limit": cfg.get("time_limit", 10),
                "allow_free_run": cfg.get("allow_free_run", True)}
    elif q.qtype == "sql":
        safe = {"allow_free_run": cfg.get("allow_free_run", True)}
    elif q.qtype in ("mcq_single", "mcq_multi"):
        safe = {"options": cfg.get("options", []),
                **({"partial": cfg.get("partial", False)} if q.qtype == "mcq_multi" else {})}
    elif q.qtype == "fill_blank":
        safe = {"blank_count": len(cfg.get("blanks", []))}
    return {"question_id": q.id, "title": q.title, "qtype": q.qtype,
            "statement": q.statement, "marks": effective_marks(aq), "config": safe}


@router.post("/assessments/{aid}/start")
def start_attempt(aid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid)
    if not a or not a.published or not _assigned(a, user, db):
        raise HTTPException(404, "Assessment not available")
    att = db.query(models.Attempt).filter_by(assessment_id=aid, user_id=user.id).first()
    if not att:
        now = _now()
        if a.start_at and now < a.start_at:
            raise HTTPException(400, "This assessment has not opened yet.")
        if a.end_at and now > a.end_at:
            raise HTTPException(400, "This assessment is closed.")
        att = models.Attempt(assessment_id=aid, user_id=user.id)
        db.add(att); db.commit(); db.refresh(att)
    _auto_submit_if_expired(a, att, db)
    dl = _deadline(a, att) if att.status == "in_progress" else None
    answers = {ans.question_id: ans.payload for ans in
               db.query(models.Answer).filter_by(attempt_id=att.id)}
    return {
        "attempt_id": att.id, "status": att.status,
        "seconds_left": max(0, int((dl - _now()).total_seconds())) if dl else None,
        "questions": [_student_question_view(aq) for aq in a.questions],
        "saved_answers": answers,
        "title": a.title,
    }


def _open_attempt(aid: int, user, db) -> tuple:
    a = db.get(models.Assessment, aid)
    att = db.query(models.Attempt).filter_by(assessment_id=aid, user_id=user.id).first()
    if not a or not att:
        raise HTTPException(404, "No attempt found")
    if _auto_submit_if_expired(a, att, db) or att.status != "in_progress":
        raise HTTPException(400, "Attempt already submitted / time over")
    return a, att


@router.post("/assessments/{aid}/save")
def save_answer(aid: int, body: schemas.AnswerIn, user=Depends(get_current_user),
                db: Session = Depends(get_db)):
    a, att = _open_attempt(aid, user, db)
    ans = db.query(models.Answer).filter_by(attempt_id=att.id, question_id=body.question_id).first()
    if not ans:
        ans = models.Answer(attempt_id=att.id, question_id=body.question_id)
        db.add(ans)
    ans.payload, ans.updated_at = body.payload, _now()
    db.commit()
    dl = _deadline(a, att)
    return {"ok": True, "seconds_left": max(0, int((dl - _now()).total_seconds())) if dl else None}


@router.post("/assessments/{aid}/run")
def run_code(aid: int, body: schemas.RunIn, user=Depends(get_current_user),
             db: Session = Depends(get_db)):
    """Run against VISIBLE test cases only. Does not affect grading."""
    a, att = _open_attempt(aid, user, db)
    aq = next((x for x in a.questions if x.question_id == body.question_id), None)
    if not aq:
        raise HTTPException(404, "Question not in this assessment")
    q = aq.question
    if q.qtype == "python":
        return grade_python(q.config or {}, body.code or "", only_visible=True)
    if q.qtype == "sql":
        return grade_sql(q.config or {}, body.query or "", only_visible=True)
    raise HTTPException(400, "Run is only for coding questions")


@router.post("/assessments/{aid}/run-free")
def run_code_free(aid: int, body: dict, user=Depends(get_current_user),
                  db: Session = Depends(get_db)):
    """Just run the student's code/query and show them THEIR output.
    Python: runs with custom stdin. SQL: runs against the visible dataset.
    No grading, no comparison."""
    a, att = _open_attempt(aid, user, db)
    aq = next((x for x in a.questions if x.question_id == body.get("question_id")), None)
    if not aq:
        raise HTTPException(404, "Question not in this assessment")
    q = aq.question
    if not (q.config or {}).get("allow_free_run", True):
        raise HTTPException(403, "Free run is disabled for this question")
    if q.qtype == "python":
        cfg = q.config or {}
        return {"kind": "python",
                **run_python(body.get("code") or "", body.get("stdin") or "",
                             int(cfg.get("time_limit") or 10))}
    if q.qtype == "sql":
        return {"kind": "sql", **run_sql_free(q.config or {}, body.get("query") or "")}
    raise HTTPException(400, "Run is only for coding questions")


@router.post("/assessments/{aid}/submit")
def submit_attempt(aid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    a, att = _open_attempt(aid, user, db)
    for aq in a.questions:
        ans = db.query(models.Answer).filter_by(attempt_id=att.id, question_id=aq.question_id).first()
        if not ans:
            continue
        score, detail = grade_answer(aq.question, effective_marks(aq), ans.payload or {})
        ans.auto_score, ans.detail = score, detail
    att.status, att.submitted_at = "submitted", _now()
    db.commit()
    return {"ok": True}


@router.get("/assessments/{aid}/result")
def my_result(aid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid)
    att = db.query(models.Attempt).filter_by(assessment_id=aid, user_id=user.id).first()
    if not a or not att or att.status != "submitted":
        raise HTTPException(404, "No submitted attempt")
    if not a.show_results:
        raise HTTPException(403, "Results are not visible for this assessment")
    items, total, maxm = [], 0.0, 0.0
    answers = {ans.question_id: ans for ans in db.query(models.Answer).filter_by(attempt_id=att.id)}
    for aq in a.questions:
        q, cfg = aq.question, aq.question.config or {}
        m = effective_marks(aq); maxm += m
        ans = answers.get(aq.question_id)
        s = None
        if ans:
            s = ans.manual_score if ans.manual_score is not None else ans.auto_score
        total += s or 0

        # what the admin's expected answer looks like, per type
        review = {}
        if q.qtype == "python":
            review = {"solution": cfg.get("solution", ""),
                      "test_cases": [{"input": tc.get("input", ""),
                                      "expected": tc.get("expected", ""),
                                      "visible": tc.get("visible", False)}
                                     for tc in cfg.get("test_cases", [])]}
        elif q.qtype == "sql":
            review = {"correct_sql": cfg.get("correct_sql", "")}
        elif q.qtype in ("mcq_single", "mcq_multi"):
            review = {"options": cfg.get("options", []), "correct": cfg.get("correct")}
        elif q.qtype == "fill_blank":
            review = {"accepted": [b.get("answers", []) for b in cfg.get("blanks", [])]}

        items.append({
            "title": q.title, "qtype": q.qtype, "marks": m, "score": s,
            "statement": q.statement,
            "payload": ans.payload if ans else None,
            "detail": ans.detail if ans else None,
            "review": review,
        })
    return {"title": a.title, "total": round(total, 2), "max": round(maxm, 2), "items": items}