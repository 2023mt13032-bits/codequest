from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    full_name: str
    active: bool
    class Config: from_attributes = True


class StudentIn(BaseModel):
    username: str
    password: str
    full_name: str = ""


class PasswordIn(BaseModel):
    password: str


class QuestionIn(BaseModel):
    qtype: str
    title: str
    statement: str = ""
    config: dict = {}
    marks: float = 1.0
    tags: str = ""


class QuestionOut(QuestionIn):
    id: int
    class Config: from_attributes = True


class AQIn(BaseModel):
    question_id: int
    marks_override: Optional[float] = None


class AssessmentIn(BaseModel):
    title: str
    description: str = ""
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    published: bool = False
    show_results: bool = False
    assign_all: bool = True
    question_ids: List[AQIn] = []
    assigned_user_ids: List[int] = []


class AnswerIn(BaseModel):
    question_id: int
    payload: dict


class RunIn(BaseModel):
    question_id: int
    code: Optional[str] = None
    query: Optional[str] = None


class ScoreOverrideIn(BaseModel):
    manual_score: Optional[float] = None


class AttemptActionIn(BaseModel):
    action: str  # force_submit | reopen | reset
