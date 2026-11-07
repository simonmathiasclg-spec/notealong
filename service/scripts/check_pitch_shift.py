"""Verify that a key change really moves the audio by the asked semitones and leaves the tempo alone.

    .venv/bin/python scripts/check_pitch_shift.py <song_id> [--shifts -3 0 2 5] [--json out.json]

For each shift the stems are fetched from the running service (so the real render-and-cache path
is exercised, and timed), then compared with the unshifted stems:
  * pitch: the time-averaged constant-Q spectrum (3 bins per semitone) of the shifted stem is
    cross-correlated along the frequency axis with the original's; the best lag is the measured shift.
    For the guide vocal (monophonic) a pYIN median f0 ratio is reported too.
  * tempo: durations must match, the onset-strength envelopes must line up at lag 0, and librosa's
    tempo estimate must be the same.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import librosa
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from notealong.pipeline.audio import load_mono  # noqa: E402

API = "http://127.0.0.1:8000"


def fetch(song_id: str, stem: str, shift: int, dst: Path) -> float:
    t0 = time.time()
    url = f"{API}/api/songs/{song_id}/audio/{stem}" + (f"?shift={shift}" if shift else "")
    with urllib.request.urlopen(url) as r:
        dst.write_bytes(r.read())
    return round(time.time() - t0, 2)


def cqt_profile(y: np.ndarray, sr: int) -> np.ndarray:
    y = librosa.effects.harmonic(y[: sr * 90])     # drums are broadband and would swamp the pitched part
    C = np.abs(librosa.cqt(y, sr=sr, fmin=librosa.note_to_hz("C2"), n_bins=36 * 6, bins_per_octave=36, hop_length=1024))
    prof = np.log1p(C).mean(axis=1)
    return prof - prof.mean()


def measured_shift(base: np.ndarray, shifted: np.ndarray, sr: int, max_semis: int = 6) -> float:
    a, b = cqt_profile(base, sr), cqt_profile(shifted, sr)
    best, best_lag = -1e9, 0
    for lag in range(-3 * max_semis, 3 * max_semis + 1):   # lag in CQT bins (3 per semitone)
        if lag >= 0:
            score = float(np.dot(a[: len(a) - lag], b[lag:]))
        else:
            score = float(np.dot(a[-lag:], b[: len(b) + lag]))
        if score > best:
            best, best_lag = score, lag
    return best_lag / 3


def f0_shift(base: np.ndarray, shifted: np.ndarray, sr: int) -> float | None:
    fa, va, _ = librosa.pyin(base, fmin=70, fmax=1000, sr=sr, frame_length=2048)
    fb, vb, _ = librosa.pyin(shifted, fmin=70, fmax=1000, sr=sr, frame_length=2048)
    n = min(len(fa), len(fb))
    m = va[:n] & vb[:n]
    if m.sum() < 50:
        return None
    semis = 12 * np.log2(fb[:n][m] / fa[:n][m])
    return round(float(np.median(semis)), 2)


def tempo_check(base: np.ndarray, shifted: np.ndarray, sr: int) -> dict:
    hop = 512
    oa = librosa.onset.onset_strength(y=base, sr=sr, hop_length=hop)
    ob = librosa.onset.onset_strength(y=shifted, sr=sr, hop_length=hop)
    n = min(len(oa), len(ob))
    oa, ob = oa[:n] - oa[:n].mean(), ob[:n] - ob[:n].mean()
    lags = range(-20, 21)
    xc = [float(np.dot(oa[max(0, l):n + min(0, l)], ob[max(0, -l):n - max(0, l)])) for l in lags]
    best = list(lags)[int(np.argmax(xc))]
    ta = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=oa + oa.min() * -1, sr=sr, hop_length=hop))[0])
    tb = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=ob + ob.min() * -1, sr=sr, hop_length=hop))[0])
    return {"onset_lag_ms": round(best * hop / sr * 1000, 1), "tempo_base": round(ta, 1), "tempo_shifted": round(tb, 1),
            "duration_diff_ms": round((len(shifted) - len(base)) / sr * 1000, 1)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("song_id")
    ap.add_argument("--shifts", type=int, nargs="+", default=[-3, 2, 5])
    ap.add_argument("--json")
    a = ap.parse_args()
    sr = 22050
    rows = []
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        base = {}
        for stem in ("backing", "vocals"):
            p = td / f"{stem}_0.mp3"
            fetch(a.song_id, stem, 0, p)
            base[stem], _ = load_mono(p, sr=sr)
        for shift in a.shifts:
            if shift == 0:
                continue
            row = {"shift": shift}
            for stem in ("backing", "vocals"):
                p = td / f"{stem}_{shift}.mp3"
                first = fetch(a.song_id, stem, shift, p)
                second = fetch(a.song_id, stem, shift, p)
                y, _ = load_mono(p, sr=sr)
                n = min(len(y), len(base[stem]))
                r = {"fetch_first_s": first, "fetch_cached_s": second,
                     "measured_semitones": measured_shift(base[stem][:n], y[:n], sr), **tempo_check(base[stem], y, sr)}
                if stem == "vocals":
                    r["f0_semitones"] = f0_shift(base[stem][:n], y[:n], sr)
                row[stem] = r
                print(f"{a.song_id} {stem:8s} shift {shift:+d}: measured {r['measured_semitones']:+.2f}"
                      + (f" (f0 {r['f0_semitones']:+.2f})" if r.get("f0_semitones") is not None else "")
                      + f", onset lag {r['onset_lag_ms']} ms, tempo {r['tempo_base']} -> {r['tempo_shifted']}, "
                      f"length diff {r['duration_diff_ms']} ms, render {first} s then {second} s cached", flush=True)
            rows.append(row)
    if a.json:
        Path(a.json).write_text(json.dumps({"song": a.song_id, "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
