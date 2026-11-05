"""Build the catalog: catalog/songs/*.song -> catalog/<id>/{song.json, backing.mp3,
vocals.mp3, cover.svg} and catalog/catalog.json (index of every song folder,
hand-authored or imported).

    python -m notealong.catalog.build            # build everything that is out of date
    python -m notealong.catalog.build --force    # rebuild all
    python -m notealong.catalog.build --only happy-birthday
    python -m notealong.catalog.build --index    # only rewrite catalog.json
    python -m notealong.catalog.build --check    # parse every .song and report problems
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from ..config import CATALOG_DIR
from ..schemas import KeyInfo, Line, Note, SCHEMA_VERSION, Song, StepState, Word
from .arrange import Arranger, VOICE_OOHS, FLUTE, CLARINET
from .cover import cover_hues, cover_svg
from .difficulty import rate_difficulty
from .dsl import SongFormatError, SongSpec, load_song_file

SONGS_DIR = CATALOG_DIR / "songs"
INDEX = CATALOG_DIR / "catalog.json"
GUIDE_PROGRAMS = {"ooh": VOICE_OOHS, "flute": FLUTE, "clarinet": CLARINET}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def spec_to_song(spec: SongSpec, arr: Arranger, duration: float) -> Song:
    times = arr.melody_times()
    words: list[Word] = []
    notes: list[Note] = []
    for wi, w in enumerate(spec.words):
        if not w.notes:
            continue
        starts = [times[i][0] for i in w.notes]
        ends = [times[i][1] for i in w.notes]
        # "‿" joins two elided vowels under one note in the source; show a plain space
        words.append(Word(id=f"w{wi}", text=(w.original or w.text).replace("‿", " "), roman=w.text.replace("‿", " ") if w.original else None,
                          start=round(min(starts), 3), end=round(max(ends), 3), line=w.line))
    for ni, (s, e, midi) in enumerate(times):
        if midi < 0:
            continue
        n = spec.melody[ni]
        notes.append(Note(id=f"n{ni}", start=round(s, 3), end=round(e, 3), midi=midi, word=f"w{n.word_index}", line=n.line))
    lines = []
    for li in range(len(spec.lines)):
        ws = [w for w in words if w.line == li]
        if ws:
            lines.append(Line(index=li, kind="lyric", start=min(w.start for w in ws), end=max(w.end for w in ws)))
    m = spec.meta
    # The count-in wants the felt pulse: in 6/8 or 9/8 written in eighths that is the dotted quarter.
    felt_tempo = spec.tempo / 3 if (spec.beat_unit == 8 and spec.beats_per_bar % 3 == 0 and spec.beats_per_bar >= 6) else spec.tempo
    song = Song(
        schema_version=SCHEMA_VERSION, id=spec.id, title=m["title"], artist=m.get("artist", "Traditional"),
        duration=round(duration, 3), tempo_bpm=round(felt_tempo, 1), created_at=now_iso(), updated_at=now_iso(), status="ready",
        source={"kind": "catalog", "origin": "traditional", "format": "mp3"},
        files={"original": "backing.mp3", "backing": "backing.mp3", "vocals": "vocals.mp3"},
        key=KeyInfo(tonic=spec.key_tonic, mode=spec.key_mode, name=spec.key_name, confidence=1.0),
        words=words, lines=lines, notes=notes,
    )
    song.language.detected = m.get("language", "en")
    has_original = any(w.original for w in spec.words)
    song.language.script = "other" if has_original else "latin"
    if has_original:
        song.user.script = "roman"   # most players read the romanized words; the toggle shows the original script
    song.settings.detail_level = "balanced"
    song.settings.lyrics_source = "pasted"
    song.steps = {k: StepState(status="done", progress=1.0) for k in ("stems", "melody", "lyrics", "attach")}
    return song


def catalog_meta(spec: SongSpec, song: Song) -> dict:
    m = spec.meta
    rating, details = rate_difficulty([n.model_dump() for n in song.notes])
    if m.get("difficulty"):
        rating = m["difficulty"].lower()
    tags = [t.strip() for t in m.get("tags", "").split(",") if t.strip()]
    return {
        "id": spec.id, "title": m["title"], "artist": m.get("artist", "Traditional"), "origin": m.get("origin", ""),
        "culture": m.get("culture", m.get("origin", "")), "genre": m.get("genre", "Folk"), "language": m.get("language", "en"),
        "difficulty": rating, "difficulty_details": details, "duration": song.duration, "key": spec.key_name,
        "tempo_bpm": song.tempo_bpm, "year": m.get("year"), "licence": {"name": "Public domain", "url": None},
        "attribution": m.get("attribution", "Traditional; public domain."), "source": {"kind": "traditional", "url": m.get("source_url")},
        "cover": "cover.svg", "accent_hue": cover_hues(spec.id, m.get("genre", "Folk"))[0],
        "tags": tags, "featured": m.get("featured", "").lower() in ("yes", "true", "1"),
        "beginner": m.get("beginner", "").lower() in ("yes", "true", "1") or rating == "easy", "access": "free",
        "note_count": len(song.notes), "word_count": len(song.words),
    }


def build_song(path: Path, force: bool = False, audio: bool = True) -> dict:
    spec = load_song_file(path)
    out = CATALOG_DIR / spec.id
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "catalog.json"
    stale = force or not (out / "song.json").exists() or not (out / "backing.mp3").exists() \
        or (out / "song.json").stat().st_mtime < path.stat().st_mtime
    arr = Arranger(spec)
    duration = arr.total_seconds()
    if stale and audio:
        from .render import render_backing, render_midi
        with tempfile.TemporaryDirectory() as td:
            g = Path(td) / "guide.mid"
            arr.guide(GUIDE_PROGRAMS.get(spec.meta.get("guide", "ooh"), VOICE_OOHS)).write(str(g))
            # the band is mixed part by part (render.py); the quiet guide melody is a single mono track
            parts = render_backing(arr, out / "backing.mp3", duration)
            render_midi(g, out / "vocals.mp3", gain=0.9, fade_out=0.5, duration=duration, bitrate="64k", mono=True)
        (out / "arrangement.json").write_text(json.dumps({"style": arr.style_name, "intro_bars": arr.intro_bars,
            "intro_seconds": round(arr.bar1, 2), "first_note": round(arr.melody_start, 2), "parts": parts}, indent=1), encoding="utf-8")
    song = spec_to_song(spec, arr, duration)
    if stale or not meta_path.exists():
        (out / "song.json").write_text(song.model_dump_json(indent=1), encoding="utf-8")
        (out / "cover.svg").write_text(cover_svg(spec.id, spec.meta.get("genre", "Folk"), spec.meta["title"]), encoding="utf-8")
        meta = catalog_meta(spec, song)
        # the day a song joined the catalog survives rebuilds ("New this week" on Discover)
        previous = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        meta["added"] = previous.get("added") or datetime.now(timezone.utc).date().isoformat()
        meta["popularity"] = previous.get("popularity", 0)
        meta_path.write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    for w in spec.warnings:
        print(f"  warning [{spec.id}]: {w}")
    return json.loads(meta_path.read_text(encoding="utf-8"))


def _build_job(args) -> tuple[str, dict | None, str | None]:
    path, force, audio = args
    try:
        return path.stem, build_song(path, force=force, audio=audio), None
    except Exception as e:   # one bad song must not stop the others
        return path.stem, None, f"{type(e).__name__}: {e}"


def write_index() -> list[dict]:
    entries = []
    for d in sorted(CATALOG_DIR.iterdir()):
        mp = d / "catalog.json"
        if d.is_dir() and mp.exists() and (d / "song.json").exists():
            entries.append(json.loads(mp.read_text(encoding="utf-8")))
    INDEX.write_text(json.dumps({"version": 1, "generated_at": now_iso(), "songs": entries}, indent=1, ensure_ascii=False), encoding="utf-8")
    return entries


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", action="append", help="song id (file stem); may be given several times")
    ap.add_argument("--jobs", type=int, default=1, help="render this many songs at once")
    ap.add_argument("--index", action="store_true", help="only rewrite catalog.json")
    ap.add_argument("--check", action="store_true", help="parse every .song file and report problems, no audio")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--rerate", action="store_true", help="recompute the difficulty of every catalog song from its song.json, then rewrite catalog.json")
    a = ap.parse_args(argv)
    if a.rerate:
        for d in sorted(CATALOG_DIR.iterdir()):
            mp, sp = d / "catalog.json", d / "song.json"
            if d.is_dir() and mp.exists() and sp.exists():
                meta = json.loads(mp.read_text(encoding="utf-8"))
                notes = json.loads(sp.read_text(encoding="utf-8"))["notes"]
                meta["difficulty"], meta["difficulty_details"] = rate_difficulty(notes)
                meta["accent_hue"] = cover_hues(d.name, meta.get("genre", "Folk"))[0]
                meta["beginner"] = meta.get("beginner", False) or meta["difficulty"] == "easy"
                meta["note_count"] = len(notes)
                mp.write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
                print(f"{d.name}: {meta['difficulty']} {meta['difficulty_details']}")
        write_index()
        return 0
    if a.index:
        entries = write_index()
        print(f"catalog.json: {len(entries)} songs")
        return 0
    files = sorted(SONGS_DIR.glob("*.song"))
    if a.only:
        files = [f for f in files if f.stem in a.only]
    bad = 0
    if a.jobs > 1 and not a.check:
        from multiprocessing import Pool
        with Pool(a.jobs) as pool:
            for stem, meta, err in pool.imap_unordered(_build_job, [(f, a.force, not a.no_audio) for f in files]):
                if err:
                    bad += 1
                    print(f"FAIL {stem}: {err}", flush=True)
                else:
                    print(f"built {stem}: {meta['difficulty']}, {meta['duration']:.0f}s, {meta['note_count']} notes", flush=True)
        files = []
    for f in files:
        try:
            if a.check:
                spec = load_song_file(f)
                bars = (spec.melody_beats - spec.pickup) / spec.beats_per_bar
                print(f"ok   {f.stem}: {len(spec.melody)} notes, {len(spec.words)} words, {len(spec.lines)} lines, {bars:.1f} bars")
                for w in spec.warnings:
                    print(f"     warning: {w}")
            else:
                meta = build_song(f, force=a.force, audio=not a.no_audio)
                print(f"built {f.stem}: {meta['difficulty']}, {meta['duration']:.0f}s, {meta['note_count']} notes")
        except SongFormatError as e:
            bad += 1
            print(f"FAIL {f.stem}: {e}")
    if not a.check:
        entries = write_index()
        print(f"catalog.json: {len(entries)} songs")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
