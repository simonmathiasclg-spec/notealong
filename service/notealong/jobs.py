"""A tiny in-process job queue. One worker runs pipeline steps sequentially
(they are CPU/GPU heavy); progress is kept in memory for SSE and mirrored into
song.json so the library page shows status after a reload."""
from __future__ import annotations

import json
import queue
import threading
import time
import traceback
from dataclasses import dataclass, field

from . import library
from .config import LIBRARY_DIR, processing_steps
from .pipeline import runner
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

    def _worker(self) -> None:
        while True:
            job = self.q.get()
            job.started = time.time()
            try:
                for step in job.steps:
                    job.current = step
                    job.progress = 0.0
                    job.step_started = time.time()
                    library.update_song(job.song_id, lambda s: s.steps.__setitem__(step, StepState(status="running")))

                    def prog(p: float, step=step) -> None:
                        job.progress = max(job.progress, min(p, 1.0))

                    params = {k: v for k, v in job.params.get(step, {}).items()}
                    secs = runner.run_step(job.song_id, step, prog, **params)
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


def friendly_error(e: Exception) -> str:
    text = str(e)
    low = text.lower()
    if "out of memory" in low or "oom" in low:
        return "The computer ran out of memory while processing. Close other apps and try again."
    if "ffmpeg" in low or "ffprobe" in low:
        return "The audio could not be read. Make sure ffmpeg is installed and the file is a valid MP3, WAV or M4A."
    if "download" in low or "urlopen" in low or "connection" in low or "http" in low:
        return "A model file could not be downloaded. Check your internet connection and retry."
    if "no module named" in low:
        return f"A Python package is missing ({text}). Re-run the setup steps in the README."
    return f"Something went wrong: {text[:300]}"


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
