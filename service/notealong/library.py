"""Song storage: one folder per song with audio files and song.json.

Two places hold songs:
  library/<id>/   the user's uploads (read-write)
  catalog/<id>/   built-in songs shipped with the app (read-only). What the user
                  changes on a catalog song (settings, note fixes) is kept as an
                  overlay in library/.catalog/<id>.json; key-shifted renders go to
                  library/.cache/<id>/.
"""
from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import CATALOG_DIR, LIBRARY_DIR
from .schemas import Song

_lock = threading.RLock()
OVERLAY_FIELDS = ("user", "notes", "words", "lines")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_song_id(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "song"
    return f"{slug}-{secrets.token_hex(3)}"


def _check_id(song_id: str) -> None:
    if not re.fullmatch(r"[a-z0-9-]+", song_id):
        raise ValueError("bad song id")


def is_catalog(song_id: str) -> bool:
    _check_id(song_id)
    return not (LIBRARY_DIR / song_id / "song.json").exists() and (CATALOG_DIR / song_id / "song.json").exists()


def song_dir(song_id: str) -> Path:
    """Folder holding song.json and the audio (catalog folder for built-in songs)."""
    _check_id(song_id)
    if is_catalog(song_id):
        return CATALOG_DIR / song_id
    return LIBRARY_DIR / song_id


def render_dir(song_id: str) -> Path:
    """Where generated files (key-shifted renders) may be written."""
    if is_catalog(song_id):
        d = LIBRARY_DIR / ".cache" / song_id
        d.mkdir(parents=True, exist_ok=True)
        return d
    return song_dir(song_id)


def overlay_path(song_id: str) -> Path:
    _check_id(song_id)
    return LIBRARY_DIR / ".catalog" / f"{song_id}.json"


def last_played(song_id: str) -> str | None:
    """When the user last used a built-in song (their saved settings for it are stamped on every change)."""
    try:
        p = overlay_path(song_id)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8")).get("updated_at")
    except Exception:
        return None


def song_path(song_id: str) -> Path:
    return song_dir(song_id) / "song.json"


def load_song(song_id: str) -> Song:
    with _lock:
        song = Song.model_validate_json(song_path(song_id).read_text(encoding="utf-8"))
        if is_catalog(song_id):
            op = overlay_path(song_id)
            if op.exists():
                overlay = json.loads(op.read_text(encoding="utf-8"))
                data = song.model_dump()
                for k in OVERLAY_FIELDS:
                    if k in overlay:
                        data[k] = overlay[k]
                data["updated_at"] = overlay.get("updated_at", data["updated_at"])
                song = Song.model_validate(data)
        return song


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def save_song(song: Song) -> None:
    song.updated_at = now_iso()
    with _lock:
        if is_catalog(song.id):
            base = Song.model_validate_json(song_path(song.id).read_text(encoding="utf-8")).model_dump()
            data = song.model_dump()
            overlay = {"id": song.id, "updated_at": song.updated_at, "user": data["user"]}
            for k in ("notes", "words", "lines"):
                if data[k] != base[k]:
                    overlay[k] = data[k]
            _atomic_write(overlay_path(song.id), json.dumps(overlay, ensure_ascii=False, indent=1))
            return
        _atomic_write(song_path(song.id), song.model_dump_json(indent=1))


def update_song(song_id: str, fn) -> Song:
    """Read-modify-write under the lock."""
    with _lock:
        song = load_song(song_id)
        fn(song)
        save_song(song)
        return song


def list_songs() -> list[Song]:
    """The user's own songs (uploads), newest first."""
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    songs = []
    for d in sorted(LIBRARY_DIR.iterdir()):
        if d.name.startswith("."):
            continue
        p = d / "song.json"
        if p.exists():
            try:
                songs.append(Song.model_validate_json(p.read_text(encoding="utf-8")))
            except Exception:
                continue
    songs.sort(key=lambda s: s.created_at, reverse=True)
    return songs


def trim_song(song_id: str, start: float, end: float) -> None:
    """Keeps only [start, end] of an upload: the audio files are cut, every time in the song moves by -start,
    and notes, words and lines outside the kept part are dropped. Caches made from the old timing go."""
    import subprocess
    from .config import STEM_BITRATE
    d = song_dir(song_id)
    song = load_song(song_id)
    length = end - start

    def cut(src: Path, codec: list[str]) -> None:
        tmp = src.with_name(src.stem + ".trim" + src.suffix)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{length:.3f}", "-vn", *codec, str(tmp)],
                       check=True, capture_output=True)
        tmp.replace(src)

    with _lock:
        for name in ("vocals.mp3", "backing.mp3"):
            if (d / name).exists():
                cut(d / name, ["-c:a", "libmp3lame", "-b:a", STEM_BITRATE])
        if (d / "vocals.wav").exists():
            cut(d / "vocals.wav", ["-c:a", "pcm_s16le"])
        orig = d / song.files["original"]
        if orig.exists():
            codec = {".mp3": ["-c:a", "libmp3lame", "-b:a", "192k"], ".wav": ["-c:a", "pcm_s16le"], ".flac": ["-c:a", "flac"]}.get(orig.suffix.lower(), ["-c:a", "aac", "-b:a", "192k"])
            if orig.suffix.lower() not in (".mp3", ".wav", ".flac", ".m4a", ".aac"):
                new = orig.with_suffix(".m4a")
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", str(orig), "-t", f"{length:.3f}", "-vn", "-c:a", "aac", "-b:a", "192k", str(new)],
                               check=True, capture_output=True)
                orig.unlink()
                song.files["original"] = new.name
            else:
                cut(orig, codec)
        for f in list(d.glob("shift_*")) + [d / "pitch.npz", d / "envelope.json"]:
            f.unlink(missing_ok=True)

        def move(items: list) -> list:
            """Shifts timed items by -start and drops those outside the kept part. Items are dicts with start/end,
            or [start, end] pairs (the sentence spans in transcript.json)."""
            out = []
            for it in items:
                pair = isinstance(it, (list, tuple))
                s, e = (it[0], it[1]) if pair else (it["start"], it["end"])
                if e <= start + 0.02 or s >= end - 0.02:
                    continue
                s, e = round(max(0.0, s - start), 3), round(min(length, e - start), 3)
                out.append([s, e, *it[2:]] if pair else dict(it, start=s, end=e))
            return out

        for name in ("notes_raw.json", "transcript.json"):
            path = d / name
            if path.exists():
                data = read_json(path)
                if isinstance(data, list):
                    write_json(path, move(data))
                elif isinstance(data, dict):
                    for key in ("words", "segments"):
                        if isinstance(data.get(key), list):
                            data[key] = move(data[key])
                    write_json(path, data)

    def upd(s: Song):
        from .schemas import Line, Note, Word
        s.notes = [Note(**n) for n in move([n.model_dump() for n in s.notes])]
        s.words = [Word(**w) for w in move([w.model_dump() for w in s.words])]
        s.lines = [Line(**l) for l in move([l.model_dump() for l in s.lines])]
        s.duration = round(length, 3)
        s.files["original"] = song.files["original"]
        trims = s.source.get("trim") or {"start": 0.0, "end": None}
        s.source["trim"] = {"start": round(float(trims.get("start") or 0.0) + start, 3), "end": round(float(trims.get("start") or 0.0) + end, 3)}
        s.user.position = 0.0
        s.user.loop = None
    update_song(song_id, upd)


def delete_song(song_id: str) -> None:
    """Deletes an upload. For a catalog song this only resets the user's changes."""
    if is_catalog(song_id):
        overlay_path(song_id).unlink(missing_ok=True)
        shutil.rmtree(LIBRARY_DIR / ".cache" / song_id, ignore_errors=True)
        return
    d = song_dir(song_id)
    if d.exists():
        shutil.rmtree(d)


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))
