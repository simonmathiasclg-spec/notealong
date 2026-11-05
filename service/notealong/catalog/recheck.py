"""Work out the notes of the Creative Commons catalog songs again with the
current cleanup rules, keeping their words and timings.

    python -m notealong.catalog.recheck                 # every CC song
    python -m notealong.catalog.recheck --only artist-song [--dry-run]

For each song: raw notes (catalog/<id>/notes_raw.json, detected from the vocals
stem the first time) -> cleanup -> review against the pYIN pitch track ->
attach to the existing words, joining held notes. Prints a before/after table.
Slow intermediate results (pitch track, onset curves) are cached in
catalog/.cache/, which is not committed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..config import CATALOG_DIR, STEM_FORMAT
from ..pipeline.attach import attach_notes
from ..pipeline.cleanup import clean_notes, params_for
from ..pipeline.keydetect import detect_key
from ..pipeline.onsets import ENV_VERSION, Articulation, vocal_envelope
from .difficulty import rate_difficulty
from .verify import drop_outliers, review_notes

CACHE = CATALOG_DIR / ".cache"


def cc_ids() -> list[str]:
    out = []
    for d in sorted(CATALOG_DIR.iterdir()):
        meta = d / "catalog.json"
        if d.is_dir() and meta.exists() and json.loads(meta.read_text(encoding="utf-8")).get("source", {}).get("kind") == "cc":
            out.append(d.name)
    return out


def raw_notes(song_id: str) -> list[dict]:
    d = CATALOG_DIR / song_id
    path = d / "notes_raw.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    from ..pipeline.melody import detect_notes
    raw = detect_notes(d / f"vocals.{STEM_FORMAT}")
    path.write_text(json.dumps(raw, separators=(",", ":")), encoding="utf-8")
    return raw


def articulation(song_id: str) -> Articulation:
    path = CACHE / song_id / "envelope.json"
    if path.exists():
        env = json.loads(path.read_text(encoding="utf-8"))
        if env.get("version") == ENV_VERSION:
            return Articulation(env)
    env = vocal_envelope(CATALOG_DIR / song_id / f"vocals.{STEM_FORMAT}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(env, separators=(",", ":")), encoding="utf-8")
    return Articulation(env)


def derive(song_id: str, detail: str = "balanced", overrides: dict | None = None, held: bool = True,
           words: list[dict] | None = None, lines: list[dict] | None = None, language: str | None = None,
           tempo: float | None = None) -> tuple[list[dict], list[dict], dict]:
    """The full note chain for one catalog recording. Returns (notes, all_lines, report)."""
    d = CATALOG_DIR / song_id
    song = json.loads((d / "song.json").read_text(encoding="utf-8"))
    words = [dict(w) for w in (words if words is not None else song["words"])]
    lyric_lines = [dict(l) for l in (lines if lines is not None else song["lines"]) if l.get("kind", "lyric") == "lyric"]
    remap = {l["index"]: i for i, l in enumerate(lyric_lines)}
    for w in words:
        w["line"] = remap.get(w["line"], 0)
    for i, l in enumerate(lyric_lines):
        l["index"] = i
    notes, params = clean_notes(raw_notes(song_id), detail, overrides, tempo=tempo)
    report: dict = {"cleaned": len(notes)}
    notes, review = review_notes(notes, d / f"vocals.{STEM_FORMAT}", cache=CACHE / song_id / "pyin.npz")
    notes, outliers = drop_outliers(notes)
    review["outliers_dropped"] = outliers
    report["review"] = review
    held_report: dict = {}
    all_lines = attach_notes(notes, words, lyric_lines, art=articulation(song_id) if held else None, params=params,
                             language=language or song.get("language", {}).get("detected"), report=held_report)
    report["held"] = held_report
    report["words"] = words
    return notes, all_lines, report


def recheck(song_id: str, dry_run: bool = False) -> dict:
    d = CATALOG_DIR / song_id
    song = json.loads((d / "song.json").read_text(encoding="utf-8"))
    before = len(song["notes"])
    tempo = song.get("tempo_bpm")
    plain, _, _ = derive(song_id, song["settings"].get("detail_level", "balanced"), held=False, tempo=tempo)
    notes, all_lines, report = derive(song_id, song["settings"].get("detail_level", "balanced"), tempo=tempo)
    row = {"id": song_id, "before": before, "without_joining": len(plain), "after": len(notes), **{k: report["held"].get(k, 0) for k in ("same_pitch", "wobbles", "bends")}}
    if dry_run:
        return row
    key = detect_key(notes)
    for i, n in enumerate(notes):
        n["id"] = f"n{i + 1}"
        n.setdefault("edited", False)
        n.pop("amp", None)
    song["notes"] = notes
    song["words"] = report["words"]
    song["lines"] = all_lines
    song["key"] = key
    from ..pipeline.cleanup import tempo_scaled
    song["settings"]["cleanup"] = tempo_scaled(params_for(song["settings"].get("detail_level", "balanced")), tempo).to_dict()
    (d / "song.json").write_text(json.dumps(song, indent=1, ensure_ascii=False), encoding="utf-8")
    meta = json.loads((d / "catalog.json").read_text(encoding="utf-8"))
    rating, details = rate_difficulty(notes)
    meta.update({"difficulty": rating, "difficulty_details": details, "beginner": rating == "easy", "note_count": len(notes),
                 "key": key["name"] if key else None, "review": {**report["review"], "held": report["held"]}})
    (d / "catalog.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return row


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", default=None)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    rows = []
    for sid in a.only or cc_ids():
        row = recheck(sid, a.dry_run)
        rows.append(row)
        print(f"{row['id']:<48} {row['before']:>5} -> {row['after']:>5}  (same pitch {row['same_pitch']}, wobbles {row['wobbles']}, bends {row['bends']}; without joining {row['without_joining']})", flush=True)
    if not a.dry_run:
        from .build import write_index
        write_index()
    tb, ta = sum(r["before"] for r in rows), sum(r["after"] for r in rows)
    print(f"{'TOTAL':<48} {tb:>5} -> {ta:>5}  ({(ta - tb) / max(tb, 1):+.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
