"""Measure the rendered backing tracks: the checks a mixing engineer would do
by ear, done by numbers.

    python -m notealong.catalog.audit                 # every hand-authored song, table to stdout
    python -m notealong.catalog.audit --only danny-boy --json out.json
    python -m notealong.catalog.audit --file some.mp3

Per track: integrated loudness (LUFS), true peak, clipped samples, how the energy is spread over
five frequency bands, the longest silent stretch inside the song, the stereo width, and (for catalog
songs) how long the intro is before the first melody note.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from ..config import CATALOG_DIR
from .render import SR, lufs

BANDS = [("sub", 20, 60), ("bass", 60, 250), ("low-mid", 250, 800), ("presence", 800, 3000), ("air", 3000, 16000)]


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def measure(path: Path) -> dict:
    x = decode(path)
    mono = x.mean(axis=1)
    n = len(mono)
    # true peak: 4x oversampled
    from scipy.signal import resample_poly
    tp = float(np.abs(resample_poly(x[: min(n, SR * 60)], 4, 1, axis=0)).max())
    spec = np.abs(np.fft.rfft(mono * np.hanning(n))) ** 2
    freqs = np.fft.rfftfreq(n, 1 / SR)
    total = spec[(freqs >= 20) & (freqs < 16000)].sum() + 1e-20
    bands = {name: round(100 * float(spec[(freqs >= lo) & (freqs < hi)].sum() / total), 1) for name, lo, hi in BANDS}
    # silence: 200 ms windows below -50 dBFS, ignoring the fade at the very end
    win = int(0.2 * SR)
    m = n // win
    rms = np.sqrt((mono[: m * win].reshape(m, win) ** 2).mean(axis=1))
    db = 20 * np.log10(rms + 1e-9)
    quiet = db < -50
    first = int(np.argmax(~quiet)) if (~quiet).any() else 0
    longest = run = 0
    for q in quiet[first: max(first, m - 10)]:
        run = run + 1 if q else 0
        longest = max(longest, run)
    l, r = x[:, 0], x[:, 1]
    corr = float(np.corrcoef(l, r)[0, 1]) if l.std() > 0 and r.std() > 0 else 1.0
    return {
        "seconds": round(n / SR, 1), "lufs": round(lufs(x), 1), "true_peak_db": round(20 * np.log10(tp + 1e-9), 1),
        "clipped": int((np.abs(x) >= 0.999).sum()), "bands": bands, "first_sound": round(first * 0.2, 1),
        "longest_silence": round(longest * 0.2, 1), "stereo_corr": round(corr, 2),
        "crest_db": round(20 * np.log10(np.abs(mono).max() / (np.sqrt((mono ** 2).mean()) + 1e-9)), 1),
    }


def audit_song(song_id: str) -> dict:
    d = CATALOG_DIR / song_id
    row = {"id": song_id, **measure(d / "backing.mp3")}
    arr = d / "arrangement.json"
    if arr.exists():
        a = json.loads(arr.read_text(encoding="utf-8"))
        row.update({"style": a["style"], "intro_bars": a["intro_bars"], "first_note": a["first_note"], "parts": len(a["parts"])})
    return row


def problems(row: dict) -> list[str]:
    out = []
    if abs(row["lufs"] + 16) > 1.0:
        out.append(f"loudness {row['lufs']} LUFS")
    if row["true_peak_db"] > -0.5:
        out.append(f"true peak {row['true_peak_db']} dB")
    if row["clipped"]:
        out.append(f"{row['clipped']} clipped samples")
    if row["longest_silence"] >= 1.0:
        out.append(f"silent for {row['longest_silence']} s")
    if row["first_sound"] > 0.4:
        out.append(f"starts after {row['first_sound']} s")
    if row["bands"]["bass"] + row["bands"]["sub"] > 75:
        out.append("too much low end")
    if row["bands"]["bass"] + row["bands"]["sub"] < 12:
        out.append("thin low end")
    if "first_note" in row and not (1.8 <= row["first_note"] <= 9.5):
        out.append(f"first melody note at {row['first_note']} s")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append")
    ap.add_argument("--file", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args(argv)
    if a.file:
        print(json.dumps(measure(a.file), indent=1))
        return 0
    ids = a.only or sorted(d.name for d in CATALOG_DIR.iterdir() if (d / "arrangement.json").exists())
    rows = []
    print(f"{'song':<36} {'style':<10} {'LUFS':>6} {'peak':>6} {'sub':>5} {'bass':>5} {'lowmid':>6} {'pres':>5} {'air':>5} {'gap':>4} {'intro':>5} {'width':>5}  problems")
    for sid in ids:
        r = audit_song(sid)
        rows.append(r)
        b = r["bands"]
        print(f"{sid:<36} {r.get('style', ''):<10} {r['lufs']:>6} {r['true_peak_db']:>6} {b['sub']:>5} {b['bass']:>5} {b['low-mid']:>6} {b['presence']:>5} {b['air']:>5} "
              f"{r['longest_silence']:>4} {r.get('first_note', ''):>5} {r['stereo_corr']:>5}  {'; '.join(problems(r))}", flush=True)
    if a.json:
        a.json.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    bad = [r for r in rows if problems(r)]
    print(f"{len(rows)} tracks, {len(bad)} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
