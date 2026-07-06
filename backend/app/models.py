from datetime import datetime
from sqlalchemy import (Column, Integer, String, Boolean, DateTime, Text,
                        ForeignKey, JSON, Float, UniqueConstraint)
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    role = Column(String(20), default="student")  # admin | student
    full_name = Column(String(120), default="")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True)
    qtype = Column(String(30), nullable=False)
    # python | sql | mcq_single | mcq_multi | fill_blank | descriptive
    title = Column(String(200), nullable=False)
    statement = Column(Text, default="")            # markdown
    config = Column(JSON, default=dict)             # type-specific config
    marks = Column(Float, default=1.0)
    tags = Column(String(300), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Assessment(Base):
    __tablename__ = "assessments"
    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    start_at = Column(DateTime, nullable=True)      # null = no start restriction
    end_at = Column(DateTime, nullable=True)        # null = no end restriction
    duration_minutes = Column(Integer, nullable=True)  # null = untimed
    published = Column(Boolean, default=False)
    show_results = Column(Boolean, default=False)   # students see scores after submit
    assign_all = Column(Boolean, default=True)      # assigned to all students
    created_at = Column(DateTime, default=datetime.utcnow)
    questions = relationship("AssessmentQuestion", cascade="all, delete-orphan",
                             order_by="AssessmentQuestion.position")


class AssessmentQuestion(Base):
    __tablename__ = "assessment_questions"
    id = Column(Integer, primary_key=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    position = Column(Integer, default=0)
    marks_override = Column(Float, nullable=True)
    question = relationship("Question")
    __table_args__ = (UniqueConstraint("assessment_id", "question_id"),)


class AssessmentAssignment(Base):
    __tablename__ = "assessment_assignments"
    id = Column(Integer, primary_key=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    __table_args__ = (UniqueConstraint("assessment_id", "user_id"),)


class Attempt(Base):
    __tablename__ = "attempts"
    id = Column(Integer, primary_key=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="in_progress")  # in_progress | submitted
    user = relationship("User")
    __table_args__ = (UniqueConstraint("assessment_id", "user_id"),)


class Answer(Base):
    __tablename__ = "answers"
    id = Column(Integer, primary_key=True)
    attempt_id = Column(Integer, ForeignKey("attempts.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    payload = Column(JSON, default=dict)   # {"code": ...} / {"query": ...} / {"selected": ...} / {"blanks": [...]} / {"text": ...}
    auto_score = Column(Float, nullable=True)
    manual_score = Column(Float, nullable=True)   # admin override; wins if set
    detail = Column(JSON, default=dict)   # grading detail (per test case results, etc.)
    updated_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("attempt_id", "question_id"),)
