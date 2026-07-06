import os
import time
from collections import defaultdict

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from .database import Base, engine, get_db
from . import models, schemas
from .auth import verify_password, create_token, get_current_user
from .routers import admin, student

app = FastAPI(title="AssessHub")

# ---------- Simple rate limiter for login ----------
_login_attempts: dict[str, list[float]] = defaultdict(list)
LOGIN_WINDOW = 60        # seconds
LOGIN_MAX_ATTEMPTS = 5   # per window

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    for _ in range(30):  # wait for postgres
        try:
            Base.metadata.create_all(bind=engine)
            break
        except OperationalError:
            time.sleep(2)
    try:
        from .seed import ensure_seed
        ensure_seed()
    except Exception as e:
        # Seeding is a convenience — a failure here must never take the app down.
        print(f"[seed] skipped due to error: {e}")


@app.post("/api/login")
def login(body: schemas.LoginIn, request: Request, db: Session = Depends(get_db)):
    # Rate limit by username
    now = time.time()
    attempts = _login_attempts[body.username]
    _login_attempts[body.username] = [t for t in attempts if now - t < LOGIN_WINDOW]
    if len(_login_attempts[body.username]) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many login attempts. Try again in a minute.")
    u = db.query(models.User).filter_by(username=body.username).first()
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        _login_attempts[body.username].append(now)
        raise HTTPException(401, "Invalid username or password")
    _login_attempts[body.username].clear()  # reset on success
    return {"token": create_token(u), "role": u.role, "username": u.username,
            "full_name": u.full_name}


@app.get("/api/me")
def me(user=Depends(get_current_user)):
    return {"username": user.username, "role": user.role, "full_name": user.full_name}


@app.get("/api/health")
def health():
    return {"ok": True}


app.include_router(admin.router)
app.include_router(student.router)