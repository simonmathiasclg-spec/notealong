"""Starts processing jobs for the online version. The web app's server routes call it after they add a row to
`jobs`; it answers at once and the job runs in the background (so it carries on when the tab is closed).

Two ways to run it, same endpoints:
  - on Modal (service/modal_app.py): each job is spawned on a GPU or CPU function;
  - on this computer, for testing the online version without Modal:
        cd service && .venv/bin/python -m notealong.cloud.dispatch      (reads ../.env.cloud.local)
    Jobs then run here, heavy ones one at a time and only when there is enough free memory.

    POST /jobs/{id}        start the job, return at once
    POST /jobs/{id}/wait   start it and wait until it is done (a key change someone is waiting for)
    POST /jobs/{id}/cancel stop a running job (the worker also notices the job row turned "stopped")
Every call needs `Authorization: Bearer <WORKER_SECRET>`.
"""
from __future__ import annotations

import hmac
import os
import queue
import subprocess
import sys
import threading
import time
from typing import Callable

from fastapi import FastAPI, Header, HTTPException

Spawn = Callable[[dict], str | None]      # job row -> call id
Wait = Callable[[dict, float], str]       # job row, timeout -> final status
Cancel = Callable[[str], None]            # call id


def _secret_ok(authorization: str | None) -> bool:
    secret = os.environ.get("WORKER_SECRET", "")
    given = (authorization or "").removeprefix("Bearer ").strip()
    return bool(secret) and hmac.compare_digest(given.encode(), secret.encode())


def make_app(spawn: Spawn, wait: Wait, cancel: Cancel | None = None) -> FastAPI:
    from .supa import Supa
    app = FastAPI(title="NoteAlong processing dispatch")
    supa_holder: dict[str, Supa] = {}

    def supa() -> Supa:
        if "s" not in supa_holder:
            supa_holder["s"] = Supa()
        return supa_holder["s"]

    def job_row(job_id: str) -> dict:
        row = supa().one("jobs", {"id": f"eq.{job_id}"}, "id,kind,params,status,user_id,song_id,result")
        if row is None:
            raise HTTPException(404, "No such job")
        return row

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/jobs/{job_id}")
    def start(job_id: str, authorization: str | None = Header(None)):
        if not _secret_ok(authorization):
            raise HTTPException(401, "Not allowed")
        job = job_row(job_id)
        if job["status"] != "queued":
            return {"ok": True, "status": job["status"]}
        call_id = spawn(job)
        if call_id:
            supa().update("jobs", {"id": f"eq.{job_id}"}, {"result": {**(job.get("result") or {}), "call_id": call_id}})
        return {"ok": True, "status": "queued"}

    @app.post("/jobs/{job_id}/wait")
    def start_and_wait(job_id: str, timeout: float = 110.0, authorization: str | None = Header(None)):
        if not _secret_ok(authorization):
            raise HTTPException(401, "Not allowed")
        job = job_row(job_id)
        if job["status"] != "queued":
            return {"ok": True, "status": job["status"]}
        return {"ok": True, "status": wait(job, min(timeout, 140.0))}

    @app.post("/jobs/{job_id}/cancel")
    def stop(job_id: str, authorization: str | None = Header(None)):
        if not _secret_ok(authorization):
            raise HTTPException(401, "Not allowed")
        job = job_row(job_id)
        call_id = (job.get("result") or {}).get("call_id")
        if cancel and call_id:
            try:
                cancel(call_id)
            except Exception:  # noqa: BLE001  (already finished)
                pass
        return {"ok": True}

    return app


# ---- running the jobs on this computer ------------------------------------------------------------
def _free_mb() -> float:
    """Free + inactive memory in MB (macOS); a large number elsewhere."""
    if sys.platform != "darwin":
        return 1e9
    out = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    page = 16384 if "16384" in out.splitlines()[0] else 4096
    total = 0
    for line in out.splitlines():
        if line.startswith(("Pages free", "Pages inactive", "Pages speculative")):
            total += int(line.split(":")[1].strip().rstrip("."))
    return total * page / 1048576


HEAVY = r"^[^ ]*python[^ ]* .*(notealong.catalog.(build|evaluate|recheck|import_cc)|import_ia_jamendo|bench_separation|check_pitch_shift|render_one|accuracy/(prepare_covers|process_test_song|render_hear|evaluate|answer_key))"


def _other_heavy_job() -> bool:
    """Another heavy NoteAlong job on this computer (the same rule as scripts/heavy.sh)."""
    out = subprocess.run(["pgrep", "-fl", HEAVY], capture_output=True, text=True).stdout
    return any(line and "--check" not in line and "--index" not in line for line in out.splitlines())


def local_app() -> FastAPI:
    """Runs jobs in this process: processing one at a time (it is heavy), renders and edits on a second queue."""
    from . import worker
    from .jobkinds import needs_gpu
    heavy: queue.Queue[tuple[dict, threading.Event]] = queue.Queue()
    light: queue.Queue[tuple[dict, threading.Event]] = queue.Queue()
    min_mb = float(os.environ.get("NOTEALONG_HEAVY_MIN_MB", "3500"))

    def loop(q: queue.Queue, is_heavy: bool) -> None:
        while True:
            job, done = q.get()
            try:
                # one heavy job at a time on this computer, and only with enough free memory
                while is_heavy and (_free_mb() < min_mb or _other_heavy_job()):
                    print(f"waiting before job {job['id']}: {_free_mb():.0f} MB free, other heavy job: {_other_heavy_job()}", flush=True)
                    time.sleep(20)
                print(f"job {job['id']} {job['kind']} starting", flush=True)
                res = worker.run_job(job["id"], gpu=("local" if needs_gpu(job) else None))
                print(f"job {job['id']} {res.get('status')}", flush=True)
            finally:
                done.set()
                q.task_done()

    threading.Thread(target=loop, args=(heavy, True), daemon=True).start()
    threading.Thread(target=loop, args=(light, False), daemon=True).start()

    def enqueue(job: dict) -> threading.Event:
        ev = threading.Event()
        (heavy if needs_gpu(job) or job["kind"] == "process" else light).put((job, ev))
        return ev

    def spawn(job: dict) -> str | None:
        enqueue(job)
        return None

    # jobs queued before this process started (Modal keeps its own queue; this stand-in picks them up again)
    try:
        from .supa import Supa
        since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
        for job in Supa().select("jobs", {"status": "eq.queued", "created_at": f"gte.{since}", "order": "created_at"},
                                 "id,kind,params,status,user_id,song_id,result"):
            print(f"picking up queued job {job['id']}", flush=True)
            enqueue(job)
    except Exception as e:  # noqa: BLE001
        print(f"could not look for queued jobs: {e}", flush=True)

    def wait(job: dict, timeout: float) -> str:
        ev = enqueue(job)
        ev.wait(timeout)
        from .supa import Supa
        row = Supa().one("jobs", {"id": f"eq.{job['id']}"}, "status")
        return row["status"] if row else "failed"

    return make_app(spawn, wait)


def _load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


if __name__ == "__main__":
    import uvicorn
    _load_env(os.environ.get("NOTEALONG_CLOUD_ENV", os.path.join(os.path.dirname(__file__), "../../../.env.cloud.local")))
    uvicorn.run(local_app(), host="127.0.0.1", port=int(os.environ.get("DISPATCH_PORT", "8001")))
