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


def combo(params: dict | None = None, d_min: float = 0.12, resume: float = 0.15, in_key: bool = True):
    """Two methods vote: the Sax-friendly notes, plus every Detailed note that the Sax-friendly melody holds
    straight through on another pitch (a note it swallowed), if it lasts `d_min` and is in the key."""
    base = sax(params)

    def run(slug: str) -> list[dict]:
        S = sorted((dict(n) for n in base(slug)), key=lambda n: n["start"])
        key = load_song(slug).get("key") or {}
        scale = {(key.get("tonic", 0) + s) % 12 for s in (sm.MINOR_SCALE if key.get("mode") == "minor" else sm.MAJOR_SCALE)}
        out = list(S)
        for dn in sorted(detailed(slug), key=lambda n: n["start"]):
            if dn["end"] - dn["start"] < d_min or (in_key and dn["midi"] % 12 not in scale):
                continue
            if any(abs(n["start"] - dn["start"]) <= 0.12 for n in out):
                continue
            host = next((n for n in out if n["start"] < dn["start"] < n["end"] - 0.03), None)
            if host is None or (host["midi"] - dn["midi"]) % 12 == 0:
                continue
            end = host["end"]
            host["end"] = dn["start"]
            new = {"start": dn["start"], "end": min(dn["end"], end), "midi": dn["midi"], "word": host.get("word"), "syl": host.get("syl")}
            out.append(new)
            if end - new["end"] >= resume:
                out.append({**host, "start": new["end"], "end": end})
            out.sort(key=lambda n: n["start"])
        return out
    return run


def pruned(params: dict | None = None, shortest: float = 0.0, need_support: float = 0.0):
    """The Sax-friendly notes with (a) notes shorter than `shortest` taken out (their time goes to the note
    before), and (b) notes shorter than `need_support` kept only if the Detailed transcription has the same
    note name within 200 ms: the second method's vote on the doubtful ones."""
    base = sax(params)

    def run(slug: str) -> list[dict]:
        S = sorted((dict(n) for n in base(slug)), key=lambda n: n["start"])
        D = sorted(detailed(slug), key=lambda n: n["start"]) if need_support else []
        out: list[dict] = []
        for i, n in enumerate(S):
            sounding = (S[i + 1]["start"] if i + 1 < len(S) else n["end"]) - n["start"]
            dur = min(n["end"] - n["start"], sounding)
            drop = dur < shortest or (dur < need_support and not any(abs(d["start"] - n["start"]) <= 0.2 and (d["midi"] - n["midi"]) % 12 == 0 for d in D))
            if drop:
                if out and abs(out[-1]["end"] - n["start"]) < 0.02:
                    out[-1]["end"] = n["end"]
                continue
            out.append(n)
        return out
    return run
