"""A tiny job queue. One worker runs pipeline steps one after another (they are
CPU/GPU heavy). Each step runs in its own child process, so a crash or a hang
in a model cannot take the service down or leave a song stuck: a step that
produces no progress for too long is killed and reported, and "stop" is
possible. Progress is kept in memory for SSE and mirrored into song.json so
the library page shows status after a reload."""
from __future__ import annotations

import json
import multiprocessing as mp
import queue
import threading
import time
import traceback
from dataclasses import dataclass, field

from . import library
from .config import LIBRARY_DIR, processing_steps
from .pipeline import runner
from .errors import StepStopped, StepTimeout, friendly_error  # noqa: F401  (re-exported)
from .schemas import Song, StepState

STEP_META = {s["id"]: s for s in processing_steps()}
STEP_META["cleanup"] = {"id": "cleanup", "label": "Tidying the notes", "cost": 0.002}
TIMINGS_FILE = LIBRARY_DIR / ".timings.json"


def _load_timings() -> dict[str, float]:
    try:
        return json.loads(TIMINGS_FILE.read_text())
    except Exception:
        return {}


def _save_timing(step: str, ratio: float) -> None:
    t = _load_timings()
    t[step] = ratio if step not in t else 0.6 * t[step] + 0.4 * ratio
    TIMINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TIMINGS_FILE.write_text(json.dumps(t))


def cost_ratio(step: str) -> float:
    return _load_timings().get(step, STEP_META.get(step, {}).get("cost", 0.1))


@dataclass
class Job:
    song_id: str
    steps: list[str]
    params: dict = field(default_factory=dict)
    current: str | None = None
    progress: float = 0.0
    done: bool = False
    error: str | None = None
    started: float = 0.0
    step_started: float = 0.0
    last_progress_at: float = 0.0
    cancel: bool = False
    process: object = None


class JobManager:
    def __init__(self) -> None:
        self.q: queue.Queue[Job] = queue.Queue()
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def submit(self, song_id: str, steps: list[str], params: dict | None = None) -> Job:
        job = Job(song_id=song_id, steps=steps, params=params or {})
        with self.lock:
            self.jobs[song_id] = job

        def mark(s: Song):
            s.status = "processing"
            s.error = None
            for st in steps:
                s.steps[st] = StepState(status="pending")
            # later steps depend on earlier ones; mark them pending too
            idx = [runner.STEP_ORDER.index(x) for x in steps if x in runner.STEP_ORDER]
            if idx:
                for later in runner.STEP_ORDER[min(idx):]:
                    if later not in steps and (later not in s.steps or s.steps[later].status != "done"):
                        s.steps[later] = StepState(status="pending")
        library.update_song(song_id, mark)
        self.q.put(job)
        return job

    def get(self, song_id: str) -> Job | None:
        return self.jobs.get(song_id)

    def stop(self, song_id: str) -> bool:
        """Stops the running (or queued) job of a song."""
        job = self.jobs.get(song_id)
        if not job or job.done:
            return False
        job.cancel = True
        proc = job.process
        if proc is not None and proc.is_alive():
            proc.terminate()
        return True

    def _run_step(self, job: Job, step: str, params: dict) -> float:
        """Runs one step in a child process. Returns the seconds it took; raises on failure."""
        song = library.load_song(job.song_id)
        # no progress for this long means the step is stuck (slow machines included)
        patience = max(300.0, 10.0 * cost_ratio(step) * max(song.duration, 30.0) + 120.0)
        ctx = mp.get_context("spawn")
        parent, child = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=runner.run_step_in_child, args=(job.song_id, step, params, child), daemon=True)
        proc.start()
        child.close()
        job.process = proc
        job.last_progress_at = time.time()
        result: dict | None = None
        try:
            while True:
                if parent.poll(0.5):
                    try:
                        msg = parent.recv()
                    except EOFError:
                        break
                    if msg[0] == "progress":
                        job.progress = max(job.progress, min(float(msg[1]), 1.0))
                        job.last_progress_at = time.time()
                    elif msg[0] in ("done", "error"):
                        result = {"kind": msg[0], "value": msg[1]}
                        break
                if job.cancel:
                    raise StepStopped()
                if not proc.is_alive() and not parent.poll(0.5):
                    break
                if time.time() - job.last_progress_at > patience:
                    proc.terminate()
                    raise StepTimeout(step)
        finally:
            proc.join(10)
            if proc.is_alive():
                proc.kill()
            job.process = None
            parent.close()
        if result is None:
            if job.cancel:
                raise StepStopped()
            raise RuntimeError(f"The processing step stopped unexpectedly (exit code {proc.exitcode}).")
        if result["kind"] == "error":
            raise RuntimeError(result["value"])
        return float(result["value"])

    def _worker(self) -> None:
        while True:
            job = self.q.get()
            job.started = time.time()
            try:
                if job.cancel:
                    raise StepStopped()
                for step in job.steps:
                    job.current = step
                    job.progress = 0.0
                    job.step_started = time.time()
                    library.update_song(job.song_id, lambda s: s.steps.__setitem__(step, StepState(status="running")))
                    params = {k: v for k, v in job.params.get(step, {}).items()}
                    secs = self._run_step(job, step, params)
                    song = library.load_song(job.song_id)
                    if song.duration > 0 and step in STEP_META:
                        _save_timing(step, secs / song.duration)

                    def done(s: Song, step=step, secs=secs):
                        s.steps[step] = StepState(status="done", progress=1.0, seconds=round(secs, 1))
                    library.update_song(job.song_id, done)
                    job.progress = 1.0
                job.done = True
                library.update_song(job.song_id, lambda s: setattr(s, "status", "ready"))
            except Exception as e:  # noqa: BLE001
                if not isinstance(e, (StepStopped, StepTimeout)):
                    traceback.print_exc()
                msg = friendly_error(e)
                job.error = msg
                job.done = True

                def fail(s: Song, step=job.current, msg=msg):
                    s.status = "failed"
                    s.error = msg
                    if step:
                        s.steps[step] = StepState(status="failed", error=msg)
                library.update_song(job.song_id, fail)
            finally:
                self.q.task_done()

    def snapshot(self, song_id: str) -> dict:
        """Progress payload for the frontend."""
        song = library.load_song(song_id)
        job = self.jobs.get(song_id)
        steps = []
        remaining = 0.0
        for sid in runner.STEP_ORDER:
            st = song.steps.get(sid)
            meta = STEP_META[sid]
            status = st.status if st else "pending"
            prog = 1.0 if status == "done" else (job.progress if (job and job.current == sid and not job.done) else 0.0)
            if status in ("pending", "running"):
                remaining += cost_ratio(sid) * song.duration * (1 - prog)
            steps.append({"id": sid, "label": meta["label"], "status": status, "progress": round(prog, 3),
                          "error": st.error if st else None})
        return {"song_id": song_id, "status": song.status, "error": song.error, "steps": steps,
                "current": job.current if job and not job.done else None,
                "estimated_seconds_left": int(remaining) if song.status == "processing" else 0}


def recover_interrupted() -> None:
    """On startup, songs left in 'processing' were interrupted by a restart."""
    for song in library.list_songs():
        if song.status == "processing":
            def fix(s: Song):
                s.status = "failed"
                s.error = "Processing was interrupted (the service restarted). Press retry to continue."
                for k, st in s.steps.items():
                    if st.status == "running":
                        st.status = "failed"
                        st.error = s.error
            library.update_song(song.id, fix)


manager = JobManager()


class Upgrader:
    """Brings uploads made with an older note pipeline up to date, one at a time in a child process, only
    while no upload is being processed. The song keeps its old notes until the new ones are saved."""

    def __init__(self) -> None:
        self.thread: threading.Thread | None = None
        self.done: list[str] = []
        self.failed: dict[str, str] = {}

    def pending(self) -> list[str]:
        return [s.id for s in library.list_songs()
                if s.status == "ready" and int(s.quality.get("pipeline", 1)) < runner.PIPELINE_VERSION and s.id not in self.failed]

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._run, name="upgrader", daemon=True)
        self.thread.start()

    def _busy(self) -> bool:
        with manager.lock:
            return any(not j.done for j in manager.jobs.values()) or not manager.q.empty()

    def _run(self) -> None:
        time.sleep(5)                 # let the service finish starting
        for song_id in self.pending():
            while self._busy():
                time.sleep(5)
            try:
                job = Job(song_id=song_id, steps=["upgrade"], params={})
                manager._run_step(job, "upgrade", {})
                self.done.append(song_id)
            except Exception as e:  # noqa: BLE001  (an upgrade that fails leaves the old result in place)
                self.failed[song_id] = str(e)[:300]


upgrader = Upgrader()
