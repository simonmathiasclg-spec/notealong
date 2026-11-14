"""What this user keeps: favourite songs, how often they play each song, and their setlists.

Stored as small JSON files in library/.me/ next to the user's uploads (there are no accounts yet;
like everything in library/, it belongs to the one person using this install).
"""
from __future__ import annotations

import json
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import LIBRARY_DIR

_lock = threading.RLock()


def _dir() -> Path:
    d = LIBRARY_DIR / ".me"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read(name: str, default):
    p = _dir() / name
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default


def _write(name: str, data) -> None:
    p = _dir() / name
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _valid_id(song_id: str) -> str:
    if not re.fullmatch(r"[a-z0-9-]{1,120}", song_id or ""):
        raise ValueError("bad song id")
    return song_id


# ---- favourites ---------------------------------------------------------------
def favourites() -> list[str]:
    """Song ids, most recently added first."""
    return [s for s in _read("favourites.json", []) if isinstance(s, str)]


def set_favourite(song_id: str, on: bool) -> list[str]:
    _valid_id(song_id)
    with _lock:
        fav = [s for s in favourites() if s != song_id]
        if on:
            fav.insert(0, song_id)
        _write("favourites.json", fav)
        return fav


# ---- plays --------------------------------------------------------------------
def plays() -> dict[str, dict]:
    """{song_id: {"count": n, "last": iso}}"""
    data = _read("plays.json", {})
    return data if isinstance(data, dict) else {}


def record_play(song_id: str) -> dict:
    _valid_id(song_id)
    with _lock:
        data = plays()
        row = data.get(song_id) or {"count": 0}
        row = {"count": int(row.get("count", 0)) + 1, "last": _now()}
        data[song_id] = row
        _write("plays.json", data)
        return row


# ---- setlists -----------------------------------------------------------------
def setlists() -> list[dict]:
    data = _read("setlists.json", [])
    return data if isinstance(data, list) else []


def _clean(sl: dict, existing: dict | None = None) -> dict:
    name = str(sl.get("name") or (existing or {}).get("name") or "My setlist").strip()[:80] or "My setlist"
    songs = [_valid_id(s) for s in (sl.get("songs") if "songs" in sl else (existing or {}).get("songs", []))][:200]
    gap = sl.get("gap_seconds", (existing or {}).get("gap_seconds", 5))
    gap = max(0, min(60, int(gap)))
    return {"name": name, "songs": songs, "gap_seconds": gap}


def create_setlist(sl: dict) -> dict:
    with _lock:
        all_ = setlists()
        row = {"id": f"set-{secrets.token_hex(4)}", **_clean(sl), "created_at": _now(), "updated_at": _now()}
        all_.insert(0, row)
        _write("setlists.json", all_)
        return row


def update_setlist(set_id: str, sl: dict) -> dict:
    with _lock:
        all_ = setlists()
        for i, row in enumerate(all_):
            if row.get("id") == set_id:
                all_[i] = {**row, **_clean(sl, row), "updated_at": _now()}
                _write("setlists.json", all_)
                return all_[i]
    raise KeyError(set_id)


def delete_setlist(set_id: str) -> None:
    with _lock:
        _write("setlists.json", [r for r in setlists() if r.get("id") != set_id])


def forget_song(song_id: str) -> None:
    """A deleted upload leaves favourites, plays and setlists."""
    with _lock:
        _write("favourites.json", [s for s in favourites() if s != song_id])
        p = plays()
        if song_id in p:
            del p[song_id]
            _write("plays.json", p)
        all_ = setlists()
        for row in all_:
            row["songs"] = [s for s in row.get("songs", []) if s != song_id]
        _write("setlists.json", all_)


# ---- "this note sounds wrong" -------------------------------------------------
def flags() -> list[dict]:
    """Notes the player marked as sounding wrong, oldest first (scripts/lab/flags_to_cases.py reads them)."""
    return [f for f in _read("flags.json", []) if isinstance(f, dict)]


def set_flag(entry: dict, on: bool) -> list[dict]:
    """Adds the mark, or takes it away again: one mark per song and note start."""
    song_id = _valid_id(str(entry.get("song_id", "")))
    start = round(float(entry.get("start", 0.0)), 2)
    with _lock:
        rest = [f for f in flags() if not (f.get("song_id") == song_id and abs(float(f.get("start", -9)) - start) < 0.011)]
        if on:
            rest.append({"song_id": song_id, "start": start, "end": round(float(entry.get("end", start)), 2), "midi": int(entry.get("midi", 0)),
                         "line": int(entry.get("line", 0)), "time": round(float(entry.get("time", start)), 2),
                         "word": str(entry.get("word") or "")[:80] or None, "melody": str(entry.get("melody") or "")[:20] or None,
                         "pipeline": entry.get("pipeline"), "at": _now()})
        _write("flags.json", rest[-5000:])
        return rest
