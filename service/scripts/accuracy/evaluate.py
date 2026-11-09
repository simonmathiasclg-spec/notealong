"""Score the upload pipeline's notes: Despacito against the sax-cover answer key, and the regression set
(the 11 Creative Commons recordings with human word timings, against CREPE-inside-the-words reference
notes; see notealong/catalog/evaluate.py).

    .venv/bin/python scripts/accuracy/evaluate.py --method current [--json out.json] [--set key=value ...]

Measures (all against the reference notes):
  pitch_acc      share of reference notes found within 100 ms of their start that have the right pitch
  pc_acc         the same, allowing an octave error (the right note name)
  off_gt1        share of those found notes whose pitch is off by more than one semitone
  f1             note F1: same pitch and start within 100 ms (precision and recall reported too)
  onset_med/p90  start error in ms for same-pitch notes matched within 300 ms (median, 90th percentile)
  onset_bias     median signed start error in ms (negative = notes start early)
  dur_err        median relative duration error of matched notes (0.20 = 20 % too long or short)
  sustain        share of reference notes of 0.5 s or longer that one note of the right pitch covers for
                 at least 80 % of their length (a held note shown and played as one note)
  frames         share of the reference notes' time where the shown note has the right pitch
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from notealong.config import CATALOG_DIR, LIBRARY_DIR, STEM_FORMAT  # noqa: E402

DESPACITO = "despacito-ft-daddy-yankee-luisfonsivevo-dec768"
ANSWER_KEY = ROOT.parent / "test-recordings" / f"{DESPACITO}-answer-key.json"
KEYS = ("pitch_acc", "pc_acc", "off_gt1", "precision", "recall", "f1", "f1_pc", "frames_pc", "onset_med", "onset_p90", "onset_bias", "dur_err", "sustain", "frames")


def _greedy(ref, est, tol, same_pitch):
    pairs = []
    for i, r in enumerate(ref):
        for j, e in enumerate(est):
            if e["start"] > r["start"] + tol:
                break
            d = abs(e["start"] - r["start"])
            if d <= tol and (not same_pitch or e["midi"] == r["midi"]):
                pairs.append((d, i, j))
    pairs.sort()
    ur, ue, out = set(), set(), []
    for d, i, j in pairs:
        if i in ur or j in ue:
            continue
        ur.add(i)
        ue.add(j)
        out.append((i, j))
    return out


def metrics(ref: list[dict], est: list[dict], span: tuple[float, float] | None = None) -> dict:
    ref = sorted(ref, key=lambda n: n["start"])
    est = sorted(est, key=lambda n: n["start"])
    if span:
        est = [n for n in est if span[0] - 1.0 <= n["start"] <= span[1] + 1.0]
    on = _greedy(ref, est, 0.10, False)
    good = _greedy(ref, est, 0.10, True)
    good_pc = _greedy([dict(r, midi=r["midi"] % 12) for r in ref], [dict(e, midi=e["midi"] % 12) for e in est], 0.10, True)
    wide = _greedy(ref, est, 0.30, True)
    pitch_ok = [ref[i]["midi"] == est[j]["midi"] for i, j in on]
    off = [abs(ref[i]["midi"] - est[j]["midi"]) > 1 for i, j in on]
    pc_ok = [(ref[i]["midi"] - est[j]["midi"]) % 12 == 0 for i, j in on]
    p = len(good) / max(1, len(est))
    r = len(good) / max(1, len(ref))
    errs = np.array([est[j]["start"] - ref[i]["start"] for i, j in wide]) * 1000 if wide else np.zeros(1)
    durs = [abs((est[j]["end"] - est[j]["start"]) / max(0.05, ref[i]["end"] - ref[i]["start"]) - 1) for i, j in good]
    # sustain: long reference notes covered by one same-pitch note
    long_ref = [n for n in ref if n["end"] - n["start"] >= 0.5]
    held = 0
    for n in long_ref:
        L = n["end"] - n["start"]
        if any(e["midi"] == n["midi"] and min(e["end"], n["end"]) - max(e["start"], n["start"]) >= 0.8 * L for e in est
               if e["start"] < n["end"] and e["end"] > n["start"]):
            held += 1
    # frames: right pitch shown during the reference notes
    tot = ok = ok_pc = 0.0
    for n in ref:
        tot += n["end"] - n["start"]
        for e in est:
            if e["start"] >= n["end"]:
                break
            if e["end"] > n["start"] and e["midi"] == n["midi"]:
                ok += min(e["end"], n["end"]) - max(e["start"], n["start"])
            if e["end"] > n["start"] and (e["midi"] - n["midi"]) % 12 == 0:
                ok_pc += min(e["end"], n["end"]) - max(e["start"], n["start"])
    return {
        "ref": len(ref), "est": len(est),
        "pitch_acc": float(np.mean(pitch_ok)) if pitch_ok else 0.0,
        "pc_acc": float(np.mean(pc_ok)) if pc_ok else 0.0,
        "off_gt1": float(np.mean(off)) if off else 0.0,
        "precision": p, "recall": r, "f1": 2 * p * r / max(1e-9, p + r),
        "f1_pc": 2 * len(good_pc) / max(1, len(est) + len(ref)),
        "onset_med": float(np.median(np.abs(errs))), "onset_p90": float(np.percentile(np.abs(errs), 90)),
        "onset_bias": float(np.median(errs)),
        "dur_err": float(np.median(durs)) if durs else 1.0,
        "sustain": held / max(1, len(long_ref)), "n_long": len(long_ref),
        "frames": ok / max(1e-9, tot),
        "frames_pc": ok_pc / max(1e-9, tot),
    }


# ---- transcription methods ---------------------------------------------------------
def _vocals(song_dir: Path) -> Path:
    return song_dir / "vocals.wav" if (song_dir / "vocals.wav").exists() else song_dir / f"vocals.{STEM_FORMAT}"


def _cached(cache: Path, name: str, make):
    path = cache / name
    if path.exists():
        return json.loads(path.read_text())
    val = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(val))
    return val


def _lyric_words(song: dict) -> tuple[list[dict], list[dict]]:
    words = [dict(w) for w in song.get("words", [])]
    lyric = [dict(l) for l in song.get("lines", []) if l.get("kind", "lyric") == "lyric"]
    remap = {l["index"]: i for i, l in enumerate(lyric)}
    for w in words:
        w["line"] = remap.get(w["line"], 0)
    for i, l in enumerate(lyric):
        l["index"] = i
    return words, lyric


def chain_current(vocals: Path, song: dict, cache: Path, raw_path: Path | None, overrides: dict | None = None) -> list[dict]:
    """The upload pipeline as it is: Basic Pitch raw notes, cleanup, attach (held-note merging)."""
    from notealong.pipeline.attach import attach_notes
    from notealong.pipeline.cleanup import clean_notes
    from notealong.pipeline.melody import detect_notes
    from notealong.pipeline.onsets import Articulation, vocal_envelope
    if raw_path is not None and raw_path.exists():
        raw = json.loads(raw_path.read_text())
    else:
        raw = _cached(cache, "basic_pitch_raw.json", lambda: detect_notes(vocals))
    notes, params = clean_notes(raw, song.get("settings", {}).get("detail_level", "balanced"), overrides, tempo=song.get("tempo_bpm"))
    words, lyric = _lyric_words(song)
    env = _cached(cache, "envelope.json", lambda: vocal_envelope(vocals))
    if words:
        attach_notes(notes, words, lyric, art=Articulation(env), params=params, language=song.get("language", {}).get("detected"), report={})
    return notes


def _pitch(vocals: Path, cache: Path, engine: str):
    import numpy as np  # noqa: F811
    from notealong.pipeline import pitchnotes as pn
    f = cache / f"pitch_{engine}.npz"
    if f.exists():
        z = np.load(f)
        return z["midi"], z["conf"], z["db"]
    if engine == "fcpe":
        midi, conf = pn.track_fcpe(vocals)
    else:
        midi, conf = pn.track_crepe(vocals, engine.split("_")[1])
    db = pn.level_db(vocals, len(midi))
    f.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(f, midi=midi, conf=conf, db=db)
    return midi, conf, db


def _pitch_method(engine: str, attach: bool, use_words: bool = True):
    def fn(vocals: Path, song: dict, cache: Path, raw_path: Path | None, overrides: dict | None = None) -> list[dict]:
        from notealong.pipeline import pitchnotes as pn
        midi, conf, db = _pitch(vocals, cache, engine)
        params = pn.SegParams(**{k: v for k, v in (overrides or {}).items() if k in pn.SegParams.__dataclass_fields__})
        words, lyric = _lyric_words(song)
        from notealong.pipeline.onsets import vocal_envelope
        env = _cached(cache, "envelope.json", lambda: vocal_envelope(vocals))
        notes = pn.notes_from_pitch(midi.copy(), conf, db, params, [w["start"] for w in words] if use_words else None,
                                    onset=np.asarray(env["onset"], dtype=np.float32), onset_hop=env["hop"])
        if attach and words:
            from notealong.pipeline.attach import attach_notes
            from notealong.pipeline.cleanup import params_for, tempo_scaled
            from notealong.pipeline.onsets import Articulation
            for i, nt in enumerate(notes):
                nt["id"] = f"n{i}"
            attach_notes(notes, words, lyric, art=Articulation(env), params=tempo_scaled(params_for("balanced"), song.get("tempo_bpm")),
                         language=song.get("language", {}).get("detected"), report={})
        return notes
    return fn


def _hybrid(engine: str):
    """Basic Pitch's notes (cleanup and attach as now), each note's pitch re-read from the pitch curve."""
    def fn(vocals: Path, song: dict, cache: Path, raw_path: Path | None, overrides: dict | None = None) -> list[dict]:
        notes = chain_current(vocals, song, cache, raw_path, overrides)
        midi, conf, db = _pitch(vocals, cache, engine)
        for nt in notes:
            a, b = int(nt["start"] / 0.01), int(nt["end"] / 0.01)
            L = b - a
            a2, b2 = a + L // 5, b - L // 5
            seg = midi[a2:b2][(conf[a2:b2] >= 0.5) & (midi[a2:b2] > 20)]
            if len(seg) >= max(3, 0.5 * (b2 - a2)):
                nt["midi"] = int(round(float(np.median(seg))))
        return notes
    return fn


def _refined(engine: str):
    """Basic Pitch's notes refined with the pitch curve (pitchnotes.refine_with_pitch)."""
    def fn(vocals: Path, song: dict, cache: Path, raw_path: Path | None, overrides: dict | None = None) -> list[dict]:
        from notealong.pipeline import pitchnotes as pn
        from notealong.pipeline.onsets import Articulation, vocal_envelope
        notes = chain_current(vocals, song, cache, raw_path, overrides)
        midi, conf, db = _pitch(vocals, cache, engine)
        env = _cached(cache, "envelope.json", lambda: vocal_envelope(vocals))
        params = pn.RefineParams(**{k: v for k, v in (overrides or {}).items() if k in pn.RefineParams.__dataclass_fields__})
        notes = pn.refine_with_pitch(notes, midi, conf, db, Articulation(env), params)
        o = overrides or {}
        if o.get("attack_window", 0) > 0:
            notes = pn.align_to_attacks(notes, Articulation(env), float(o["attack_window"]), float(o.get("attack_onset", 0.35)))
        return notes
    return fn


