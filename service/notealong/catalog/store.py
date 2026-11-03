"""Runtime access to the built-in catalog (catalog/catalog.json)."""
from __future__ import annotations

import json
from pathlib import Path

from .. import config


def index_path() -> Path:
    return config.CATALOG_DIR / "catalog.json"


def load_index() -> dict:
    p = index_path()
    if not p.exists():
        return {"version": 1, "songs": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "songs": []}
    # only list songs whose folder is actually present
    data["songs"] = [s for s in data.get("songs", []) if (config.CATALOG_DIR / s["id"] / "song.json").exists()]
    return data


def entry(song_id: str) -> dict | None:
    for s in load_index()["songs"]:
        if s["id"] == song_id:
            return s
    return None
