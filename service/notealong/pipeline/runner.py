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
from .cleanup import clean_notes, params_for, tempo_scaled
from .onsets import ENV_VERSION, Articulation, vocal_envelope
from .keydetect import detect_key
from .lines import build_lines, lines_from_words
from .lyrics import postprocess_words, transcribe
from .melody import add_levels, detect_notes, estimate_tempo
from .romanize import is_latin_script, romanize_words
from .stems import leftover_vocal_db, separate

Progress = Callable[[float], None]
STEP_ORDER = ["stems", "melody", "lyrics", "attach"]


def _noop(_: float) -> None:
    pass


def _vocals_source(d: Path) -> Path:
    """Prefer the lossless vocals while it exists, else the encoded stem."""
    wav = d / "vocals.wav"
    return wav if wav.exists() else d / f"vocals.{STEM_FORMAT}"


def articulation(d: Path) -> Articulation | None:
    """Onset and level curves of the vocals stem (cached as envelope.json)."""
    cache = d / "envelope.json"
    try:
        if cache.exists():
            env = library.read_json(cache)
            if env.get("version") == ENV_VERSION:
                return Articulation(env)
        src = _vocals_source(d)
        if not src.exists():
            return None
        env = vocal_envelope(src)
        library.write_json(cache, env)
        return Articulation(env)
    except Exception:
        return None


PITCH_VERSION = 1


def pitch_curve(d: Path, compute: bool = True):
    """The singer's pitch every 10 ms (FCPE) with its confidence and the vocals' level, cached as pitch.npz."""
    import numpy as np
    from . import pitchnotes
    cache = d / "pitch.npz"
    if cache.exists():
        z = np.load(cache)
        if int(z.get("version", 0)) == PITCH_VERSION:
            return z["midi"], z["conf"], z["db"]
    if not compute:
        return None
    src = _vocals_source(d)
    if not src.exists():
        return None
    midi, conf = pitchnotes.track_fcpe(src)
    db = pitchnotes.level_db(src, len(midi))
    np.savez_compressed(cache, midi=midi, conf=conf, db=db, version=PITCH_VERSION)
    return midi, conf, db


def run_stems(song_id: str, progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    song = library.load_song(song_id)
    original = d / song.files["original"]
    paths = separate(original, d, progress)
    try:
        leftover = leftover_vocal_db(paths["vocals"], paths["backing"])
    except Exception:
        leftover = None
    for stem in ("vocals", "backing"):
        audio_mod.encode_stem(paths[stem], d / f"{stem}.{STEM_FORMAT}")
    # remove cached key-shifted renders from a previous run
    for f in d.glob("shift_*"):
        f.unlink()
    (d / "envelope.json").unlink(missing_ok=True)
    (d / "pitch.npz").unlink(missing_ok=True)
    (d / "backing.wav").unlink(missing_ok=True)   # the mp3 is what the player streams

    def upd(s: Song):
        s.files["vocals"] = f"vocals.{STEM_FORMAT}"
        s.files["backing"] = f"backing.{STEM_FORMAT}"
        if leftover is not None:
            s.quality["leftover_vocal_db"] = leftover
    library.update_song(song_id, upd)


def run_melody(song_id: str, progress: Progress = _noop) -> None:
    d = library.song_dir(song_id)
    raw = detect_notes(_vocals_source(d))
    progress(0.7)
    try:
        pitch_curve(d)                  # the singer's pitch curve, used to correct the notes (pitchnotes.py)
    except Exception:
        pass
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
    notes, params = clean_notes(raw, level, overrides, tempo=song.tempo_bpm)
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
    # The words decide which same-pitch notes are one held syllable, so the notes
    # are worked out again from the raw detection now that the words are known
    # (unless some were fixed by hand: those are never thrown away here).
    fresh = None
    raw_path = d / "notes_raw.json"
    if raw_path.exists() and not any(n.edited for n in song.notes):
        fresh, _ = clean_notes(library.read_json(raw_path), song.settings.detail_level, tempo=song.tempo_bpm)

    def upd(s: Song):
        s.words = [Word(**w) for w in words]
        s.lines = [Line(**l) for l in lines_from_words(words)]
        s.language.script = script
        if fresh is not None:
            s.notes = [Note(**n) for n in fresh]
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
    d = library.song_dir(song_id)
    art = articulation(d)
    curve = None
    if not library.is_catalog(song_id):
        try:
            curve = pitch_curve(d)
        except Exception:
            curve = None

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
        all_lines = attach_notes(notes, words, lyric_lines, art=art,
                                 params=tempo_scaled(params_for(s.settings.detail_level), s.tempo_bpm),
                                 language=s.language.override or s.language.detected)
        if curve is not None:
            # the singer's pitch curve corrects each note's pitch, joins a held note the detector chopped
            # up, lets it last as long as the voice holds it, and drops "notes" with no pitch at all
            from .pitchnotes import refine_with_pitch
            notes = refine_with_pitch(notes, *curve, art=art)
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


def run_step_in_child(song_id: str, step: str, params: dict, conn) -> None:
    """Entry point of the child process that runs one step (see jobs.py).
    Sends ("progress", p), then ("done", seconds) or ("error", message)."""
    import os
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ.setdefault(var, "6")       # leave the machine usable while a song processes
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    try:
        last = {"p": -1.0, "t": 0.0}

        def prog(p: float) -> None:
            now = time.time()
            if p - last["p"] >= 0.01 or now - last["t"] > 1.0:
                last["p"], last["t"] = p, now
                try:
                    conn.send(("progress", float(p)))
                except Exception:
                    pass
        secs = run_step(song_id, step, prog, **params)
        conn.send(("done", float(secs)))
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        conn.send(("error", f"{type(e).__name__}: {e}"))
    finally:
        conn.close()
