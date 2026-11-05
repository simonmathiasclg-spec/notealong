"""How accurate are the detected notes?

    python -m notealong.catalog.evaluate                       # the reference songs, current settings
    python -m notealong.catalog.evaluate --detail simple
    python -m notealong.catalog.evaluate --set min_note_len=0.1 --set held_gap=0.2 [--no-tempo]

**The reference.** Nobody has written out these songs' notes by hand, so there is no perfect answer key.
The reference is built from two sources that are independent of the pipeline's note detector:
  - word timings made by people (the JamendoLyrics annotations of the first 11 recordings), and
  - the pitch of the voice measured with CREPE, a different pitch tracker from both Basic Pitch
    (which detects our notes) and pYIN (which reviews them).
Inside every annotated word the CREPE pitch is cut into notes wherever it settles on a new semitone.
That gives reference notes with human-anchored placement and independently measured pitch.

**What is measured** (the usual transcription measures):
  - note precision / recall / F1: a detected note counts when it starts within 100 ms of a reference
    note and has the same pitch
  - onset precision / recall: the same, ignoring pitch
  - onset error: mean distance between matched starts (ms)
  - frame accuracy: share of the sung time where the displayed note is the right pitch
Same-pitch repeats inside one word are merged on both sides before scoring, because the word-level
reference cannot say how many syllables were sung on one pitch.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from ..config import CATALOG_DIR, STEM_FORMAT
from .recheck import CACHE, derive

HOP = 0.01
ONSET_TOL = 0.10


def reference_ids() -> list[str]:
    out = []
    for d in sorted(CATALOG_DIR.iterdir()):
        mp = d / "catalog.json"
        if d.is_dir() and mp.exists():
            m = json.loads(mp.read_text(encoding="utf-8"))
            if m.get("source", {}).get("kind") == "cc" and m.get("lyrics", "annotated") == "annotated":
                out.append(d.name)
    return out


def crepe_track(song_id: str) -> tuple[np.ndarray, np.ndarray]:
    """(midi per 10 ms frame, periodicity per frame) of the vocals stem, cached."""
    cache = CACHE / song_id / "crepe.npz"
    if cache.exists():
        z = np.load(cache)
        return z["midi"], z["periodicity"]
    import torch
    import torchcrepe
    from ..pipeline.audio import load_mono
    y, sr = load_mono(CATALOG_DIR / song_id / f"vocals.{STEM_FORMAT}", sr=16000)
    # CREPE's small model: on a test excerpt it agreed with the full model on 99.3 % of sung frames
    # (within half a semitone) and runs about forty times faster on a laptop CPU.
    f0, per = torchcrepe.predict(torch.from_numpy(y)[None], sr, hop_length=160, fmin=65.0, fmax=1100.0, model="tiny",
                                 decoder=torchcrepe.decode.viterbi, return_periodicity=True, batch_size=1024, device="cpu")
    f0, per = f0[0].cpu().numpy(), per[0].cpu().numpy()
    midi = 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, midi=midi.astype(np.float32), periodicity=per.astype(np.float32))
    return midi, per


def reference_notes(song_id: str, words: list[dict]) -> tuple[list[dict], np.ndarray, np.ndarray]:
    """Reference notes (start, end, midi, word) from CREPE inside the human-timed words."""
    from scipy.signal import medfilt
    midi, per = crepe_track(song_id)
    # the vocals stem is quiet between phrases: a frame only counts as sung when CREPE is confident
    voiced = per >= 0.5
    smooth = medfilt(np.where(voiced, midi, 0), 5)
    notes: list[dict] = []
    for w in words:
        a, b = int(w["start"] / HOP), min(len(midi), int(w["end"] / HOP) + 1)
        if b - a < 6:
            continue
        v = voiced[a:b]
        if v.mean() < 0.4 or v.sum() * HOP < 0.08:
            continue                                         # spoken, whispered or too short to carry a pitch
        cur = None                                           # [start_frame, pitch, frames_off, off_start]
        gap = 0
        for i in range(a, b):
            if not voiced[i]:
                gap += 1
                if cur is not None and gap * HOP > 0.15:
                    notes.append({"start": cur[0] * HOP, "end": (i - gap + 1) * HOP, "midi": cur[1], "word": w["id"]})
                    cur = None
                continue
            gap = 0
            m = smooth[i] if smooth[i] > 0 else midi[i]
            if cur is None:
                seg = midi[i:min(b, i + 8)][voiced[i:min(b, i + 8)]]
                cur = [i, int(round(float(np.median(seg)))), 0, i]
                continue
            if abs(m - cur[1]) > 0.65:
                if cur[2] == 0:
                    cur[3] = i
                cur[2] += 1
                if cur[2] * HOP >= 0.07:                      # the voice has settled somewhere else: a new note
                    notes.append({"start": cur[0] * HOP, "end": cur[3] * HOP, "midi": cur[1], "word": w["id"]})
                    seg = midi[cur[3]:min(b, cur[3] + 10)][voiced[cur[3]:min(b, cur[3] + 10)]]
                    cur = [cur[3], int(round(float(np.median(seg)))), 0, cur[3]]
            else:
                cur[2] = 0
        if cur is not None:
            notes.append({"start": cur[0] * HOP, "end": (b - gap) * HOP, "midi": cur[1], "word": w["id"]})
    notes = [n for n in notes if n["end"] - n["start"] >= 0.06]
    return notes, midi, voiced


def merge_repeats(notes: list[dict], gap: float = 0.25) -> list[dict]:
    out: list[dict] = []
    for n in sorted(notes, key=lambda n: n["start"]):
        if out and out[-1]["midi"] == n["midi"] and out[-1].get("word") == n.get("word") and n.get("word") is not None and n["start"] - out[-1]["end"] <= gap:
            out[-1] = {**out[-1], "end": n["end"]}
        else:
            out.append(dict(n))
    return out


def match(ref: list[dict], est: list[dict], pitch: bool, tol: float = ONSET_TOL) -> list[tuple[int, int]]:
    pairs = []
    for i, r in enumerate(ref):
        for j, e in enumerate(est):
            d = abs(e["start"] - r["start"])
            if d <= tol and (not pitch or e["midi"] == r["midi"]):
                pairs.append((d, i, j))
    pairs.sort()
    used_r, used_e, out = set(), set(), []
    for d, i, j in pairs:
        if i in used_r or j in used_e:
            continue
        used_r.add(i)
        used_e.add(j)
        out.append((i, j))
    return out


def score(song_id: str, est: list[dict], words: list[dict]) -> dict:
    ref, midi, voiced = reference_notes(song_id, words)
    ref = merge_repeats(ref)
    lo, hi = min(w["start"] for w in words), max(w["end"] for w in words)
    word_spans = [(w["start"] - 0.15, w["end"] + 0.15) for w in words]
    # notes far from any annotated word (ad-libs, backing vocals) cannot be judged by this reference
    est = [n for n in est if any(a <= n["start"] <= b for a, b in word_spans)]
    est = merge_repeats(est)
    m = match(ref, est, pitch=True)
    mo = match(ref, est, pitch=False)
    p, r = len(m) / max(1, len(est)), len(m) / max(1, len(ref))
    err = [abs(est[j]["start"] - ref[i]["start"]) for i, j in m]
    # frame accuracy over the sung frames inside the words
    frames = np.zeros(len(midi), dtype=np.int16)
    for n in est:
        frames[int(n["start"] / HOP):int(n["end"] / HOP)] = n["midi"]
    inside = np.zeros(len(midi), dtype=bool)
    for w in words:
        inside[int(w["start"] / HOP):int(w["end"] / HOP)] = True
    sung = inside & voiced
    correct = sung & (np.abs(frames - midi) <= 0.5)
    return {
        "id": song_id, "ref": len(ref), "est": len(est), "precision": p, "recall": r, "f1": 2 * p * r / max(1e-9, p + r),
        "onset_precision": len(mo) / max(1, len(est)), "onset_recall": len(mo) / max(1, len(ref)),
        "onset_error_ms": 1000 * float(np.mean(err)) if err else 0.0,
        "frame_accuracy": float(correct.sum() / max(1, sung.sum())),
    }


def evaluate(detail: str = "balanced", overrides: dict | None = None, tempo_aware: bool = True, ids: list[str] | None = None) -> list[dict]:
    rows = []
    for sid in ids or reference_ids():
        song = json.loads((CATALOG_DIR / sid / "song.json").read_text(encoding="utf-8"))
        notes, _, rep = derive(sid, detail, overrides, tempo=song.get("tempo_bpm") if tempo_aware else None)
        row = score(sid, notes, rep["words"])
        row["tempo"] = song.get("tempo_bpm")
        row["notes_shown"] = len(notes)
        rows.append(row)
    return rows


def summary(rows: list[dict]) -> dict:
    keys = ("precision", "recall", "f1", "onset_precision", "onset_recall", "onset_error_ms", "frame_accuracy")
    return {k: float(np.mean([r[k] for r in rows])) for k in keys}


def print_table(rows: list[dict]) -> None:
    print(f"{'song':<44} {'bpm':>5} {'ref':>4} {'est':>4} {'P':>5} {'R':>5} {'F1':>5} {'onP':>5} {'onR':>5} {'err ms':>6} {'frames':>6}")
    for r in rows:
        print(f"{r['id']:<44} {r['tempo'] or 0:>5.0f} {r['ref']:>4} {r['est']:>4} {r['precision']:>5.2f} {r['recall']:>5.2f} {r['f1']:>5.2f} "
              f"{r['onset_precision']:>5.2f} {r['onset_recall']:>5.2f} {r['onset_error_ms']:>6.0f} {r['frame_accuracy']:>6.2f}")
    s = summary(rows)
    print(f"{'MEAN':<44} {'':>5} {'':>4} {'':>4} {s['precision']:>5.2f} {s['recall']:>5.2f} {s['f1']:>5.2f} {s['onset_precision']:>5.2f} {s['onset_recall']:>5.2f} "
          f"{s['onset_error_ms']:>6.0f} {s['frame_accuracy']:>6.2f}")


# Candidate settings for the "balanced" level, tried by --tune. Each is a change to one or two thresholds.
CANDIDATES: list[tuple[str, dict, bool]] = [
    ("fixed thresholds (before)", {}, False),
    ("tempo-aware thresholds", {}, True),
    ("tempo-aware, shorter notes kept (min 0.10 s)", {"min_note_len": 0.10}, True),
    ("tempo-aware, longer notes only (min 0.14 s)", {"min_note_len": 0.14}, True),
    ("tempo-aware, quieter notes kept (confidence 0.30)", {"min_confidence": 0.30}, True),
    ("tempo-aware, quieter notes dropped (confidence 0.40)", {"min_confidence": 0.40}, True),
    ("tempo-aware, stickier lead line (continuity 0.30)", {"continuity_bonus": 0.30}, True),
    ("tempo-aware, freer lead line (continuity 0.12)", {"continuity_bonus": 0.12}, True),
    ("tempo-aware, weaker notes kept (relative 0.22)", {"min_relative_amp": 0.22}, True),
    ("tempo-aware, held notes joined across longer gaps (0.22 s)", {"held_gap": 0.22}, True),
    ("tempo-aware, held notes joined only when touching (0.06 s)", {"held_gap": 0.06}, True),
    ("tempo-aware, scoops and tails kept (bend 0)", {"bend_len": 0.0, "wobble_len": 0.0}, True),
]


def tune(out: Path | None = None) -> list[dict]:
    import torch
    torch.set_num_threads(3)
    results = []
    for name, overrides, tempo in CANDIDATES:
        rows = evaluate("balanced", overrides or None, tempo)
        s = summary(rows)
        fast = [r for r in rows if (r["tempo"] or 0) >= 120]
        s_fast = summary(fast) if fast else {}
        results.append({"name": name, "overrides": overrides, "tempo_aware": tempo, "mean": s, "fast": s_fast,
                        "notes_shown": sum(r["notes_shown"] for r in rows), "rows": rows})
        print(f"{name:<58} F1 {s['f1']:.3f}  P {s['precision']:.3f}  R {s['recall']:.3f}  onset R {s['onset_recall']:.3f}  err {s['onset_error_ms']:.0f} ms  "
              f"frames {s['frame_accuracy']:.3f}  fast songs F1 {s_fast.get('f1', 0):.3f} ({len(fast)})  notes {results[-1]['notes_shown']}", flush=True)
        if out:
            out.write_text(json.dumps(results, indent=1), encoding="utf-8")
    return results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--detail", default="balanced")
    ap.add_argument("--set", action="append", default=[], help="override a cleanup threshold, e.g. min_note_len=0.1")
    ap.add_argument("--no-tempo", action="store_true", help="switch the tempo-aware thresholds off")
    ap.add_argument("--only", action="append")
    ap.add_argument("--json", type=Path)
    ap.add_argument("--tune", action="store_true", help="try the candidate settings in CANDIDATES and print one line each")
    a = ap.parse_args(argv)
    if a.tune:
        tune(a.json)
        return 0
    overrides = {k: float(v) for k, v in (s.split("=", 1) for s in a.set)}
    rows = evaluate(a.detail, overrides or None, not a.no_tempo, a.only)
    print_table(rows)
    if a.json:
        a.json.write_text(json.dumps({"rows": rows, "mean": summary(rows)}, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
