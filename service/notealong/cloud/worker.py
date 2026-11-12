"""The processing worker of the online version: runs one job from the `jobs` table.

The same code runs on Modal (service/modal_app.py) and on this computer for testing (cloud/dispatch.py).
A job's song is copied into a scratch library folder, the normal pipeline steps run on it, and the results
go back to Supabase: files to the private `uploads` bucket under <user id>/<song id>/, the song to its
`songs` row, the progress to the job's `snapshot`. Nothing crosses between users: the worker reads and
writes only the job's own user's rows and folder, and duplicate detection compares only that user's songs.

Job kinds:
  process  pipeline steps (params.steps); params.new = a fresh upload, which is checked and fingerprinted first
  trim     cut the start/end off (params.start, params.end); nothing is processed again
  lyrics   use pasted lyrics (params.text), aligned to the audio
  render   key-shifted backing/vocals (params.targets [{stem, shift}], params.fine, params.catalog)
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
import traceback
from pathlib import Path

# The scratch library must be in place before the pipeline modules read their configuration.
_SCRATCH = Path(os.environ.setdefault("NOTEALONG_LIBRARY", str(Path(tempfile.gettempdir()) / "notealong-cloud-library")))
os.environ.setdefault("NOTEALONG_CATALOG", str(_SCRATCH / ".no-catalog"))

from .. import library  # noqa: E402
from ..config import LIBRARY_DIR, STEM_FORMAT, processing_steps  # noqa: E402
from ..errors import StepStopped, friendly_error  # noqa: E402
from ..schemas import Song, StepState  # noqa: E402
from .supa import Supa  # noqa: E402

if LIBRARY_DIR.resolve() != _SCRATCH.resolve():
    raise RuntimeError("cloud.worker must be imported before the rest of notealong (scratch library not in use)")

MAX_SECONDS = float(os.environ.get("NOTEALONG_MAX_SECONDS", str(12 * 60)))
BUCKET = "uploads"
CATALOG_BUCKET = "catalog"
STEP_LABELS = {s["id"]: s for s in processing_steps()} | {"cleanup": {"id": "cleanup", "label": "Tidying the notes", "cost": 0.002}}
# seconds of processing per second of audio on the cloud machines, for the "about N min left" estimate
CLOUD_COST = {"stems": 0.12, "melody": 0.03, "lyrics": 0.08, "attach": 0.005, "cleanup": 0.002}
KEEP_LOCAL = {"song.json", "vocals.wav"}          # never uploaded: the row holds the song; the wav is temporary
CONTENT_TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg",
                 ".json": "application/json", ".npz": "application/octet-stream", ".jpg": "image/jpeg", ".png": "image/png",
                 ".svg": "image/svg+xml", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8"}


def _process_age() -> float:
    """Seconds since this process started (Linux), so the first job's billed time includes loading the models."""
    try:
        start_ticks = int(open("/proc/self/stat").read().rsplit(")", 1)[1].split()[19])
        uptime = float(open("/proc/uptime").read().split()[0])
        return max(0.0, uptime - start_ticks / os.sysconf("SC_CLK_TCK"))
    except Exception:  # noqa: BLE001  (not Linux)
        return 0.0


# on Modal (MODAL_TASK_ID is set) the container starts for the job, so its start-up is part of the job's bill;
# anywhere else only the job itself is counted
CONTAINER_STARTED = time.time() - _process_age() if os.environ.get("MODAL_TASK_ID") else None


class Stopped(Exception):
    pass


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _ctype(name: str) -> str:
    return CONTENT_TYPES.get(Path(name).suffix.lower(), "application/octet-stream")