def _backing(vocals: Path) -> Path | None:
    for name in ("backing.mp3", "backing.wav"):
        p = vocals.parent / name
        if p.exists():
            return p
    return None


def _gridded(engine: str):
    """refined, then note starts pulled onto the beat grid of the backing track (beats.py)."""
    base = _refined(engine)

    def fn(vocals: Path, song: dict, cache: Path, raw_path: Path | None, overrides: dict | None = None) -> list[dict]:
        from notealong.pipeline import beats as bt
        notes = base(vocals, song, cache, raw_path, overrides)
        back = _backing(vocals)
        if back is None:
            return notes
        b = _cached(cache, "beats.json", lambda: bt.detect_beats(back))
        o = overrides or {}
        return bt.snap_notes(notes, b["beats"], int(o.get("subdivisions", 4)), float(o.get("snap_tol", 0.04)),
                             float(o.get("snap_frac", 0.3)), bool(o.get("snap_ends", False)))
    return fn


METHODS = {"current": chain_current, "hybrid_crepe": _hybrid("crepe_full"), "hybrid_fcpe": _hybrid("fcpe"), "gridded_fcpe": _gridded("fcpe"),
           "refined_fcpe": _refined("fcpe"), "refined_crepe": _refined("crepe_full"),
           "fcpe": _pitch_method("fcpe", False), "fcpe_attach": _pitch_method("fcpe", True),
           "crepe_tiny": _pitch_method("crepe_tiny", False), "crepe_full": _pitch_method("crepe_full", False),
           "crepe_full_attach": _pitch_method("crepe_full", True)}
