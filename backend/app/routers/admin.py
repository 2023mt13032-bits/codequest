import csv
import io
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from .. import models, schemas
from ..auth import require_admin, hash_password
from ..grading import effective_marks, grade_sql

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


# ---------- students ----------

@router.get("/students")
def list_students(db: Session = Depends(get_db)):
    return [schemas.UserOut.model_validate(u) for u in
            db.query(models.User).filter(models.User.role == "student").order_by(models.User.username)]


@router.post("/students")
def create_student(body: schemas.StudentIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter_by(username=body.username).first():
        raise HTTPException(400, "Username already exists")
    u = models.User(username=body.username, password_hash=hash_password(body.password),
                    role="student", full_name=body.full_name)
    db.add(u); db.commit(); db.refresh(u)
    return schemas.UserOut.model_validate(u)


@router.post("/students/{uid}/password")
def reset_password(uid: int, body: schemas.PasswordIn, db: Session = Depends(get_db)):
    u = db.get(models.User, uid) or _404()
    u.password_hash = hash_password(body.password); db.commit()
    return {"ok": True}


@router.post("/students/{uid}/toggle")
def toggle_student(uid: int, db: Session = Depends(get_db)):
    u = db.get(models.User, uid) or _404()
    u.active = not u.active; db.commit()
    return {"ok": True, "active": u.active}


def _404():
    raise HTTPException(404, "Not found")


# ---------- questions ----------

VALID_TYPES = {"python", "sql", "mcq_single", "mcq_multi", "fill_blank", "descriptive"}


@router.get("/questions")
def list_questions(db: Session = Depends(get_db)):
    return [schemas.QuestionOut.model_validate(q) for q in
            db.query(models.Question).order_by(models.Question.id.desc())]


@router.post("/questions")
def create_question(body: schemas.QuestionIn, db: Session = Depends(get_db)):
    if body.qtype not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type. Use one of {sorted(VALID_TYPES)}")
    q = models.Question(**body.model_dump())
    db.add(q); db.commit(); db.refresh(q)
    return schemas.QuestionOut.model_validate(q)


@router.put("/questions/{qid}")
def update_question(qid: int, body: schemas.QuestionIn, db: Session = Depends(get_db)):
    q = db.get(models.Question, qid) or _404()
    for k, v in body.model_dump().items():
        setattr(q, k, v)
    db.commit()
    return schemas.QuestionOut.model_validate(q)


@router.delete("/questions/{qid}")
def delete_question(qid: int, db: Session = Depends(get_db)):
    if db.query(models.AssessmentQuestion).filter_by(question_id=qid).first():
        raise HTTPException(400, "Question is used in an assessment. Remove it there first.")
    q = db.get(models.Question, qid) or _404()
    db.delete(q); db.commit()
    return {"ok": True}


@router.post("/questions/{qid}/duplicate")
def duplicate_question(qid: int, db: Session = Depends(get_db)):
    q = db.get(models.Question, qid) or _404()
    c = models.Question(qtype=q.qtype, title=q.title + " (copy)", statement=q.statement,
                        config=q.config, marks=q.marks, tags=q.tags)
    db.add(c); db.commit(); db.refresh(c)
    return schemas.QuestionOut.model_validate(c)


@router.post("/questions/sql-preview")
def sql_preview(body: dict, db: Session = Depends(get_db)):
    """Run seed + correct query so admin can verify expected output before publishing."""
    cfg = {"correct_sql": body.get("correct_sql", ""),
           "order_sensitive": True,
           "datasets": [{"seed_sql": body.get("seed_sql", ""), "marks": 1, "visible": True}]}
    res = grade_sql(cfg, body.get("correct_sql", ""))
    case = res["cases"][0] if res["cases"] else {}
    return {"columns": case.get("columns"), "rows": case.get("rows"), "error": case.get("error")}


# ---------- assessments ----------

def _assessment_out(a: models.Assessment, db: Session):
    assigned = [x.user_id for x in db.query(models.AssessmentAssignment).filter_by(assessment_id=a.id)]
    return {
        "id": a.id, "title": a.title, "description": a.description,
        "start_at": a.start_at, "end_at": a.end_at, "duration_minutes": a.duration_minutes,
        "published": a.published, "show_results": a.show_results, "assign_all": a.assign_all,
        "assigned_user_ids": assigned,
        "questions": [{
            "question_id": aq.question_id, "position": aq.position,
            "marks_override": aq.marks_override, "title": aq.question.title,
            "qtype": aq.question.qtype, "marks": effective_marks(aq),
        } for aq in a.questions],
    }


@router.get("/assessments")
def list_assessments(db: Session = Depends(get_db)):
    out = []
    for a in db.query(models.Assessment).order_by(models.Assessment.id.desc()):
        d = _assessment_out(a, db)
        d["attempt_count"] = db.query(models.Attempt).filter_by(assessment_id=a.id).count()
        out.append(d)
    return out


def _apply_assessment(a: models.Assessment, body: schemas.AssessmentIn, db: Session):
    a.title, a.description = body.title, body.description
    a.start_at, a.end_at = body.start_at, body.end_at
    a.duration_minutes = body.duration_minutes
    a.published, a.show_results, a.assign_all = body.published, body.show_results, body.assign_all
    db.query(models.AssessmentQuestion).filter_by(assessment_id=a.id).delete()
    for i, aq in enumerate(body.question_ids):
        db.add(models.AssessmentQuestion(assessment_id=a.id, question_id=aq.question_id,
                                         position=i, marks_override=aq.marks_override))
    db.query(models.AssessmentAssignment).filter_by(assessment_id=a.id).delete()
    if not body.assign_all:
        for uid in body.assigned_user_ids:
            db.add(models.AssessmentAssignment(assessment_id=a.id, user_id=uid))
    db.commit()


@router.post("/assessments")
def create_assessment(body: schemas.AssessmentIn, db: Session = Depends(get_db)):
    a = models.Assessment(title=body.title)
    db.add(a); db.commit()
    _apply_assessment(a, body, db)
    db.refresh(a)
    return _assessment_out(a, db)


@router.put("/assessments/{aid}")
def update_assessment(aid: int, body: schemas.AssessmentIn, db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid) or _404()
    _apply_assessment(a, body, db)
    db.refresh(a)
    return _assessment_out(a, db)


@router.delete("/assessments/{aid}")
def delete_assessment(aid: int, db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid) or _404()
    for att in db.query(models.Attempt).filter_by(assessment_id=aid):
        db.query(models.Answer).filter_by(attempt_id=att.id).delete()
        db.delete(att)
    db.query(models.AssessmentAssignment).filter_by(assessment_id=aid).delete()
    db.delete(a); db.commit()
    return {"ok": True}


# ---------- results / monitoring ----------

def _attempt_summary(att: models.Attempt, a: models.Assessment, db: Session):
    answers = {ans.question_id: ans for ans in db.query(models.Answer).filter_by(attempt_id=att.id)}
    total, maxm, pending = 0.0, 0.0, False
    for aq in a.questions:
        m = effective_marks(aq)
        maxm += m
        ans = answers.get(aq.question_id)
        if ans:
            s = ans.manual_score if ans.manual_score is not None else ans.auto_score
            if s is None and aq.question.qtype == "descriptive":
                pending = True
            total += s or 0
    return {"attempt_id": att.id, "user_id": att.user_id, "username": att.user.username,
            "full_name": att.user.full_name, "status": att.status,
            "started_at": att.started_at, "submitted_at": att.submitted_at,
            "score": round(total, 2), "max": round(maxm, 2), "pending_manual": pending}


@router.get("/assessments/{aid}/results")
def assessment_results(aid: int, db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid) or _404()
    return [_attempt_summary(att, a, db)
            for att in db.query(models.Attempt).filter_by(assessment_id=aid)]


@router.get("/attempts/{attempt_id}")
def attempt_detail(attempt_id: int, db: Session = Depends(get_db)):
    att = db.get(models.Attempt, attempt_id) or _404()
    a = db.get(models.Assessment, att.assessment_id)
    answers = {ans.question_id: ans for ans in db.query(models.Answer).filter_by(attempt_id=att.id)}
    items = []
    for aq in a.questions:
        q, ans = aq.question, answers.get(aq.question_id)
        items.append({
            "question_id": q.id, "title": q.title, "qtype": q.qtype,
            "statement": q.statement, "config": q.config, "marks": effective_marks(aq),
            "answer_id": ans.id if ans else None,
            "payload": ans.payload if ans else None,
            "auto_score": ans.auto_score if ans else None,
            "manual_score": ans.manual_score if ans else None,
            "detail": ans.detail if ans else None,
            "updated_at": ans.updated_at if ans else None,
        })
    return {"summary": _attempt_summary(att, a, db), "assessment_title": a.title, "items": items}


@router.post("/answers/{answer_id}/override")
def override_score(answer_id: int, body: schemas.ScoreOverrideIn, db: Session = Depends(get_db)):
    ans = db.get(models.Answer, answer_id) or _404()
    ans.manual_score = body.manual_score
    db.commit()
    return {"ok": True}


@router.post("/attempts/{attempt_id}/action")
def attempt_action(attempt_id: int, body: schemas.AttemptActionIn, db: Session = Depends(get_db)):
    att = db.get(models.Attempt, attempt_id) or _404()
    if body.action == "force_submit":
        att.status, att.submitted_at = "submitted", datetime.utcnow()
    elif body.action == "reopen":
        att.status, att.submitted_at = "in_progress", None
    elif body.action == "reset":
        db.query(models.Answer).filter_by(attempt_id=att.id).delete()
        db.delete(att)
    else:
        raise HTTPException(400, "Unknown action")
    db.commit()
    return {"ok": True}


@router.get("/assessments/{aid}/export")
def export_csv(aid: int, db: Session = Depends(get_db)):
    a = db.get(models.Assessment, aid) or _404()
    buf = io.StringIO()
    w = csv.writer(buf)
    qcols = [f"Q{aq.position + 1}: {aq.question.title}" for aq in a.questions]
    w.writerow(["username", "full_name", "status", "started_at", "submitted_at", *qcols, "total", "max"])
    for att in db.query(models.Attempt).filter_by(assessment_id=aid):
        answers = {ans.question_id: ans for ans in db.query(models.Answer).filter_by(attempt_id=att.id)}
        row, total, maxm = [], 0.0, 0.0
        for aq in a.questions:
            maxm += effective_marks(aq)
            ans = answers.get(aq.question_id)
            s = None
            if ans:
                s = ans.manual_score if ans.manual_score is not None else ans.auto_score
            row.append("" if s is None else s)
            total += s or 0
        w.writerow([att.user.username, att.user.full_name, att.status,
                    att.started_at, att.submitted_at, *row, round(total, 2), round(maxm, 2)])
    buf.seek(0)
    return StreamingResponse(iter([buf.read()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename=assessment_{aid}_results.csv"})


# ---------- analytics ----------

@router.get("/analytics")
def analytics(db: Session = Depends(get_db)):
    """Full analytics: per-assessment scores, per-question difficulty, student activity, comparisons."""

    assessments = db.query(models.Assessment).order_by(models.Assessment.id).all()
    all_attempts = db.query(models.Attempt).all()
    all_answers = db.query(models.Answer).all()
    students = db.query(models.User).filter(models.User.role == "student").all()

    # Index answers by attempt_id
    answers_by_attempt = defaultdict(list)
    for ans in all_answers:
        answers_by_attempt[ans.attempt_id].append(ans)

    # Index attempts by assessment_id
    attempts_by_assessment = defaultdict(list)
    for att in all_attempts:
        attempts_by_assessment[att.assessment_id].append(att)

    assessment_analytics = []

    for a in assessments:
        atts = attempts_by_assessment.get(a.id, [])
        submitted = [att for att in atts if att.status == "submitted"]

        # Compute max marks
        max_marks = sum(effective_marks(aq) for aq in a.questions)
        if max_marks == 0:
            max_marks = 1  # avoid div by zero

        # Compute per-student scores
        scores = []
        student_results = []
        for att in submitted:
            ans_map = {ans.question_id: ans for ans in answers_by_attempt.get(att.id, [])}
            total = 0.0
            for aq in a.questions:
                ans = ans_map.get(aq.question_id)
                if ans:
                    s = ans.manual_score if ans.manual_score is not None else ans.auto_score
                    total += s or 0
            pct = round(total / max_marks * 100, 1) if max_marks else 0
            scores.append(pct)
            student_results.append({
                "user_id": att.user_id,
                "username": att.user.username,
                "full_name": att.user.full_name,
                "score": round(total, 2),
                "max": round(max_marks, 2),
                "pct": pct,
                "started_at": att.started_at.isoformat() if att.started_at else None,
                "submitted_at": att.submitted_at.isoformat() if att.submitted_at else None,
                "duration_sec": int((att.submitted_at - att.started_at).total_seconds())
                    if att.submitted_at and att.started_at else None,
            })

        # Score distribution buckets (0-10, 10-20, ..., 90-100)
        buckets = [0] * 10
        for pct in scores:
            idx = min(int(pct // 10), 9)
            buckets[idx] += 1

        avg_score = round(sum(scores) / len(scores), 1) if scores else 0
        median_score = round(sorted(scores)[len(scores) // 2], 1) if scores else 0
        pass_rate = round(sum(1 for s in scores if s >= 50) / len(scores) * 100, 1) if scores else 0

        # Per-question difficulty
        question_stats = []
        for aq in a.questions:
            q = aq.question
            m = effective_marks(aq)
            q_scores = []
            for att in submitted:
                ans_map = {ans.question_id: ans for ans in answers_by_attempt.get(att.id, [])}
                ans = ans_map.get(aq.question_id)
                if ans:
                    s = ans.manual_score if ans.manual_score is not None else ans.auto_score
                    q_scores.append(s or 0)
                else:
                    q_scores.append(0)
            avg_q = round(sum(q_scores) / len(q_scores), 2) if q_scores else 0
            pct_correct = round(sum(1 for s in q_scores if s >= m) / len(q_scores) * 100, 1) if q_scores else 0
            question_stats.append({
                "question_id": q.id,
                "title": q.title,
                "qtype": q.qtype,
                "marks": m,
                "avg_score": avg_q,
                "pct_full_marks": pct_correct,
                "difficulty": "easy" if pct_correct >= 70 else "medium" if pct_correct >= 40 else "hard",
            })

        assessment_analytics.append({
            "id": a.id,
            "title": a.title,
            "published": a.published,
            "total_attempts": len(atts),
            "submitted_count": len(submitted),
            "max_marks": round(max_marks, 2),
            "avg_score": avg_score,
            "median_score": median_score,
            "pass_rate": pass_rate,
            "score_distribution": buckets,
            "question_stats": question_stats,
            "student_results": student_results,
        })

    # Student activity timeline (last 30 days of attempt starts/submits)
    activity = []
    for att in all_attempts:
        if att.started_at:
            activity.append({
                "type": "start",
                "user_id": att.user_id,
                "username": att.user.username,
                "assessment_id": att.assessment_id,
                "ts": att.started_at.isoformat(),
            })
        if att.submitted_at:
            activity.append({
                "type": "submit",
                "user_id": att.user_id,
                "username": att.user.username,
                "assessment_id": att.assessment_id,
                "ts": att.submitted_at.isoformat(),
            })
    activity.sort(key=lambda x: x["ts"], reverse=True)

    return {
        "assessments": assessment_analytics,
        "activity": activity[:100],
        "summary": {
            "total_students": len(students),
            "total_assessments": len(assessments),
            "total_attempts": len(all_attempts),
            "total_submitted": sum(1 for a in all_attempts if a.status == "submitted"),
        },
    }