class JobRun:
    """One job, from claiming it to writing the results back."""

    def __init__(self, job_id: str, supa: Supa | None = None, gpu: str | None = None) -> None:
        self.supa = supa or Supa()
        self.job_id = job_id
        self.gpu = gpu
        self.t0 = time.time()
        self.job: dict = {}
        self.uid = ""
        self.song_id = ""
        self.dir: Path = LIBRARY_DIR
        self.fetched: dict[str, tuple[int, float]] = {}
        self.current: str | None = None
        self.progress = 0.0
        self._last_push = 0.0
        self._last_stop_check = 0.0

    # ---- the job row --------------------------------------------------------------------------------
    def claim(self) -> bool:
        rows = self.supa.update("jobs", {"id": f"eq.{self.job_id}", "status": "eq.queued"},
                                {"status": "running", "started_at": _now(), "gpu": self.gpu})
        if not rows:
            return False
        self.job = rows[0]
        self.uid = self.job["user_id"]
        self.song_id = self.job["song_id"]
        return True

    def stopped(self) -> bool:
        row = self.supa.one("jobs", {"id": f"eq.{self.job_id}"}, "status")
        return bool(row and row["status"] == "stopped")

    def check_stop(self, force: bool = False) -> None:
        now = time.time()
        if force or now - self._last_stop_check > 5:
            self._last_stop_check = now
            if self.stopped():
                raise Stopped()

    def finish(self, status: str, *, error: str | None = None, result: dict | None = None) -> None:
        secs = round(time.time() - self.t0, 1)
        # the first job in a fresh container also pays for starting it and loading the models (billed time)
        billed = round(time.time() - (CONTAINER_STARTED if CONTAINER_STARTED and _CONTAINER["fresh"] else self.t0), 1)
        _CONTAINER["fresh"] = False
        values = {"finished_at": _now(), "processing_seconds": secs, "gpu_seconds": billed if self.gpu else 0,
                  "error": error, "result": result}
        if status == "stopped":
            self.supa.update("jobs", {"id": f"eq.{self.job_id}"}, values)
        else:
            self.supa.update("jobs", {"id": f"eq.{self.job_id}", "status": "neq.stopped"}, {"status": status, **values})
        try:
            self.supa.rpc("add_usage", {"p_jobs": 1, "p_failures": int(status == "failed"), "p_gpu": billed if self.gpu else 0,
                                        "p_cpu": 0 if self.gpu else billed, "p_uploads": 0})   # uploads are counted when they start
        except Exception:  # noqa: BLE001  (the totals are a convenience; the job row has the numbers)
            traceback.print_exc()

    # ---- the song row and its files ----------------------------------------------------------------
    def song_row(self) -> dict:
        row = self.supa.one("songs", {"id": f"eq.{self.song_id}", "user_id": f"eq.{self.uid}"})
        if row is None:
            raise Stopped()            # deleted while waiting
        return row

    def materialize(self, row: dict) -> Song:
        """Writes the song into the scratch library and fetches its files."""
        self.dir = LIBRARY_DIR / self.song_id
        shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True)
        song = Song.model_validate({**row["data"], "id": self.song_id})
        library.save_song(song)
        for item in self.supa.list(BUCKET, f"{self.uid}/{self.song_id}"):
            if item.get("id") is None:          # a folder (key renders): not needed for processing
                continue
            name = item["name"]
            path = self.dir / name
            path.write_bytes(self.supa.download(BUCKET, f"{self.uid}/{self.song_id}/{name}"))
            st = path.stat()
            self.fetched[name] = (st.st_size, st.st_mtime)
        return song

    def push_files(self, *, drop_renders: bool = False) -> None:
        """Uploads new and changed files, and removes from storage the files the pipeline deleted."""
        prefix = f"{self.uid}/{self.song_id}"
        here = {p.name for p in self.dir.iterdir() if p.is_file() and p.name not in KEEP_LOCAL and ".tmp" not in p.name}
        for name in sorted(here):
            st = (self.dir / name).stat()
            if self.fetched.get(name) == (st.st_size, st.st_mtime):
                continue
            self.supa.upload(BUCKET, f"{prefix}/{name}", (self.dir / name).read_bytes(), _ctype(name))
            self.fetched[name] = (st.st_size, st.st_mtime)
        gone = [f"{prefix}/{n}" for n in self.fetched if n not in here]
        if drop_renders:
            gone += self.supa.list_all(BUCKET, f"{prefix}/renders")
        if gone:
            self.supa.remove(BUCKET, gone)
        for n in [n for n in self.fetched if n not in here]:
            self.fetched.pop(n)

    def save_row(self, *, status: str | None = None, extra: dict | None = None) -> Song:
        """Writes the scratch song back to its row, keeping player settings the user changed meanwhile."""
        song = library.load_song(self.song_id)
        latest = self.supa.one("songs", {"id": f"eq.{self.song_id}", "user_id": f"eq.{self.uid}"}, "data")
        if latest is None:
            raise Stopped()
        data = song.model_dump()
        if isinstance(latest["data"].get("user"), dict):
            data["user"] = latest["data"]["user"]
        if status:
            data["status"] = status
        values = {"data": data, "title": song.title, "artist": song.artist, "duration": song.duration,
                  "status": data["status"], "updated_at": _now(), "search": search_fields(song), **(extra or {})}
        self.supa.update("songs", {"id": f"eq.{self.song_id}", "user_id": f"eq.{self.uid}"}, values)
        return song

    # ---- progress -----------------------------------------------------------------------------------
    def snapshot(self, status: str = "processing", error: str | None = None, duplicate_of: str | None = None) -> dict:
        song = library.load_song(self.song_id)
        steps, remaining = [], 0.0
        order = ["stems", "melody", "lyrics", "attach"]
        for sid in order:
            st = song.steps.get(sid)
            s = st.status if st else "pending"
            prog = 1.0 if s == "done" else (self.progress if self.current == sid else 0.0)
            if s in ("pending", "running"):
                remaining += CLOUD_COST.get(sid, 0.05) * max(song.duration, 30.0) * (1 - prog)
            steps.append({"id": sid, "label": STEP_LABELS[sid]["label"], "status": s, "progress": round(prog, 3),
                          "error": st.error if st else None})
        snap = {"song_id": self.song_id, "status": status, "error": error, "steps": steps, "current": self.current,
                "estimated_seconds_left": int(remaining) if status == "processing" else 0}
        if duplicate_of:
            snap["duplicate_of"] = duplicate_of
        return snap

    def push_progress(self, force: bool = False, **kw) -> None:
        now = time.time()
        if force or now - self._last_push > 1.5:
            self._last_push = now
            self.supa.update("jobs", {"id": f"eq.{self.job_id}", "status": "eq.running"}, {"snapshot": self.snapshot(**kw)})

    def on_progress(self, p: float) -> None:
        self.progress = max(self.progress, min(float(p), 1.0))
        try:
            self.push_progress()
            self.check_stop()
        except Stopped:
            raise
        except Exception:  # noqa: BLE001  (a missed progress update is not worth failing the song for)
            pass


