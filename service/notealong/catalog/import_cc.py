"""Add a Creative Commons recording to the catalog.

    cd service && .venv/bin/python -m notealong.catalog.import_cc \
        --audio ~/Downloads/song.mp3 --id artist-song --title "Song" --artist "Artist" \
        --source-url https://www.jamendo.com/track/123 --licence "CC BY 4.0" \
        --licence-url https://creativecommons.org/licenses/by/4.0/ --genre Pop --language en \
        [--lyrics lyrics.txt] [--words words.csv] [--origin "France"] [--featured] [--attribution "..."]

Only CC0, CC BY and CC BY-SA recordings may be added (no NC / ND). The script runs
the same pipeline as an upload (Demucs → Basic Pitch → cleanup), then reviews
every note against a second pitch tracker and fixes clear mistakes. With
--lyrics (one line per sung line) and --words (CSV: word_start,word_end per word
in lyric order, as in the JamendoLyrics dataset) the hand-made timings are used
instead of Whisper. Writes catalog/<id>/ and rebuilds catalog/catalog.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from ..config import CATALOG_DIR, STEM_FORMAT
from ..pipeline import audio as audio_mod
from ..pipeline.attach import attach_notes
from ..pipeline.cleanup import clean_notes
from ..pipeline.keydetect import detect_key
from ..pipeline.lines import build_lines, lines_from_words
from ..pipeline.lyrics import postprocess_words
from ..pipeline.melody import detect_notes, estimate_tempo
from ..pipeline.romanize import is_latin_script, romanize_words
from ..pipeline.stems import separate
from ..schemas import KeyInfo, Line, Note, SCHEMA_VERSION, Song, StepState, Word
from .build import write_index
from .cover import cover_hues, cover_svg
from .difficulty import rate_difficulty
from .verify import drop_outliers, review_notes

ALLOWED = ("CC0", "CC BY ", "CC BY-SA", "CC-BY", "PUBLIC DOMAIN")


def licence_ok(name: str) -> bool:
    n = name.upper().replace("–", "-")
    if "NC" in n or "ND" in n:
        return False
    return any(n.startswith(a.strip()) or a.strip() in n for a in ALLOWED)


def words_from_annotations(lyrics_path: Path, words_csv: Path) -> list[dict]:
    """JamendoLyrics style: lyrics.txt (lines) + words.csv (word_start,word_end[,line_end])."""
    lines = [l.strip() for l in lyrics_path.read_text(encoding="utf-8").splitlines()]
    tokens: list[tuple[str, int]] = []
    li = 0
    for l in lines:
        if not l:
            continue
        for w in l.split():
            tokens.append((w, li))
        li += 1
    rows = list(csv.DictReader(words_csv.open(encoding="utf-8")))
    if len(rows) != len(tokens):
        raise SystemExit(f"{len(rows)} timed words in {words_csv.name} but {len(tokens)} words in {lyrics_path.name}")
    out = []
    for (text, line), r in zip(tokens, rows):
        out.append({"text": text, "start": float(r["word_start"]), "end": float(r["word_end"]), "line": line, "confidence": 1.0})
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", required=True, type=Path)
    ap.add_argument("--id", required=True, help="song id (lowercase letters, digits, dashes)")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--source-url", required=True)
    ap.add_argument("--licence", required=True, help='e.g. "CC BY 4.0"')
    ap.add_argument("--licence-url", default=None)
    ap.add_argument("--genre", default="Pop")
    ap.add_argument("--language", default="en")
    ap.add_argument("--origin", default="")
    ap.add_argument("--culture", default="")
    ap.add_argument("--year", default=None)
    ap.add_argument("--attribution", default=None)
    ap.add_argument("--tags", default="")
    ap.add_argument("--featured", action="store_true")
    ap.add_argument("--lyrics", type=Path, default=None)
    ap.add_argument("--words", type=Path, default=None)
    ap.add_argument("--detail", default="balanced")
    ap.add_argument("--no-review", action="store_true", help="skip the pYIN note review")
    a = ap.parse_args(argv)

    if not re.fullmatch(r"[a-z0-9-]+", a.id):
        raise SystemExit("--id must be lowercase letters, digits and dashes")
    if not licence_ok(a.licence):
        raise SystemExit(f"Licence '{a.licence}' is not allowed in the catalog (CC0, CC BY, CC BY-SA or public domain only).")
    out = CATALOG_DIR / a.id
    out.mkdir(parents=True, exist_ok=True)
    info = audio_mod.probe(a.audio)
    duration = round(float(info["duration"]), 3)

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        print(f"[{a.id}] separating the vocals (Demucs) …")
        paths = separate(a.audio, work, lambda p: None)
        for stem in ("vocals", "backing"):
            audio_mod.encode_stem(paths[stem], out / f"{stem}.{STEM_FORMAT}")
        vocals_wav = paths["vocals"]
        print(f"[{a.id}] finding the notes …")
        raw = detect_notes(vocals_wav)
        tempo = estimate_tempo(a.audio)
        notes, params = clean_notes(raw, a.detail)
        if not a.no_review:
            print(f"[{a.id}] reviewing {len(notes)} notes against a second pitch tracker …")
            notes, report = review_notes(notes, vocals_wav)
            notes, outliers = drop_outliers(notes)
            report["outliers_dropped"] = outliers
            print(f"[{a.id}] review: {report}")
        else:
            report = {}
        key = detect_key(notes)

        if a.lyrics and a.words:
            print(f"[{a.id}] using the provided word timings")
            words = postprocess_words(words_from_annotations(a.lyrics, a.words))
            # keep the author's line breaks (postprocess_words renumbers ids only)
            raw_words = words_from_annotations(a.lyrics, a.words)
            for w, rw in zip(words, sorted(raw_words, key=lambda w: w["start"])):
                w["line"] = rw["line"]
            lyrics_source = "pasted"
        else:
            print(f"[{a.id}] reading the lyrics (Whisper) …")
            from ..pipeline.lyrics import transcribe
            result = transcribe(vocals_wav, language=a.language or None)
            words = postprocess_words(result.get("words", []))
            build_lines(words, segments=result.get("segments"))
            lyrics_source = "transcribed"
        romanize_words(words, a.language)
        lyric_lines = lines_from_words(words)
        all_lines = attach_notes(notes, words, lyric_lines)

    script = "latin" if is_latin_script(" ".join(w["text"] for w in words)) else "other"
    song = Song(
        schema_version=SCHEMA_VERSION, id=a.id, title=a.title, artist=a.artist, duration=duration, tempo_bpm=tempo,
        created_at=datetime.now(timezone.utc).isoformat(), updated_at=datetime.now(timezone.utc).isoformat(), status="ready",
        source={"kind": "catalog", "origin": "cc", "url": a.source_url, "format": "mp3"},
        files={"original": f"backing.{STEM_FORMAT}", "backing": f"backing.{STEM_FORMAT}", "vocals": f"vocals.{STEM_FORMAT}"},
        key=KeyInfo(**key) if key else None,
        words=[Word(**w) for w in words], lines=[Line(**l) for l in all_lines], notes=[Note(**n) for n in notes],
    )
    song.language.detected = a.language
    song.language.script = script
    song.settings.detail_level = a.detail
    song.settings.cleanup = params.to_dict()
    song.settings.lyrics_source = lyrics_source
    song.steps = {k: StepState(status="done", progress=1.0) for k in ("stems", "melody", "lyrics", "attach")}
    (out / "song.json").write_text(song.model_dump_json(indent=1), encoding="utf-8")
    (out / "cover.svg").write_text(cover_svg(a.id, a.genre, a.title), encoding="utf-8")

    rating, details = rate_difficulty(notes)
    attribution = a.attribution or f'"{a.title}" by {a.artist}, {a.licence}. Source: {a.source_url}'
    meta = {
        "id": a.id, "title": a.title, "artist": a.artist, "origin": a.origin, "culture": a.culture or a.origin, "genre": a.genre,
        "language": a.language, "difficulty": rating, "difficulty_details": details, "duration": duration,
        "key": key["name"] if key else None, "tempo_bpm": tempo, "year": a.year,
        "licence": {"name": a.licence, "url": a.licence_url}, "attribution": attribution,
        "source": {"kind": "cc", "url": a.source_url}, "cover": "cover.svg", "accent_hue": cover_hues(a.id, a.genre)[0],
        "tags": [t.strip() for t in a.tags.split(",") if t.strip()], "featured": a.featured, "beginner": rating == "easy",
        "access": "free", "note_count": len(notes), "word_count": len(words), "review": report,
    }
    (out / "catalog.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    entries = write_index()
    print(f"[{a.id}] done: {rating}, {len(notes)} notes, {len(words)} words, key {meta['key']}; catalog now has {len(entries)} songs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
