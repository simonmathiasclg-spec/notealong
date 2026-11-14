"""Melody Lab: the algorithms under test. Each takes a song slug and returns notes [{start, end, midi}] in concert pitch."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from common import LAB, ROOT, load_song, song_dir  # noqa: E402
from notealong.pipeline import saxmelody as sm  # noqa: E402


def sax(params: dict | None = None, module=sm):
    p = module.SaxParams(**(params or {}))

    def run(slug: str) -> list[dict]:
        return module.sax_song(song_dir(slug), load_song(slug), p=p)["notes"]
    return run


def detailed(slug: str) -> list[dict]:
    """The Detailed mode: Basic Pitch's notes refined with the pitch curve and tidied (cleanup.py)."""
    import json
    from notealong.pipeline.cleanup import clean_notes
    d, song = song_dir(slug), load_song(slug)
    raw = json.loads((d / "notes_raw.json").read_text())
    notes, _ = clean_notes(raw, song["settings"]["detail_level"], None, tempo=song.get("tempo_bpm"))
    return notes


@lru_cache(maxsize=None)
def old_module(commit: str):
    """saxmelody.py as it was at a commit (a baseline), loaded beside the current one."""
    src = subprocess.run(["git", "show", f"{commit}:service/notealong/pipeline/saxmelody.py"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    f = LAB / "old" / f"saxmelody_{commit}.py"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(src.replace("from . import", "from notealong.pipeline import").replace("from .", "from notealong.pipeline."))
    spec = importlib.util.spec_from_file_location(f"saxmelody_{commit}", f)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod
