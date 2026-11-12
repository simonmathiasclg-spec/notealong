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
from .attach import attach_notes, with_blocks
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
# The note pipeline's version, stored on each upload (song.quality["pipeline"]). Uploads made with an older
# version are brought up to date in the background (jobs.Upgrader) without losing the user's edits.
# 3: held notes are held across words by default; 4: and kept whole while the voice stays on the pitch;
# 5: the sax-friendly melody (one held note per syllable, in the song's key) is the default;
# 7: melody fix round 2 (words wait for their own note, short landing notes kept, sung timing kept)
PIPELINE_VERSION = 7


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


def harmony(d: Path, song: Song, compute: bool = True) -> dict | None:
    """Beats, chroma and bass of the backing track (cached as harmony.npz): the key, the chords and the beat
    grid all come from it."""
    from . import score
    backing = d / song.files.get("backing", f"backing.{STEM_FORMAT}")
    if not backing.exists() or (not compute and not (d / "harmony.npz").exists()):
        return None
    try:
        return score.song_harmony(backing, d / "harmony.npz", float(song.duration or 0))
    except Exception:
        return None


def sax_melody(d: Path, song: Song, curve, art: Articulation | None) -> tuple[list[dict], dict | None, dict] | None:
    """The sax-friendly notes of an upload (saxmelody.py), its key and what was measured on the way, or None
    when it cannot be worked out. Notes the user fixed by hand are kept."""
    import numpy as np
    from . import saxmelody
    try:
        midi, conf, db = curve
        h = harmony(d, song)
        x = saxmelody.clean_curve(midi, conf, db)
        key = saxmelody.song_key(d, x, saxmelody.tuning_offset(x, saxmelody.smooth_curve(x)), h)
        if key is None and song.key:
            key = song.key.model_dump()
        info: dict = {}
        notes = saxmelody.sax_notes(
            midi, conf, db, [w.model_dump() for w in song.words],
            language=song.language.override or song.language.detected, beats=h["beats"] if h else None,
            onset=np.asarray(art.onset, np.float32) if art is not None else None, onset_hop=art.hop if art is not None else None,
            key=key, keep=[n.model_dump() for n in song.notes if n.edited], info=info)
        return notes, key, info
    except Exception:
        import traceback
        traceback.print_exc()
        return None


def hook_melody(d: Path, song: Song, curve, key: dict | None) -> dict | None:
    """The instrumental hooks of an upload (hooks.py): the lead instrument's notes where nobody sings, and
    the play-along backing track with that instrument turned down. None when it cannot be worked out."""
    import numpy as np
    from . import hooks, saxmelody
    try:
        backing = d / f"backing.{STEM_FORMAT}"
        if not backing.exists():
            return None
        x = saxmelody.clean_curve(*curve)
        sections = hooks.quiet_sections(~np.isnan(x), [w.model_dump() for w in song.words], song.duration)
        if not sections:
            return {"notes": [], "sections": [], "file": None}
        h = harmony(d, song)
        cache = d / "hooks.npz"
        midi, strength = hooks.lead_curve(backing, sections, song.duration, cache=cache)
        info: dict = {}
        notes = hooks.hook_notes(midi, strength, sections, beats=h["beats"] if h else None, key=key, info=info)
        used = [sec for sec, rep in zip(sections, info["sections"]) if rep["notes"]] if len(info["sections"]) == len(sections) else \
               [sec for sec in sections if any(sec["start"] - 0.1 <= n["start"] < sec["end"] for n in notes)]
        target = d / f"backing_hooks.{STEM_FORMAT}"
        if not used:
            target.unlink(missing_ok=True)
            return {"notes": [], "sections": info["sections"], "file": None}
        if not target.exists() or target.stat().st_mtime < max(cache.stat().st_mtime, backing.stat().st_mtime):
            hooks.render_play_along(backing, target, midi, used)
        return {"notes": notes, "sections": info["sections"], "used": used, "file": target.name}
    except Exception:
        import traceback
        traceback.print_exc()
        return None


