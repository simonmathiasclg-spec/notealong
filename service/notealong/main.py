"""NoteAlong processing service (FastAPI)."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from . import entitlements, library, searchindex
from . import me as me_store
from .catalog import store as catalog_store
from .config import CATALOG_DIR, DETAIL_LEVELS, LIBRARY_DIR, STEM_FORMAT, processing_steps
from .jobs import manager, recover_interrupted, upgrader
from .pipeline import audio as audio_mod
from .pipeline import fingerprint as fp_mod
from .catalog.artwork import render_cover
from .pipeline.runner import STEP_ORDER, run_paste_lyrics
from .schemas import Line, Note, Song, UserSession, Word

app = FastAPI(title="NoteAlong service", version="0.1.0")
# The web app runs on http://localhost:3001 (./start.sh). Only pages served from this Mac may call the service,
# so a website open in another tab can't read or change the library; NOTEALONG_WEB_ORIGINS overrides it.
_ORIGINS = [o.strip() for o in os.environ.get("NOTEALONG_WEB_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_ORIGINS,
                   allow_origin_regex=None if _ORIGINS else r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])

AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".aiff", ".aif", ".wma", ".m4b", ".caf", ".amr"}
VIDEO_EXT = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".mpg", ".mpeg", ".3gp", ".ts"}
PROTECTED_EXT = {".m4p", ".aax", ".aa"}
ALLOWED_EXT = AUDIO_EXT | VIDEO_EXT


@app.on_event("startup")
def _startup() -> None:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    recover_interrupted()
    # songs added before duplicate detection existed get their fingerprint now (a fraction of a second each)
    for s in library.list_songs():
        if s.status == "ready" and "fingerprint" not in s.source and s.files.get("original"):
            print_ = fp_mod.fingerprint(library.song_dir(s.id) / s.files["original"])
            library.update_song(s.id, lambda x, print_=print_: x.source.__setitem__("fingerprint", print_))
    # uploads made with an older note pipeline are improved in the background (edits kept)
    upgrader.start()


@app.get("/api/health")
def health():
    return {"ok": True, "library": str(LIBRARY_DIR), "catalog": str(CATALOG_DIR), "catalog_songs": len(catalog_store.load_index()["songs"]),
            "steps": processing_steps(), "detail_levels": list(DETAIL_LEVELS), "pitch_shift": audio_mod.pitch_shift_engine()}


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
        # when this user last opened the song: their saved settings for it carry the time
        s["last_played"] = library.last_played(s["id"])
    return data


@app.get("/api/catalog/{song_id}/cover")
def get_cover(song_id: str):
    try:
        d = library.song_dir(song_id)
    except ValueError:
        raise HTTPException(404, "Song not found")
    if not library.is_catalog(song_id):
        raise HTTPException(404, "No cover")
    for name, media in (("cover.webp", "image/webp"), ("cover.svg", "image/svg+xml")):
        if (d / name).exists():
            return FileResponse(d / name, media_type=media, headers={"Cache-Control": "public, max-age=86400"})
    raise HTTPException(404, "No cover")


@app.get("/api/songs/{song_id}/cover")
def get_upload_cover(song_id: str):
    """An upload's cover: the one the user chose, else the picture embedded in the file, else a generated one.
    Private to this library, like everything about an upload."""
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    d = library.song_dir(song_id)
    for name in ("cover_user.jpg", "cover_user.png", song.files.get("cover") or ""):
        if name and (d / name).exists():
            media = "image/png" if name.endswith(".png") else "image/jpeg"
            return FileResponse(d / name, media_type=media, headers={"Cache-Control": "private, max-age=60"})
    # no picture of its own: a generated one, drawn once and kept with the song
    gen = d / "cover_gen.webp"
    if not gen.exists():
        render_cover(song_id, "Pop").save(gen, "WEBP", quality=80, method=6)
    return FileResponse(gen, media_type="image/webp", headers={"Cache-Control": "private, max-age=3600"})


@app.put("/api/songs/{song_id}/cover")
async def put_upload_cover(song_id: str, file: UploadFile = File(...)):
    """Replace the cover with a picture of the user's own (JPEG or PNG, up to 10 MB)."""
    _not_catalog(song_id)
    try:
        library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "That picture is bigger than 10 MB.")
    kind = "jpg" if data[:3] == b"\xff\xd8\xff" else "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else None
    if kind is None:
        raise HTTPException(400, "Use a JPEG or PNG picture for the cover.")
    d = library.song_dir(song_id)
    for old in ("cover_user.jpg", "cover_user.png"):
        (d / old).unlink(missing_ok=True)
    (d / f"cover_user.{kind}").write_bytes(data)
    return {"ok": True}


