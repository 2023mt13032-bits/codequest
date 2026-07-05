"""Isolated Python code executor.

Runs inside its own container (non-root, internal-only network, no app secrets).
Each submission runs as a subprocess with CPU/memory/output limits and a hard timeout.
A semaphore caps concurrent executions.
"""
import asyncio
import os
import resource
import subprocess
import tempfile

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Executor")

MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "4"))
MEM_LIMIT_MB = int(os.getenv("MEM_LIMIT_MB", "256"))
MAX_OUTPUT = 64 * 1024

sem = asyncio.Semaphore(MAX_CONCURRENT)


class RunIn(BaseModel):
    code: str
    stdin: str = ""
    time_limit: int = 10


def _limits():
    mem = MEM_LIMIT_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))


def _run(code: str, stdin: str, time_limit: int) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "main.py")
        with open(path, "w") as f:
            f.write(code)
        try:
            p = subprocess.run(
                ["python3", "-I", path],  # -I: isolated mode
                input=stdin.encode(),
                capture_output=True,
                timeout=max(1, min(time_limit, 60)),
                preexec_fn=_limits,
                cwd=tmp,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
            )
            return {"stdout": p.stdout.decode(errors="replace")[:MAX_OUTPUT],
                    "stderr": p.stderr.decode(errors="replace")[:MAX_OUTPUT],
                    "exit_code": p.returncode, "timed_out": False}
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": f"Time limit exceeded ({time_limit}s)",
                    "exit_code": -1, "timed_out": True}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": -1, "timed_out": False}


@app.post("/run")
async def run(body: RunIn):
    async with sem:
        return await asyncio.to_thread(_run, body.code, body.stdin, body.time_limit)


@app.get("/health")
def health():
    return {"ok": True}