def add_hooks(notes: list[dict], hook: dict | None, old: list[dict]) -> list[dict]:
    """`notes` with the hook notes added. Stray "sung" notes inside a hook give way to it, notes fixed by
    hand always stay (and keep their place in the hook), and a hook note never overlaps another note."""
    was_hook = {n["id"]: n["hook"] for n in old if n.get("hook") and n.get("edited")}
    for n in notes:
        if n.get("edited") and n.get("id") in was_hook:
            n["hook"] = was_hook[n["id"]]
        elif not n.get("edited"):
            n["hook"] = None
    if not hook or not hook.get("notes"):
        return notes
    spans = [(sec["start"], sec["end"]) for sec in hook["used"]]
    inside = lambda n: any(a - 0.05 <= n["start"] < b for a, b in spans)        # noqa: E731
    kept = [n for n in notes if n.get("edited") or n["word"] is not None or not inside(n)]
    taken = {n.get("id") for n in kept}
    # a hook is written in the octave the tune is sung in, so one octave setting suits the whole song
    sung = [n["midi"] for n in kept if n["word"] is not None]
    fold = {}
    if sung:
        lo, hi = min(sung) - 2, max(sung) + 2
        for a, b in spans:
            part = [n["midi"] for n in hook["notes"] if a - 0.05 <= n["start"] < b]
            fold[(a, b)] = min((-12, 0, 12, -24, 24), key=lambda o: (sum(not lo <= m + o <= hi for m in part), abs(o)))
    k = 0
    for n in hook["notes"]:
        n = dict(n, midi=n["midi"] + next((o for (a, b), o in fold.items() if a - 0.05 <= n["start"] < b), 0))
        if any(o["start"] < n["end"] - 0.02 and o["end"] > n["start"] + 0.02 for o in kept if not o.get("hook") or o.get("edited")):
            continue
        while f"h{k}" in taken:
            k += 1
        taken.add(f"h{k}")
        kept.append(dict(n, id=f"h{k}", line=-1))
    kept.sort(key=lambda n: n["start"])
    return kept


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
    (d / "hooks.npz").unlink(missing_ok=True)
    (d / f"backing_hooks.{STEM_FORMAT}").unlink(missing_ok=True)
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
        pitch_curve(d)                  # the singer's pitch curve: the sax-friendly melody is read from it
    except Exception:
        pass
    progress(0.8)
    harmony(d, library.load_song(song_id))   # beats and chords of the backing, for the key and the beat grid
    progress(0.88)
    library.write_json(d / "notes_raw.json", raw)
    tempo = estimate_tempo(d / library.load_song(song_id).files["original"])
    progress(0.95)

    def upd(s: Song):
        s.tempo_bpm = tempo
    library.update_song(song_id, upd)
    run_cleanup(song_id)


