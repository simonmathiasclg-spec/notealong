"""Orchestrates the pipeline steps on a song folder. Every step can be run
on its own; each reads its inputs from the folder and writes its outputs back."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

from .. import library
from ..config import STEM_FORMAT, WORD_MIN_LEVEL_DB
from ..schemas import KeyInfo, LanguageInfo, Line, Note, Song, StepState, Word
from . import audio as audio_mod
from .align import timed_words_from_pasted
from .attach import attach_notes
from .cleanup import clean_notes
from .keydetect import detect_key
from .lines import build_lines, lines_from_words
from .lyrics import postprocess_words, transcribe
from .melody import add_levels, detect_notes, estimate_tempo
from .romanize import is_latin_script, romanize_words
from .stems import separate

Progress = Callable[[float], None]
STEP_ORDER = ["stems", "melody", "lyrics", "attach"]


def _noop(_: float) -> None:
    pass


def _vocals_source(d: Path) -> Path:
    """Prefer the lossless vocals while it exists, else the encoded stem."""
    wav = d / "vocals.wav"
    return wav if wav.exists() else d / f"vocals.{STEM_FORMAT}"


def run_stems(song_id: str, progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    song = library.load_song(song_id)
    original = d / song.files["original"]
    paths = separate(original, d, progress)
    for stem in ("vocals", "backing"):
        audio_mod.encode_stem(paths[stem], d / f"{stem}.{STEM_FORMAT}")
    # remove cached key-shifted renders from a previous run
    for f in d.glob("shift_*"):
        f.unlink()
    (d / "backing.wav").unlink(missing_ok=True)   # the mp3 is what the player streams

    def upd(s: Song):
        s.files["vocals"] = f"vocals.{STEM_FORMAT}"
        s.files["backing"] = f"backing.{STEM_FORMAT}"
    library.update_song(song_id, upd)


def run_melody(song_id: str, progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    raw = detect_notes(_vocals_source(d))
    progress(0.8)
    library.write_json(d / "notes_raw.json", raw)
    tempo = estimate_tempo(d / library.load_song(song_id).files["original"])
    progress(0.95)

    def upd(s: Song):
        s.tempo_bpm = tempo
    library.update_song(song_id, upd)
    run_cleanup(song_id)


def run_cleanup(song_id: str, detail_level: str | None = None, overrides: dict | None = None,
                progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    raw = library.read_json(d / "notes_raw.json")
    song = library.load_song(song_id)
    level = detail_level or song.settings.detail_level
    notes, params = clean_notes(raw, level, overrides)
    key = detect_key(notes)

    def upd(s: Song):
        s.notes = [Note(**n) for n in notes]
        s.key = KeyInfo(**key) if key else None
        s.settings.detail_level = level
        s.settings.cleanup = params.to_dict()
    library.update_song(song_id, upd)
    run_attach(song_id)
    progress(1.0)


def run_lyrics(song_id: str, language: str | None = None, progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    song = library.load_song(song_id)
    lang = language or song.language.override or None
    result = transcribe(_vocals_source(d), language=lang, progress=progress)
    library.write_json(d / "transcript.json", result)

    def upd(s: Song):
        s.language = LanguageInfo(detected=result.get("language"), override=language or s.language.override,
                                  script="latin")
        s.settings.whisper_model = result.get("model")
    library.update_song(song_id, upd)
    _apply_transcript(song_id)


def _drop_silent_words(words: list[dict], vocals: Path) -> list[dict]:
    """Whisper sometimes invents words over silence or instrument bleed. Words
    where the vocals stem is near-silent are removed."""
    if not words or not vocals.exists():
        return words
    try:
        add_levels(words, vocals)
    except Exception:
        return words
    return [w for w in words if w.get("level_db", 0.0) >= WORD_MIN_LEVEL_DB]


def _apply_transcript(song_id: str) -> None:
    """Words/lines from transcript.json (or the pasted lyrics if present)."""
    d = library.song_dir(song_id)
    song = library.load_song(song_id)
    transcript = library.read_json(d / "transcript.json") if (d / "transcript.json").exists() else {"words": [], "segments": []}
    transcript["words"] = _drop_silent_words(transcript.get("words", []), _vocals_source(d))
    pasted_path = d / "lyrics_pasted.txt"
    if song.settings.lyrics_source == "pasted" and pasted_path.exists():
        words, breaks = timed_words_from_pasted(pasted_path.read_text(encoding="utf-8"),
                                                postprocess_words(transcript["words"]), song.duration)
        words = postprocess_words(words)
        build_lines(words, explicit_breaks=breaks)
    else:
        words = postprocess_words(transcript["words"])
        build_lines(words, segments=transcript.get("segments"))
    lang = song.language.override or song.language.detected
    romanize_words(words, lang)
    text = " ".join(w["text"] for w in words)
    script = "latin" if is_latin_script(text) else "other"

    def upd(s: Song):
        s.words = [Word(**w) for w in words]
        s.lines = [Line(**l) for l in lines_from_words(words)]
        s.language.script = script
    library.update_song(song_id, upd)
    run_attach(song_id)


def run_paste_lyrics(song_id: str, text: str) -> None:
    d = library.song_dir(song_id)
    text = text.strip()

    def upd(s: Song):
        s.settings.lyrics_source = "pasted" if text else "transcribed"
    library.update_song(song_id, upd)
    if text:
        (d / "lyrics_pasted.txt").write_text(text, encoding="utf-8")
    else:
        (d / "lyrics_pasted.txt").unlink(missing_ok=True)
    _apply_transcript(song_id)


def run_attach(song_id: str, progress: Progress = _noop) -> None:
    def upd(s: Song):
        notes = [n.model_dump() for n in s.notes]
        words = [w.model_dump() for w in s.words]
        lyric_lines = [l.model_dump() for l in s.lines if l.kind == "lyric"]
        # words index lyric lines by position; renumber them 0..k before attaching
        remap = {l["index"]: i for i, l in enumerate(lyric_lines)}
        for w in words:
            w["line"] = remap.get(w["line"], 0)
        for i, l in enumerate(lyric_lines):
            l["index"] = i
        all_lines = attach_notes(notes, words, lyric_lines)
        s.notes = [Note(**n) for n in notes]
        s.words = [Word(**w) for w in words]
        s.lines = [Line(**l) for l in all_lines]
    library.update_song(song_id, upd)
    progress(1.0)


STEP_FUNCS = {
    "stems": run_stems,
    "melody": run_melody,
    "cleanup": run_cleanup,
    "lyrics": run_lyrics,
    "attach": run_attach,
}


def run_step(song_id: str, step: str, progress: Progress = _noop, **params) -> None:
    fn = STEP_FUNCS[step]
    t0 = time.time()
    fn(song_id, progress=progress, **params)
    return time.time() - t0
