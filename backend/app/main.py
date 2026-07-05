import os
import time

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from .database import Base, engine, get_db
from . import models, schemas
from .auth import verify_password, create_token, get_current_user
from .routers import admin, student

app = FastAPI(title="AssessHub")

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
    from .seed import ensure_seed
    ensure_seed()


@app.post("/api/login")
def login(body: schemas.LoginIn, db: Session = Depends(get_db)):
    u = db.query(models.User).filter_by(username=body.username).first()
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Invalid username or password")
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
