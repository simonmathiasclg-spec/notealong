"""NoteAlong processing service (FastAPI)."""
from __future__ import annotations

import asyncio
import json
import re
import shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import entitlements, library
from .catalog import store as catalog_store
from .config import CATALOG_DIR, DETAIL_LEVELS, LIBRARY_DIR, STEM_FORMAT, processing_steps
from .jobs import manager, recover_interrupted
from .pipeline import audio as audio_mod
from .pipeline.runner import STEP_ORDER, run_paste_lyrics
from .schemas import Line, Note, Song, UserSession, Word

app = FastAPI(title="NoteAlong service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4"}


@app.on_event("startup")
def _startup() -> None:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    recover_interrupted()


@app.get("/api/health")
def health():
    return {"ok": True, "library": str(LIBRARY_DIR), "catalog": str(CATALOG_DIR), "catalog_songs": len(catalog_store.load_index()["songs"]),
            "steps": processing_steps(), "detail_levels": list(DETAIL_LEVELS)}


@app.get("/api/me")
def me():
    """The current plan and limits (no accounts yet; see entitlements.py)."""
    return entitlements.current()


@app.get("/api/catalog")
def get_catalog():
    """Built-in songs: the index with one entry per song (see catalog/catalog.json)."""
    data = catalog_store.load_index()
    for s in data["songs"]:
        s["cover_url"] = f"/api/catalog/{s['id']}/cover"
    return data


@app.get("/api/catalog/{song_id}/cover")
def get_cover(song_id: str):
    try:
        p = library.song_dir(song_id) / "cover.svg"
    except ValueError:
        raise HTTPException(404, "Song not found")
    if not library.is_catalog(song_id) or not p.exists():
        raise HTTPException(404, "No cover")
    return FileResponse(p, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


def _summary(s: Song) -> dict:
    d = s.model_dump()
    for k in ("words", "notes", "lines"):
        d.pop(k, None)
    d["word_count"] = len(s.words)
    d["note_count"] = len(s.notes)
    return d


@app.get("/api/songs")
def list_songs():
    """The user's own songs (uploads). Built-in songs are under /api/catalog."""
    return [_summary(s) for s in library.list_songs()]


def _guess_title(filename: str) -> tuple[str, Optional[str]]:
    stem = Path(filename).stem
    stem = re.sub(r"[_]+", " ", stem).strip()
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return title.strip(), artist.strip()
    return stem or "Untitled", None


@app.post("/api/songs")
async def upload_song(file: UploadFile = File(...), title: Optional[str] = Form(None),
                      artist: Optional[str] = Form(None), detail_level: str = Form("balanced"),
                      language: Optional[str] = Form(None), instrument: Optional[str] = Form(None)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Please upload an MP3, WAV or M4A file.")
    try:
        entitlements.check_upload_allowed()
    except entitlements.UploadLimitReached as e:
        raise HTTPException(402, str(e))
    guessed_title, guessed_artist = _guess_title(file.filename or "song")
    song_id = library.new_song_id(title or guessed_title)
    d = library.song_dir(song_id)
    d.mkdir(parents=True, exist_ok=True)
    original = d / f"original{ext}"
    with original.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    try:
        info = audio_mod.probe(original)
    except Exception as e:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, str(e))
    if info["duration"] > 15 * 60:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "That file is longer than 15 minutes. Please upload a single song.")
    song = Song(
        id=song_id, title=title or info.get("title") or guessed_title,
        artist=artist or info.get("artist") or guessed_artist,
        duration=round(info["duration"], 3), created_at=library.now_iso(), updated_at=library.now_iso(),
        source={"kind": "upload", "filename": file.filename, "format": ext.lstrip(".")},
        files={"original": original.name},
    )
    song.settings.detail_level = detail_level if detail_level in DETAIL_LEVELS else "balanced"
    if language:
        song.language.override = language
    if instrument:
        song.user.instrument = instrument
    library.save_song(song)
    manager.submit(song_id, list(STEP_ORDER))
    return song.model_dump()


@app.get("/api/songs/{song_id}")
def get_song(song_id: str):
    """A song with everything the player needs. Works for uploads and catalog songs."""
    try:
        d = library.load_song(song_id).model_dump()
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    if library.is_catalog(song_id):
        d["catalog"] = catalog_store.entry(song_id)
    return d


class SongPatch(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    words: Optional[list[Word]] = None
    notes: Optional[list[Note]] = None
    lines: Optional[list[Line]] = None
    user: Optional[UserSession] = None
    language_override: Optional[str] = None


@app.patch("/api/songs/{song_id}")
def patch_song(song_id: str, patch: SongPatch):
    def upd(s: Song):
        if patch.title is not None:
            s.title = patch.title
        if patch.artist is not None:
            s.artist = patch.artist
        if patch.words is not None:
            s.words = patch.words
        if patch.notes is not None:
            s.notes = patch.notes
        if patch.lines is not None:
            s.lines = patch.lines
        if patch.user is not None:
            s.user = patch.user
        if patch.language_override is not None:
            s.language.override = patch.language_override or None
    try:
        d = library.update_song(song_id, upd).model_dump()
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    if library.is_catalog(song_id):
        d["catalog"] = catalog_store.entry(song_id)
    return d


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: str):
    """Deletes an upload; for a built-in song, resets your settings and note edits."""
    try:
        library.delete_song(song_id)
    except ValueError:
        raise HTTPException(404, "Song not found")
    return {"ok": True}