CACHE = ROOT.parent / "test-recordings" / "cache"
VOCADITO = ROOT.parent / "test-recordings" / "datasets" / "vocadito"


def vocadito_notes(stem: str, who: str) -> list[dict]:
    """Human note annotations of a Vocadito excerpt (CC BY 4.0): start, pitch in Hz, duration."""
    p = VOCADITO / "Annotations" / "Notes" / f"{stem}_notes{who}.csv"
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        t, hz, dur = (float(x) for x in line.split(",")[:3])
        out.append({"start": t, "end": t + dur, "midi": int(round(69 + 12 * np.log2(hz / 440.0)))})
    return out


def regression_ids() -> list[str]:
    from notealong.catalog.evaluate import reference_ids
    return reference_ids()


def _vc(sid: str, d: Path, vocals_variant: str | None):
    """The method's arguments for one song folder: (vocals, song, cache, raw notes)."""
    song = json.loads((d / "song.json").read_text())
    vocals, raw, cache = _variant(sid, _vocals(d), d / "notes_raw.json", vocals_variant)
    return vocals, song, cache, raw


def _variant(sid: str, default: Path, raw: Path | None, vocals_variant: str | None) -> tuple[Path, Path | None, Path]:
    """(vocals file, raw-notes file or None, cache folder) for a song under a separation variant."""
    if not vocals_variant:
        return default, raw, CACHE / sid
    return CACHE / sid / f"sep_{vocals_variant}" / "vocals.wav", None, CACHE / sid / f"sep_{vocals_variant}"