@app.delete("/api/songs/{song_id}/cover")
def delete_upload_cover(song_id: str):
    """Back to the embedded or generated cover."""
    _not_catalog(song_id)
    d = library.song_dir(song_id)
    for old in ("cover_user.jpg", "cover_user.png"):
        (d / old).unlink(missing_ok=True)
    return {"ok": True}


def _summary(s: Song) -> dict:
    d = s.model_dump()
    for k in ("words", "notes", "lines"):
        d.pop(k, None)
    d["word_count"] = len(s.words)
    d["note_count"] = len(s.notes)
    d["source"].pop("fingerprint", None)
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
    if ext in PROTECTED_EXT:
        raise HTTPException(400, "That is a copy-protected file (Apple Music or an audiobook). It can only play in its own app. Use a song you own as an MP3, M4A, WAV or FLAC, or a recording.")
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "That kind of file isn't supported. Use an audio file (MP3, M4A, WAV, FLAC, OGG) or a video (MP4, MOV, WEBM, MKV).")
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
        info = audio_mod.probe_streams(original)
    except Exception as e:
        shutil.rmtree(d, ignore_errors=True)
        low = str(e).lower()
        if "drm" in low or "encrypt" in low:
            raise HTTPException(400, "That file is copy-protected and can't be read. Use a song you own as an MP3, M4A, WAV or FLAC.")
        raise HTTPException(400, "The audio in that file could not be read. It may be damaged or still downloading; try exporting it again as MP3, M4A or WAV.")
    if not info["has_audio"]:
        shutil.rmtree(d, ignore_errors=True)
        if info["has_video"]:
            raise HTTPException(400, "That video has no sound in it.")
        raise HTTPException(400, "The audio in that file could not be read. It may be damaged or still downloading; try exporting it again as MP3, M4A or WAV.")
    if info["duration"] > 15 * 60:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "That file is longer than 15 minutes. Please upload a single song.")
    if info["duration"] < 1:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "The audio in that file could not be read. It may be damaged or still downloading; try exporting it again as MP3, M4A or WAV.")
    if info["duration"] < 5:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "That file is shorter than 5 seconds. Please upload a whole song.")
    # The same recording again (another export, bitrate, format or the video of it)? Reuse what is there.
    print_ = fp_mod.fingerprint(original)
    if print_:
        for other in library.list_songs():
            if other.status == "ready" and abs(other.duration - info["duration"]) < 3.0 and fp_mod.same_recording(print_, other.source.get("fingerprint")):
                shutil.rmtree(d, ignore_errors=True)
                out = other.model_dump()
                out["duplicate_of"] = other.id
                return out
    cover = audio_mod.extract_picture(original, d / "cover.jpg") if info["has_picture"] else None
    if ext in VIDEO_EXT or info["has_video"]:
        # a video: keep only its soundtrack
        try:
            audio_mod.extract_audio(original, d / "original.m4a")
        except Exception:
            shutil.rmtree(d, ignore_errors=True)
            raise HTTPException(400, "The sound of that video could not be read. Try exporting the audio as MP3 or M4A.")
        original.unlink(missing_ok=True)
        original = d / "original.m4a"
        ext = ".m4a"
    song = Song(
        id=song_id, title=title or info.get("title") or guessed_title,
        artist=artist or info.get("artist") or guessed_artist,
        duration=round(info["duration"], 3), created_at=library.now_iso(), updated_at=library.now_iso(),
        source={"kind": "upload", "filename": file.filename, "format": ext.lstrip("."), "album": info.get("album"), "fingerprint": print_},
        files={"original": original.name, **({"cover": cover.name} if cover else {})},
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
        upload = not library.is_catalog(song_id)
        library.delete_song(song_id)
    except ValueError:
        raise HTTPException(404, "Song not found")
    if upload:
        me_store.forget_song(song_id)
    return {"ok": True}


class TrimBody(BaseModel):
    start: float = 0.0
    end: Optional[float] = None


@app.post("/api/songs/{song_id}/trim")
def trim_song(song_id: str, body: TrimBody):
    """Cuts the start and/or end off an upload (a video's intro, applause at the end). The audio files are cut
    and every note, word and line moves with them: nothing is processed again and edits are kept."""
    _not_catalog(song_id)
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    if song.status != "ready":
        raise HTTPException(409, "The song is still being processed. Trim it when it is ready.")
    start = max(0.0, float(body.start or 0.0))
    end = min(song.duration, float(body.end)) if body.end else song.duration
    if end - start < 5.0:
        raise HTTPException(400, "Keep at least 5 seconds of the song.")
    if start < 0.05 and song.duration - end < 0.05:
        return song.model_dump()
    try:
        library.trim_song(song_id, start, end)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"The song could not be trimmed: {str(e)[:200]}")
    return library.load_song(song_id).model_dump()


