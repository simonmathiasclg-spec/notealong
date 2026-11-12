"""Rows of the search index (search box, filters, Discover shelves): the built-in songs and uploads.
Used by the local service (/api/search-index) and by the catalog upload for the online version."""
from __future__ import annotations

import json
from pathlib import Path

from .catalog import store as catalog_store
from .config import CATALOG_DIR
from .schemas import Song

_CACHE: dict[str, tuple[float, dict]] = {}


def row(song_json: Path, extra: dict) -> dict:
    """Fields to search and filter on, cached by the file's modification time."""
    key = str(song_json)
    mtime = song_json.stat().st_mtime
    hit = _CACHE.get(key)
    if hit and hit[0] == mtime:
        return {**hit[1], **extra}
    from .catalog.difficulty import rate_difficulty
    d = json.loads(song_json.read_text(encoding="utf-8"))
    notes = d.get("notes") or []
    midis = [n["midi"] for n in notes]
    words = " ".join(w.get("text", "") for w in d.get("words") or [])
    r = {"range": [min(midis), max(midis)] if midis else None, "lyrics": words[:4000], "note_count": len(notes)}
    if notes and "difficulty" not in extra:
        r["difficulty"] = rate_difficulty(notes)[0]
    _CACHE[key] = (mtime, r)
    return {**r, **extra}


def catalog_extra(s: dict) -> dict:
    return {"id": s["id"], "kind": "catalog", "title": s["title"], "artist": s.get("artist"), "genre": s.get("genre"),
            "culture": s.get("culture") or s.get("origin"), "origin": s.get("origin"), "language": s.get("language"),
            "year": s.get("year"), "tempo_bpm": s.get("tempo_bpm"), "difficulty": s.get("difficulty"),
            "duration": s.get("duration"), "source": (s.get("source") or {}).get("kind"), "tags": s.get("tags", []),
            "added": s.get("added"), "featured": s.get("featured", False), "accent_hue": s.get("accent_hue"),
            "colors": s.get("colors")}


def upload_extra(song: Song) -> dict:
    return {"id": song.id, "kind": "upload", "title": song.title, "artist": song.artist, "genre": None,
            "culture": None, "origin": None, "language": song.language.override or song.language.detected,
            "year": None, "tempo_bpm": song.tempo_bpm, "duration": song.duration, "source": "upload", "tags": [],
            "added": song.created_at[:10], "featured": False, "accent_hue": None}


def catalog_rows() -> list[dict]:
    out = []
    for s in catalog_store.load_index()["songs"]:
        p = CATALOG_DIR / s["id"] / "song.json"
        if p.exists():
            out.append(row(p, catalog_extra(s)))
    return out