def run_cleanup(song_id: str, detail_level: str | None = None, overrides: dict | None = None,
                progress: Progress = _noop, melody: str | None = None, hooks: bool | None = None) -> None:
    d = library.song_dir(song_id)
    raw = library.read_json(d / "notes_raw.json")
    song = library.load_song(song_id)
    level = detail_level or song.settings.detail_level
    notes, params = clean_notes(raw, level, overrides, tempo=song.tempo_bpm)
    key = detect_key(notes)
    # notes the user fixed by hand stay; fresh notes that overlap them give way
    edited = [n.model_dump() for n in song.notes if n.edited]
    if edited:
        notes = [n for n in notes if not any(e["start"] < n["end"] - 0.02 and e["end"] > n["start"] + 0.02 for e in edited)] + edited
        notes.sort(key=lambda n: n["start"])

    def upd(s: Song):
        s.notes = [Note(**n) for n in notes]
        s.key = KeyInfo(**key) if key else None
        s.settings.detail_level = level
        if melody in ("sax", "detailed"):
            s.settings.melody = melody
        if hooks is not None:
            s.settings.hooks = bool(hooks)
        keep = {k: v for k, v in s.settings.cleanup.items() if k == "hold_across_words"}   # the user's own choice survives
        s.settings.cleanup = {**params.to_dict(), **keep}
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
    song = library.load_song(song_id)
    sax = sax_melody(d, song, curve, art) if curve is not None and song.settings.melody == "sax" else None
    key = sax[1] if sax else None
    if curve is not None and sax is None:
        # the literal transcription gets the same whole-song key
        try:
            from . import saxmelody
            x = saxmelody.clean_curve(*curve)
            key = saxmelody.song_key(d, x, saxmelody.tuning_offset(x, saxmelody.smooth_curve(x)), harmony(d, song))
        except Exception:
            key = None
    hook = hook_melody(d, song, curve, key or (song.key.model_dump() if song.key else None)) \
        if curve is not None and song.settings.hooks else None

    def upd(s: Song):
        if hook and hook.get("file"):
            s.files["backing_hooks"] = hook["file"]
        else:
            s.files.pop("backing_hooks", None)
        if curve is not None:
            s.quality["hooks"] = hook["sections"] if hook else []
        # last time's hook notes are made afresh below; the ones fixed by hand stay
        notes = [n.model_dump() for n in s.notes if not n.hook or n.edited]
        words = [w.model_dump() for w in s.words]
        lyric_lines = [l.model_dump() for l in s.lines if l.kind == "lyric"]
        # words index lyric lines by position; renumber them 0..k before attaching
        remap = {l["index"]: i for i, l in enumerate(lyric_lines)}
        for w in words:
            w["line"] = remap.get(w["line"], 0)
        for i, l in enumerate(lyric_lines):
            l["index"] = i
        if key:
            s.key = KeyInfo(**key)
        if sax is not None:
            fresh, _, info = sax
            line_of = {w["id"]: w["line"] for w in words}
            taken = {n["id"] for n in fresh if n.get("id")}
            k = 0
            for n in fresh:
                if n["word"] not in line_of:
                    n["word"] = None                  # a hand-fixed note whose word is gone
                n["line"] = line_of.get(n["word"], -1)
                if not n.get("id"):
                    while f"n{k}" in taken:
                        k += 1
                    n["id"] = f"n{k}"
                    taken.add(n["id"])
            fresh = add_hooks(fresh, hook, notes)
            all_lines = with_blocks(fresh, words, lyric_lines)
            s.notes = [Note(**{f: v for f, v in n.items() if f in Note.model_fields}) for n in fresh]
            s.words = [Word(**w) for w in words]
            s.lines = [Line(**l) for l in all_lines]
            s.quality["pipeline"] = PIPELINE_VERSION
            s.quality["melody"] = {"method": "sax", **{f: info.get(f) for f in ("tuning", "syllables", "snapped", "wordless")}}
            return
        if curve is not None:
            s.quality["melody"] = {"method": "detailed"}
        all_lines = attach_notes(notes, words, lyric_lines, art=art,
                                 params=tempo_scaled(params_for(s.settings.detail_level), s.tempo_bpm),
                                 language=s.language.override or s.language.detected)
        if curve is not None:
            # the singer's pitch curve corrects each note's pitch, joins a held note the detector chopped
            # up, lets it last as long as the voice holds it, and drops "notes" with no pitch at all
            from .pitchnotes import RefineParams, refine_with_pitch
            across = bool(s.settings.cleanup.get("hold_across_words", True))   # on unless the user switched it off
            notes = refine_with_pitch(notes, *curve, art=art, p=RefineParams(across_words=across))
            s.quality["pipeline"] = PIPELINE_VERSION
            if hook and hook.get("notes"):
                # the lines again, now with the hooks: lyric lines renumbered 0..k, as with_blocks expects
                lyric = [l for l in all_lines if l["kind"] == "lyric"]
                at = {l["index"]: i for i, l in enumerate(lyric)}
                for w in words:
                    w["line"] = at.get(w["line"], 0)
                for n in notes:
                    if n["word"] is not None:
                        n["line"] = at.get(n["line"], 0)
                lyric = [dict(l, index=i) for i, l in enumerate(lyric)]
                notes = add_hooks(notes, hook, [n.model_dump() for n in s.notes])
                all_lines = with_blocks(notes, words, lyric)
        s.notes = [Note(**n) for n in notes]
        s.words = [Word(**w) for w in words]
        s.lines = [Line(**l) for l in all_lines]
    library.update_song(song_id, upd)
    progress(1.0)


def run_upgrade(song_id: str, progress: Progress = _noop) -> None:
    """Brings an upload made with an older pipeline up to date: words spelled out letter by letter are joined
    again, and the notes are refined with the singer's pitch curve. The user's edited notes and words are kept
    (only unedited notes change), and the song is saved once, at the end."""
    from .lyrics import _join_spelled
    song = library.load_song(song_id)
    words = [w.model_dump() for w in song.words]
    joined = _join_spelled([dict(w, confidence=w.get("confidence", 1.0)) for w in words])
    if len(joined) != len(words):
        kept = {w["id"] for w in joined}
        gone = {w["id"]: next(j["id"] for j in joined if j["start"] <= w["start"] <= j["end"]) for w in words if w["id"] not in kept}

        def upd(s: Song):
            s.words = [Word(**{k: v for k, v in w.items() if k in Word.model_fields}) for w in joined]
            for n in s.notes:
                if n.word in gone:
                    n.word = gone[n.word]
        library.update_song(song_id, upd)
    progress(0.3)
    run_attach(song_id)
    progress(1.0)


STEP_FUNCS = {
    "upgrade": run_upgrade,
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