# ---- favourites, plays, setlists -------------------------------------------------
class FavouriteBody(BaseModel):
    on: bool = True


@app.get("/api/me/library")
def my_library():
    """Everything the browse screens need about this user: favourites, play counts, setlists."""
    return {"favourites": me_store.favourites(), "plays": me_store.plays(), "setlists": me_store.setlists()}


@app.put("/api/me/favourites/{song_id}")
def put_favourite(song_id: str, body: FavouriteBody):
    try:
        return {"favourites": me_store.set_favourite(song_id, body.on)}
    except ValueError:
        raise HTTPException(400, "Bad song id")


@app.post("/api/songs/{song_id}/played")
def song_played(song_id: str):
    """Called once when a song really starts playing; drives "Most played" and "Jump back in"."""
    try:
        return me_store.record_play(song_id)
    except ValueError:
        raise HTTPException(400, "Bad song id")


class SetlistBody(BaseModel):
    name: Optional[str] = None
    songs: Optional[list[str]] = None
    gap_seconds: Optional[int] = None


@app.post("/api/me/setlists")
def create_setlist(body: SetlistBody):
    try:
        return me_store.create_setlist(body.model_dump(exclude_none=True))
    except ValueError:
        raise HTTPException(400, "A song id in that setlist is not valid.")


@app.put("/api/me/setlists/{set_id}")
def update_setlist(set_id: str, body: SetlistBody):
    try:
        return me_store.update_setlist(set_id, body.model_dump(exclude_none=True))
    except KeyError:
        raise HTTPException(404, "Setlist not found")
    except ValueError:
        raise HTTPException(400, "A song id in that setlist is not valid.")


@app.delete("/api/me/setlists/{set_id}")
def delete_setlist(set_id: str):
    me_store.delete_setlist(set_id)
    return {"ok": True}