_CONTAINER = {"fresh": True}


def search_fields(song: Song) -> dict:
    """What search and the filters need about an upload (the local service computes the same in main.py)."""
    from ..catalog.difficulty import rate_difficulty
    notes = [n.model_dump() for n in song.notes]
    midis = [n["midi"] for n in notes]
    return {"range": [min(midis), max(midis)] if midis else None,
            "lyrics": " ".join(w.text for w in song.words)[:4000], "note_count": len(notes),
            "word_count": len(song.words), "difficulty": rate_difficulty(notes)[0] if notes else None,
            "language": song.language.override or song.language.detected, "tempo_bpm": song.tempo_bpm}


# ---- job kinds --------------------------------------------------------------------------------------
def _check_new_upload(run: JobRun, song: Song) -> str | None:
    """A fresh upload: reads the file, keeps only the sound of a video, takes the embedded picture, and looks for
    the same recording among this user's songs. Returns the id of that song when it is a duplicate."""
    from ..pipeline import audio as audio_mod
    from ..pipeline import fingerprint as fp_mod
    original = run.dir / song.files["original"]
    try:
        info = audio_mod.probe_streams(original)
    except Exception as e:  # noqa: BLE001
        low = str(e).lower()
        if "drm" in low or "encrypt" in low:
            raise ValueError("That file is copy-protected and can't be read. Use a song you own as an MP3, M4A, WAV or FLAC.")
        raise ValueError("The audio in that file could not be read. It may be damaged or still downloading; try exporting it again as MP3, M4A or WAV.")
    if not info["has_audio"] or info["duration"] < 1:
        raise ValueError("That video has no sound in it." if info["has_video"] and not info["has_audio"] else
                         "The audio in that file could not be read. It may be damaged or still downloading; try exporting it again as MP3, M4A or WAV.")
    if info["duration"] > MAX_SECONDS:
        raise ValueError(f"That file is longer than {int(MAX_SECONDS // 60)} minutes. Please upload a single song.")
    if info["duration"] < 5:
        raise ValueError("That file is shorter than 5 seconds. Please upload a whole song.")
    print_ = fp_mod.fingerprint(original)
    if print_:
        others = run.supa.select("songs", {"user_id": f"eq.{run.uid}", "status": "eq.ready", "id": f"neq.{run.song_id}"},
                                 "id,duration,fingerprint")
        for o in others:
            if abs(float(o["duration"]) - info["duration"]) < 3.0 and fp_mod.same_recording(print_, o.get("fingerprint")):
                return o["id"]
    cover = audio_mod.extract_picture(original, run.dir / "cover.jpg") if info["has_picture"] else None
    if info["has_video"]:
        audio_mod.extract_audio(original, run.dir / "original.m4a")
        if original.name != "original.m4a":
            original.unlink(missing_ok=True)
        original = run.dir / "original.m4a"

    def upd(s: Song):
        s.duration = round(info["duration"], 3)
        s.files["original"] = original.name
        if cover:
            s.files["cover"] = cover.name
        s.source["format"] = original.suffix.lstrip(".")
        s.source["album"] = info.get("album")
        if s.source.pop("title_from_name", False):
            s.title = info.get("title") or s.title
            s.artist = info.get("artist") or s.artist
    library.update_song(run.song_id, upd)
    run.supa.update("songs", {"id": f"eq.{run.song_id}", "user_id": f"eq.{run.uid}"}, {"fingerprint": print_})
    return None