def run(method: str, overrides: dict | None = None, despacito_only: bool = False, vocals_variant: str | None = None,
        skip_vocadito: bool = False) -> dict:
    from notealong.catalog.evaluate import merge_repeats, reference_notes
    fn = METHODS[method]
    out = {"method": method, "overrides": overrides or {}, "rows": []}
    t0 = time.time()
    # Despacito against the answer key
    if ANSWER_KEY.exists():
        key = json.loads(ANSWER_KEY.read_text())
        d = LIBRARY_DIR / DESPACITO
        song = json.loads((d / "song.json").read_text())
        est = fn(*_vc(DESPACITO, d, vocals_variant), overrides)
        # judge only where the song is sung: from the first real word (the covers also play the guitar intro)
        real = [w for w in song["words"] if len(w["text"].strip(".,!?¡¿'")) >= 2]
        sung = (real[0]["start"] - 0.5, real[-1]["end"] + 0.5) if real else (0, 1e9)
        ref = [n for n in key["notes"] if sung[0] <= n["start"] <= sung[1]]
        span = (ref[0]["start"], ref[-1]["end"])
        full = metrics(ref, est, span=span)
        # pitch and timing are judged on the notes at least three of the four covers play (the singer matches
        # 75-86 % of those, against 62 % of the two-of-four notes); precision and F1 on the full key
        strict = metrics([n for n in ref if n["agreement"] >= 0.75], est, span=span)
        m = dict(strict)
        for k in ("precision", "f1", "f1_pc", "est"):
            m[k] = full[k]
        m["recall_full"] = full["recall"]
        m["id"] = "despacito"
        out["despacito"] = m
        out["despacito_full_key"] = full
    if not despacito_only:
        for sid in regression_ids():
            d = CATALOG_DIR / sid
            song = json.loads((d / "song.json").read_text())
            est = fn(*_vc(sid, d, vocals_variant), overrides)
            ref, _, _ = reference_notes(sid, song["words"])
            ref = merge_repeats(ref)
            spans = [(w["start"] - 0.15, w["end"] + 0.15) for w in song["words"]]
            est = merge_repeats([n for n in est if any(a <= n["start"] <= b for a, b in spans)])
            m = metrics(ref, est)
            m["id"] = sid
            out["rows"].append(m)
        out["regression"] = {k: float(np.mean([r[k] for r in out["rows"]])) for k in KEYS}
        out["vocadito_rows"] = []
        for wav in [] if skip_vocadito else sorted(VOCADITO.glob("Audio/vocadito_*.wav"), key=lambda p: int(p.stem.split("_")[1])):
            ref = vocadito_notes(wav.stem, "A1")
            if not ref:
                continue
            est = fn(wav, {"settings": {}, "words": [], "lines": [], "tempo_bpm": None, "language": {}}, CACHE / wav.stem, None, overrides)
            m = metrics(ref, est, span=(ref[0]["start"], ref[-1]["end"]))
            m["id"] = wav.stem
            out["vocadito_rows"].append(m)
        if out["vocadito_rows"]:
            out["vocadito"] = {k: float(np.mean([r[k] for r in out["vocadito_rows"]])) for k in KEYS}
    out["seconds"] = round(time.time() - t0, 1)
    return out


