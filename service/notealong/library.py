"""Song storage: one folder per song with audio files and song.json."""
from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import LIBRARY_DIR
from .schemas import Song

_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_song_id(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "song"
    return f"{slug}-{secrets.token_hex(3)}"


def song_dir(song_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]+", song_id):
        raise ValueError("bad song id")
    return LIBRARY_DIR / song_id


def song_path(song_id: str) -> Path:
    return song_dir(song_id) / "song.json"


def load_song(song_id: str) -> Song:
    with _lock:
        return Song.model_validate_json(song_path(song_id).read_text(encoding="utf-8"))


def save_song(song: Song) -> None:
    song.updated_at = now_iso()
    path = song_path(song.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with _lock:
        tmp.write_text(song.model_dump_json(indent=1), encoding="utf-8")
        tmp.replace(path)


def update_song(song_id: str, fn) -> Song:
    """Read-modify-write under the lock."""
    with _lock:
        song = load_song(song_id)
        fn(song)
        save_song(song)
        return song


def list_songs() -> list[Song]:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    songs = []
    for d in sorted(LIBRARY_DIR.iterdir()):
        p = d / "song.json"
        if p.exists():
            try:
                songs.append(Song.model_validate_json(p.read_text(encoding="utf-8")))
            except Exception:
                continue
    songs.sort(key=lambda s: s.created_at, reverse=True)
    return songs


def delete_song(song_id: str) -> None:
    d = song_dir(song_id)
    if d.exists():
        shutil.rmtree(d)


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))