def _write_cover(run: JobRun) -> None:
    from ..catalog.artwork import render_cover
    render_cover(run.song_id, "Pop").save(run.dir / "cover_gen.webp", "WEBP", quality=80, method=6)


def run_process(run: JobRun) -> None:
    from ..pipeline import runner
    params = run.job.get("params") or {}
    row = run.song_row()
    song = run.materialize(row)
    steps = [s for s in params.get("steps") or runner.STEP_ORDER if s in runner.STEP_FUNCS]
    if params.get("retry"):
        steps = [s for s in runner.STEP_ORDER if song.steps.get(s) is None or song.steps[s].status != "done"] or ["attach"]

    def mark(s: Song):
        s.status = "processing"
        s.error = None
        for st in steps:
            if st in runner.STEP_ORDER:
                s.steps[st] = StepState(status="pending")
    library.update_song(run.song_id, mark)
    run.save_row(status="processing")
    run.push_progress(force=True)
    # a new upload (or one whose first job was stopped before its file was checked) is read and checked first
    if params.get("new") or not song.duration:
        dup = _check_new_upload(run, song)
        if dup:
            # the same recording is already in this user's songs: open that one instead
            run.push_progress(force=True, status="ready", duplicate_of=dup)
            run.finish("done", result={"duplicate_of": dup})
            _delete_song(run.supa, run.uid, run.song_id)
            return
        _write_cover(run)
        run.push_files()
        run.save_row(status="processing")
    step_params = params.get("step_params") or {}
    for step in steps:
        run.check_stop(force=True)
        run.current, run.progress = step, 0.0
        library.update_song(run.song_id, lambda s, step=step: s.steps.__setitem__(step, StepState(status="running")))
        run.push_progress(force=True)
        t = time.time()
        runner.run_step(run.song_id, step, run.on_progress, **(step_params.get(step) or {}))
        secs = round(time.time() - t, 1)
        library.update_song(run.song_id, lambda s, step=step, secs=secs: s.steps.__setitem__(step, StepState(status="done", progress=1.0, seconds=secs)))
        run.push_files(drop_renders=(step == "stems"))
        run.save_row()
    run.current = None
    library.update_song(run.song_id, lambda s: setattr(s, "status", "ready"))
    run.save_row(status="ready")
    run.push_progress(force=True, status="ready")
    run.finish("done")


def run_trim(run: JobRun) -> None:
    params = run.job.get("params") or {}
    row = run.song_row()
    song = run.materialize(row)
    start = max(0.0, float(params.get("start") or 0.0))
    end = min(song.duration, float(params["end"])) if params.get("end") else song.duration
    if end - start < 5.0:
        raise ValueError("Keep at least 5 seconds of the song.")
    library.trim_song(run.song_id, start, end)
    run.push_files(drop_renders=True)
    run.save_row(status="ready")
    run.finish("done")