# ---- one search index over the catalog and the user's own songs ------------------
@app.get("/api/search-index")
def search_index():
    """One list over the built-in songs and this user's uploads, with what search and the filters
    need (lyrics text, note range, tempo, year). The uploads are this user's own and stay on this install."""
    out = searchindex.catalog_rows()
    for song in library.list_songs():
        if song.status != "ready":
            continue
        out.append(searchindex.row(library.song_path(song.id), searchindex.upload_extra(song)))
    return {"songs": out}


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
    hold_across_words: Optional[bool] = None   # keep one held note when the singer carries a vowel into the next word
    melody: Optional[str] = None               # "sax" (one held note per syllable) or "detailed" (literal)


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
        job_params["cleanup"] = {"detail_level": params.detail_level, "overrides": params.overrides,
                                 "melody": params.melody if params.melody in ("sax", "detailed") else None}
    if "lyrics" in steps and params.language is not None:
        job_params["lyrics"] = {"language": params.language or None}
        library.update_song(song_id, lambda s: setattr(s.language, "override", params.language or None))
    if "melody" in steps and params.detail_level:
        library.update_song(song_id, lambda s: setattr(s.settings, "detail_level", params.detail_level))
    if params.hold_across_words is not None:
        library.update_song(song_id, lambda s: s.settings.cleanup.__setitem__("hold_across_words", bool(params.hold_across_words)))
    manager.submit(song_id, steps, job_params)
    return manager.snapshot(song_id)


@app.post("/api/songs/{song_id}/stop")
def stop_job(song_id: str):
    """Stops processing of a song (the step that was running is marked failed; retry continues from there)."""
    try:
        library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    return {"stopped": manager.stop(song_id)}


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


@app.get("/api/songs/{song_id}/dynamics")
def get_dynamics(song_id: str):
    """How loudly each note was sung (0..1), so "Hear it played" can follow the singer. Built-in songs have
    no singer (their guide is an instrument): the player shapes those from the melody itself."""
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    if library.is_catalog(song_id):
        return {"source": "none", "levels": {}}
    from .pipeline.dynamics import note_levels
    from .pipeline.runner import articulation
    art = articulation(library.song_dir(song_id))
    if art is None:
        return {"source": "none", "levels": {}}
    return {"source": "vocals", "levels": note_levels(song.notes, art)}


@app.get("/api/songs/{song_id}/score")
def get_score(song_id: str):
    """The beat grid, time signature and chords for the sheet music view. Hand-authored songs answer at once
    from their .song file; for other songs the first request listens to the backing track (a few seconds) and
    the answer is kept."""
    try:
        song = library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    from .config import CATALOG_DIR
    from .pipeline.score import song_score
    catalog = library.is_catalog(song_id)
    d = library.song_dir(song_id)
    backing = d / song.files.get("backing", "backing.mp3")
    if not backing.exists():
        raise HTTPException(404, "No backing track yet")
    key = (song.key.tonic, song.key.mode) if song.key else None
    return song_score(CATALOG_DIR / "songs" / f"{song_id}.song" if catalog else None, backing,
                      library.render_dir(song_id) / "score.json", song.duration, key,
                      harmony=None if catalog else d / "harmony.npz")


_render_locks: dict[str, asyncio.Lock] = {}
_warm_queue: asyncio.PriorityQueue[tuple[int, int, tuple[str, str, int, bool]]] | None = None
_warm_pending: set[tuple[str, str, int, bool]] = set()
_warm_seq = 0
MAX_SHIFT = 6


@app.get("/api/songs/{song_id}/audio/{stem}")
async def get_audio(song_id: str, stem: str, shift: int = 0):
    """Stream a stem. `shift` (semitones, -6..6) returns a pitch-shifted render, created on first
    request and cached in the song folder. The first render of a key uses the fast engine so the wait
    is short; the key and its neighbours are then re-rendered with the fine engine in the background
    (one at a time), and later requests get the better file."""
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
    shift = max(-MAX_SHIFT, min(MAX_SHIFT, int(shift)))
    if shift == 0:
        return FileResponse(base, media_type="audio/mpeg")
    target = await _shifted_render(song_id, stem, shift, fine=False)
    _warm_keys(song_id, shift)
    return FileResponse(target, media_type="audio/mpeg")