def _not_catalog(song_id: str) -> None:
    if library.is_catalog(song_id):
        raise HTTPException(400, "Built-in songs are already checked by hand and can't be processed again.")


@app.get("/api/songs/{song_id}/progress")
async def progress_stream(song_id: str):
    """Server-sent events with the processing progress."""
    try:
        library.load_song(song_id)
    except FileNotFoundError:
        raise HTTPException(404, "Song not found")

    async def gen():
        last = None
        while True:
            snap = manager.snapshot(song_id)
            payload = json.dumps(snap)
            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload
            if snap["status"] != "processing":
                yield "event: end\ndata: {}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/songs/{song_id}/progress/snapshot")
def progress_snapshot(song_id: str):
    return manager.snapshot(song_id)


class StepParams(BaseModel):
    detail_level: Optional[str] = None
    overrides: Optional[dict] = None
    language: Optional[str] = None


@app.post("/api/songs/{song_id}/steps/{step}")
def rerun_step(song_id: str, step: str, params: StepParams | None = None):
    """Re-run one step (or 'all'). Later steps that depend on it run again too."""
    params = params or StepParams()
    _not_catalog(song_id)
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    if step == "all":
        steps = list(STEP_ORDER)
    elif step == "stems":
        steps = ["stems", "melody", "lyrics", "attach"]
    elif step == "melody":
        steps = ["melody", "attach"]
    elif step == "cleanup":
        steps = ["cleanup"]
    elif step == "lyrics":
        steps = ["lyrics", "attach"]
    elif step == "attach":
        steps = ["attach"]
    elif step == "retry":
        # resume from the first step that is not done
        steps = [s for s in STEP_ORDER if song.steps.get(s) is None or song.steps[s].status != "done"] or ["attach"]
    else:
        raise HTTPException(400, "Unknown step")
    job_params: dict = {}
    if "cleanup" in steps:
        job_params["cleanup"] = {"detail_level": params.detail_level, "overrides": params.overrides}
    if "lyrics" in steps and params.language is not None:
        job_params["lyrics"] = {"language": params.language or None}
        library.update_song(song_id, lambda s: setattr(s.language, "override", params.language or None))
    if "melody" in steps and params.detail_level:
        library.update_song(song_id, lambda s: setattr(s.settings, "detail_level", params.detail_level))
    manager.submit(song_id, steps, job_params)
    return manager.snapshot(song_id)


class LyricsBody(BaseModel):
    text: str


@app.post("/api/songs/{song_id}/lyrics")
def paste_lyrics(song_id: str, body: LyricsBody):
    """Use pasted lyrics instead of the transcription (aligned to the audio)."""
    _not_catalog(song_id)
    try:
        run_paste_lyrics(song_id, body.text)
    except FileNotFoundError:
        raise HTTPException(404, "Song not found")
    return library.load_song(song_id).model_dump()


@app.get("/api/songs/{song_id}/lyrics")
def get_pasted_lyrics(song_id: str):
    p = library.song_dir(song_id) / "lyrics_pasted.txt"
    return {"text": p.read_text(encoding="utf-8") if p.exists() else ""}


_render_locks: dict[str, asyncio.Lock] = {}


@app.get("/api/songs/{song_id}/audio/{stem}")
async def get_audio(song_id: str, stem: str, shift: int = 0):
    """Stream a stem. `shift` (semitones, -6..6) returns a pitch-shifted render,
    created on first request and cached in the song folder."""
    if stem not in ("backing", "vocals", "original"):
        raise HTTPException(404, "Unknown stem")
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    d = library.song_dir(song_id)
    if stem == "original":
        return FileResponse(d / song.files["original"])
    base = d / f"{stem}.{STEM_FORMAT}"
    if not base.exists():
        raise HTTPException(404, "This stem is not ready yet")
    shift = max(-12, min(12, int(shift)))
    if shift == 0:
        return FileResponse(base, media_type="audio/mpeg")
    target = await _shifted_render(song_id, stem, shift)
    # Warm the neighbouring keys in the background so the next step is instant.
    for nb in (shift + 1, shift - 1):
        if -6 <= nb <= 6 and nb != 0:
            asyncio.create_task(_shifted_render(song_id, stem, nb))
    return FileResponse(target, media_type="audio/mpeg")


async def _shifted_render(song_id: str, stem: str, shift: int) -> Path:
    base = library.song_dir(song_id) / f"{stem}.{STEM_FORMAT}"
    target = library.render_dir(song_id) / f"shift_{stem}_{shift:+d}.{STEM_FORMAT}"
    if target.exists():
        return target
    lock = _render_locks.setdefault(f"{song_id}:{stem}:{shift}", asyncio.Lock())
    async with lock:
        if not target.exists():
            tmp = target.with_name(target.name + ".tmp.mp3")
            await asyncio.to_thread(audio_mod.pitch_shift_file, base, tmp, shift)
            tmp.replace(target)
    return target