def run_lyrics(run: JobRun) -> None:
    from ..pipeline.runner import run_paste_lyrics
    text = str((run.job.get("params") or {}).get("text") or "")
    row = run.song_row()
    run.materialize(row)
    run_paste_lyrics(run.song_id, text)
    run.push_files()
    run.save_row(status="ready", extra={"pasted_lyrics": text.strip() or None})
    run.finish("done")


def run_render(run: JobRun) -> None:
    """Key-shifted stems. Fast renders first (what someone is waiting for), then fine ones if asked."""
    from ..pipeline import audio as audio_mod
    params = run.job.get("params") or {}
    catalog = bool(params.get("catalog"))
    bucket = CATALOG_BUCKET if catalog else BUCKET
    base = run.song_id if catalog else f"{run.uid}/{run.song_id}"
    renders = f"renders/{run.song_id}" if catalog else f"{base}/renders"
    work = Path(tempfile.mkdtemp(prefix="render-"))
    try:
        sources: dict[str, Path] = {}
        for t in params.get("targets") or []:
            stem, shift = t["stem"], int(t["shift"])
            if stem not in ("backing", "vocals") or not -6 <= shift <= 6 or shift == 0:
                continue
            fine = bool(t.get("fine", params.get("fine")))
            name = f"shift_{stem}_{shift:+d}.{STEM_FORMAT}"
            if run.supa.exists(bucket, f"{renders}/{name}.fine") or (not fine and run.supa.exists(bucket, f"{renders}/{name}")):
                continue
            run.check_stop()
            if stem not in sources:
                src = work / f"{stem}.{STEM_FORMAT}"
                src.write_bytes(run.supa.download(bucket, f"{base}/{stem}.{STEM_FORMAT}"))
                sources[stem] = src
            out = work / name
            audio_mod.pitch_shift_file(sources[stem], out, shift, fine=fine, formant=(stem == "vocals"))
            run.supa.upload(bucket, f"{renders}/{name}", out.read_bytes(), "audio/mpeg", cache_seconds=86400 if catalog else 3600)
            if fine:
                run.supa.upload(bucket, f"{renders}/{name}.fine", b"", "text/plain")
            out.unlink()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    run.finish("done")


KINDS = {"process": run_process, "trim": run_trim, "lyrics": run_lyrics, "render": run_render}


def _delete_song(supa: Supa, uid: str, song_id: str) -> None:
    paths = supa.list_all(BUCKET, f"{uid}/{song_id}")
    if paths:
        supa.remove(BUCKET, paths)
    supa.delete("songs", {"id": f"eq.{song_id}", "user_id": f"eq.{uid}"})


def _fail(run: JobRun, e: Exception) -> None:
    msg = friendly_error(StepStopped() if isinstance(e, Stopped) else e) if not isinstance(e, ValueError) else str(e)
    if "ran out of memory" in msg:
        msg = "Processing ran out of memory. Try a shorter file, or retry in a minute."
    status = "stopped" if isinstance(e, Stopped) else "failed"
    kind = run.job.get("kind")
    try:
        if kind in ("process", "trim", "lyrics") and (LIBRARY_DIR / run.song_id / "song.json").exists():
            step = run.current

            def fail(s: Song, step=step):
                if kind == "process":
                    s.status = "failed"
                    s.error = msg
                    if step:
                        s.steps[step] = StepState(status="failed", error=msg)
                else:
                    s.status = "ready"
            library.update_song(run.song_id, fail)
            run.save_row()
            if kind == "process":
                run.supa.update("jobs", {"id": f"eq.{run.job_id}"}, {"snapshot": run.snapshot(status="failed", error=msg)})
    except Stopped:
        pass
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    run.finish(status, error=msg)


def run_job(job_id: str, gpu: str | None = None, supa: Supa | None = None) -> dict:
    """Runs one queued job to the end. Safe to call twice: only one call claims the job."""
    run = JobRun(job_id, supa, gpu)
    if not run.claim():
        return {"job": job_id, "status": "not queued"}
    try:
        KINDS[run.job["kind"]](run)
        return {"job": job_id, "status": "done"}
    except Exception as e:  # noqa: BLE001
        if not isinstance(e, (Stopped, ValueError)):
            traceback.print_exc()
        _fail(run, e)
        return {"job": job_id, "status": "failed", "error": str(e)[:300]}
    finally:
        if run.song_id:
            shutil.rmtree(LIBRARY_DIR / run.song_id, ignore_errors=True)