@app.post("/api/songs/{song_id}/prepare")
async def prepare_keys(song_id: str, shift: int = 0):
    """Render the keys one step up and down from `shift` in the background, so the next key change is instant."""
    try:
        library.load_song(song_id)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Song not found")
    _warm_keys(song_id, shift)
    return {"queued": len(_warm_pending)}


def _shift_target(song_id: str, stem: str, shift: int) -> Path:
    return library.render_dir(song_id) / f"shift_{stem}_{shift:+d}.{STEM_FORMAT}"


def _is_stale(target: Path, base: Path) -> bool:
    return not target.exists() or target.stat().st_mtime < base.stat().st_mtime


def _warm_keys(song_id: str, shift: int) -> None:
    """Queue renders of `shift` and its neighbours for both stems: first fast renders of whatever is
    missing (so the next key change is instant within seconds), then fine renders of all of them."""
    if _warm_queue is None:
        return
    shifts = [s for s in (shift, shift + 1, shift - 1) if s != 0 and -MAX_SHIFT <= s <= MAX_SHIFT]
    for fine in (False, True):
        for s in shifts:
            for stem in ("backing", "vocals"):
                key = (song_id, stem, s, fine)
                base = library.song_dir(song_id) / f"{stem}.{STEM_FORMAT}"
                target = _shift_target(song_id, stem, s)
                done = (not _is_stale(target, base)) if not fine else (target.with_suffix(".fine").exists() and not _is_stale(target.with_suffix(".fine"), base))
                if key in _warm_pending or done:
                    continue
                _warm_pending.add(key)
                # all fast renders before any fine one; among equals, the latest request first
                global _warm_seq
                _warm_seq += 1
                _warm_queue.put_nowait((1 if fine else 0, -_warm_seq, key))


async def _warm_worker() -> None:
    assert _warm_queue is not None
    while True:
        _, _, (song_id, stem, shift, fine) = await _warm_queue.get()
        try:
            await _shifted_render(song_id, stem, shift, fine=fine)
        except Exception as e:   # a failed warm-up is not an error anyone needs to see
            print(f"warm render failed for {song_id} {stem} {shift:+d}: {e}", flush=True)
        finally:
            _warm_pending.discard((song_id, stem, shift, fine))
            _warm_queue.task_done()


@app.on_event("startup")
async def _start_warm_worker() -> None:
    global _warm_queue
    _warm_queue = asyncio.PriorityQueue()
    asyncio.create_task(_warm_worker())


async def _shifted_render(song_id: str, stem: str, shift: int, *, fine: bool) -> Path:
    """The pitch-shifted stem file, rendered if missing or older than the stem it comes from.
    fine=True (re)renders with the fine engine unless a fine render already exists; a `.fine` marker
    next to the file records that. Fast and fine renders take separate locks, so a listener's request
    never waits behind a background upgrade of the same key."""
    base = library.song_dir(song_id) / f"{stem}.{STEM_FORMAT}"
    target = _shift_target(song_id, stem, shift)
    marker = target.with_suffix(".fine")
    def have_fine() -> bool:
        return marker.exists() and not _is_stale(marker, base) and not _is_stale(target, base)
    def good() -> bool:
        return have_fine() or (not fine and not _is_stale(target, base))
    if good():
        return target
    kind = "fine" if fine else "fast"
    lock = _render_locks.setdefault(f"{song_id}:{stem}:{shift}:{kind}", asyncio.Lock())
    async with lock:
        if not good():
            tmp = target.with_name(f"{target.name}.{kind}.tmp.mp3")
            await asyncio.to_thread(audio_mod.pitch_shift_file, base, tmp, shift, fine=fine, formant=(stem == "vocals"))
            if fine:
                tmp.replace(target)
                marker.touch()
            elif have_fine():       # a fine render landed while this one was running; keep the better file
                tmp.unlink()
            else:
                tmp.replace(target)
    return target