def fmt(m: dict) -> str:
    return (f"pitch {m['pitch_acc']:.3f} (class {m['pc_acc']:.3f})  off>1 {m['off_gt1']:.3f}  F1 {m['f1']:.3f} (class {m['f1_pc']:.3f})  "
            f"onset {m['onset_med']:.0f}/{m['onset_p90']:.0f} ms bias {m['onset_bias']:+.0f}  dur {m['dur_err']:.2f}  "
            f"sustain {m['sustain']:.2f}  frames {m['frames']:.3f} (class {m['frames_pc']:.3f})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--method", default="current", choices=sorted(METHODS))
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--despacito-only", action="store_true")
    ap.add_argument("--json", type=Path)
    ap.add_argument("--vocals", default=None, help="use another separation's vocals (see separate_variants.py)")
    ap.add_argument("--no-vocadito", action="store_true")
    a = ap.parse_args()
    overrides = {k: (v.lower() == "true" if v.lower() in ("true", "false") else float(v)) for k, v in (s.split("=", 1) for s in a.set)} or None
    res = run(a.method, overrides, a.despacito_only, a.vocals, a.no_vocadito)
    if "despacito" in res:
        d = res["despacito"]
        print(f"DESPACITO ({d['ref']} strict key notes, {d['est']} shown, {d['n_long']} held): {fmt(d)}")
    if "regression" in res:
        for r in res["rows"]:
            print(f"  {r['id'][:40]:<40} {fmt(r)}")
        print(f"REGRESSION mean ({len(res['rows'])} songs): {fmt(res['regression'])}")
    if "vocadito" in res:
        print(f"VOCADITO mean ({len(res['vocadito_rows'])} excerpts, annotator 1): {fmt(res['vocadito'])}")
    if a.json:
        a.json.write_text(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
