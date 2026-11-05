"""Build the sampled instruments for "Hear it played".

    cd service && .venv/bin/python scripts/fetch_instrument_sources.py     # downloads the source recordings (about 300 MB)
    cd service && .venv/bin/python scripts/build_instruments.py            # writes web/public/instruments/

Each source recording is one held note. For every note this script:
  1. trims the silence before the attack,
  2. measures the real pitch (so the player can correct recordings that are a few cents off),
  3. finds a loop in the steady part of the tone, a whole number of periods long, and cross-fades
     the join so the note can be held for any length without a click or a bump,
  4. evens out the loudness and writes a small mono FLAC.
The piano is not looped: it keeps its natural decay.

Sources and licences are listed in catalog/LICENSES.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "models" / "instrument_sources"
OUT = ROOT.parent / "web" / "public" / "instruments"
SR = 32000

# id -> settings. `sustain`: looped while the note is held. `release`: fade when the note ends (seconds).
# `vibrato`: added by the player on long notes only (rate Hz, depth cents, delay s). `tone`: low-pass cutoff (Hz)
# that takes the edge off recordings made at full volume. `level`: makeup gain so instruments sound equally loud.
INSTRUMENTS: dict[str, dict] = {
    "alto_sax":    {"name": "Alto sax", "source": "iowa", "sustain": True, "release": 0.09, "vibrato": [5.2, 14, 0.45], "tone": 6500, "level": 1.0, "step": 3},
    "soprano_sax": {"name": "Soprano sax", "source": "iowa", "sustain": True, "release": 0.08, "vibrato": [5.4, 12, 0.45], "tone": 7000, "level": 0.95, "step": 3},
    "tenor_sax":   {"name": "Tenor sax", "source": "vcsl", "sustain": True, "release": 0.10, "vibrato": [5.0, 14, 0.5], "tone": 6500, "level": 1.0, "step": 4},
    "clarinet":    {"name": "Clarinet", "source": "iowa", "sustain": True, "release": 0.08, "vibrato": [5.0, 5, 0.6], "tone": 7500, "level": 1.0},
    "flute":       {"name": "Flute", "source": "iowa", "sustain": True, "release": 0.10, "vibrato": [5.3, 14, 0.35], "tone": 9000, "level": 1.0},
    "oboe":        {"name": "Oboe", "source": "iowa", "sustain": True, "release": 0.08, "vibrato": [5.4, 10, 0.45], "tone": 8000, "level": 0.9},
    "recorder":    {"name": "Recorder", "source": "vcsl", "sustain": True, "release": 0.07, "vibrato": [5.0, 4, 0.7], "tone": 9000, "level": 0.9},
    "trumpet":     {"name": "Trumpet", "source": "iowa", "sustain": True, "release": 0.08, "vibrato": [5.4, 10, 0.5], "tone": 6500, "level": 0.9, "step": 3},
    "french_horn": {"name": "French horn", "source": "iowa", "sustain": True, "release": 0.12, "vibrato": [5.0, 6, 0.6], "tone": 5000, "level": 1.05},
    "violin":      {"name": "Violin", "source": "vsco", "sustain": True, "release": 0.14, "vibrato": None, "tone": 10000, "level": 1.0},   # recorded with its own vibrato
    "piano":       {"name": "Piano", "source": "vcsl", "sustain": False, "release": 0.30, "vibrato": None, "tone": 12000, "level": 0.65, "length": 4.5, "step": 4},
}
# Instruments without recordings of their own borrow another one.
ALIASES = {
    # A baritone is close to a tenor scaled up by a fifth: the tenor recordings are played a fifth lower.
    "baritone_sax": {"name": "Baritone sax", "from": "tenor_sax", "shift": -7},
    "voice": {"name": "Piano (for singers)", "from": "piano", "shift": 0},
}


def load_mono(path: Path) -> np.ndarray:
    import librosa
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y.astype(np.float64)


def rms_db(x: np.ndarray, win: int = 1024, hop: int = 256) -> np.ndarray:
    n = max(1, 1 + (len(x) - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = x[np.minimum(idx, len(x) - 1)]
    return 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)


def measure_pitch(x: np.ndarray) -> float:
    """Median pitch of the tone as a fractional MIDI number."""
    import librosa
    f0 = librosa.yin(x.astype(np.float32), fmin=45, fmax=2400, sr=SR, frame_length=4096, hop_length=512, trough_threshold=0.15)
    f0 = f0[np.isfinite(f0)]
    f = float(np.median(f0))
    return 69 + 12 * np.log2(f / 440.0)


def find_onset(x: np.ndarray, env: np.ndarray, hop: int = 256) -> int:
    peak = float(env.max())
    first = int(np.argmax(env > peak - 38))
    return max(0, first * hop - int(0.004 * SR))


def make_loop(x: np.ndarray, f0: float, target: float = 1.1, fade: float = 0.12) -> tuple[np.ndarray, int, int, dict]:
    """x starts at the attack. Returns (samples up to the loop end, loop start, loop end, quality)."""
    hop = 256
    env = rms_db(x, hop=hop)
    mid = float(np.median(env[int(len(env) * 0.25):int(len(env) * 0.7)]))
    steady = np.where(env > mid - 3.0)[0]
    a = max(int(0.30 * SR), int(steady[0]) * hop + int(0.08 * SR))
    # the steady part ends where the level last sits within 3 dB of the middle of the note
    b = int(steady[-1]) * hop
    period = SR / f0
    X = int(fade * SR)
    room = b - a - X
    if room < int(0.35 * SR):          # a short note: use what there is
        a = max(int(0.18 * SR), a - int(0.1 * SR))
        X = int(0.06 * SR)
        room = b - a - X
    length = min(target * SR, room * 0.85)
    k = max(4, int(round(length / period)))
    while k > 2 and a + X + int(k * period) + 16 >= b:
        k -= 1
    best = None
    lo = a + X
    # keep the file small: the loop starts within about a second of the attack when the note allows it
    hi = max(lo, min(b - int(k * period) - 8, lo + int(0.9 * SR)))
    cmp_n = int(min(4 * period, 0.02 * SR)) + 8
    half = int(period / 2) + 1
    base_len = int(round(k * period))
    for s in np.unique(np.linspace(lo, hi, num=40).astype(int)):
        if s - cmp_n < 0:
            continue
        u = x[s - cmp_n:s + cmp_n]
        uu = float((u ** 2).sum()) + 1e-12
        # the pitch is never perfectly steady, so the exact length is searched over one whole period
        for dl in range(-half, half + 1):
            e = s + base_len + dl
            if e + cmp_n >= len(x) or e >= b + int(0.05 * SR):
                continue
            v = x[e - cmp_n:e + cmp_n]
            err = float(((u - v) ** 2).sum() / uu)
            i0, i1 = s // hop, min(len(env) - 1, e // hop)
            lev = abs(float(env[i0] - env[i1]))
            wobble = float(env[i0:i1 + 1].std()) if i1 > i0 else 0.0
            cost = err + 0.03 * lev + 0.02 * wobble
            if best is None or cost < best[0]:
                best = (cost, s, e, err, lev)
    if best is None:
        raise RuntimeError("no loop found")
    _, s, e, err, lev = best
    y = x[:e].copy()
    # even out slow level changes inside the loop so repeating it does not pump
    seg = y[s:e]
    w = int(0.06 * SR)
    envl = np.sqrt(np.convolve(seg ** 2, np.ones(w) / w, mode="same") + 1e-12)
    corr = np.clip(np.median(envl) / envl, 10 ** (-3 / 20), 10 ** (3 / 20))
    edge = np.minimum(1, np.minimum(np.arange(len(seg)), np.arange(len(seg))[::-1]) / w)   # leave the ends as they are
    y[s:e] = seg * (1 + (corr - 1) * edge)
    # cross-fade: the last X samples of the loop melt into what came just before the loop start
    X = min(X, s)
    ramp = np.linspace(0, 1, X, endpoint=False)
    y[e - X:e] = y[e - X:e] * (1 - ramp) + y[s - X:s] * ramp
    quality = {"splice_error": round(err, 4), "level_step_db": round(lev, 2), "loop_s": round((e - s) / SR, 3)}
    return y, s, e, quality


def simulate(y: np.ndarray, s: int, e: int, seconds: float = 5.0) -> np.ndarray:
    """What the player produces when the note is held: the attack, then the loop over and over."""
    out = [y[:e]]
    n = e
    while n < seconds * SR:
        out.append(y[s:e])
        n += e - s
    return np.concatenate(out)[: int(seconds * SR)]


def pumping_db(sig: np.ndarray, e: int) -> float:
    """How much the level of a held note moves up and down once it is looping (dB, peak to peak)."""
    w = int(0.05 * SR)
    held = sig[e:]
    if len(held) < 4 * w:
        return 0.0
    env = 10 * np.log10(np.convolve(held ** 2, np.ones(w) / w, mode="valid")[::w // 2] + 1e-12)
    return float(env.max() - env.min())


def click_score(sig: np.ndarray, s: int, e: int) -> float:
    """Largest jump between samples at the loop joins, relative to the usual jumps in the tone (1 = seamless)."""
    d = np.abs(np.diff(sig))
    if e - s < 8:
        return 99.0
    typical = float(np.percentile(d[s:e], 99)) + 1e-9
    joins = [e + i * (e - s) for i in range(int((len(sig) - e) / (e - s)))]
    worst = max((float(d[j - 2:j + 2].max()) for j in joins if 2 <= j < len(d) - 2), default=0.0)
    return worst / typical


def build(only: list[str] | None = None) -> dict:
    manifest: dict = {"version": 1, "sample_rate": SR, "instruments": {}}
    report = []
    for inst, cfg in INSTRUMENTS.items():
        if only and inst not in only:
            continue
        src_dir = SOURCES / inst
        files = sorted(src_dir.glob("*.*"), key=lambda p: int(p.stem))
        if not files:
            print(f"!! no source recordings for {inst} in {src_dir}", file=sys.stderr)
            continue
        out_dir = OUT / inst
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("*.flac"):
            old.unlink()
        zones = []
        prev_midi = None
        for f in files:
            x = load_mono(f)
            env = rms_db(x)
            x = x[find_onset(x, env):]
            pitch = measure_pitch(x[int(0.25 * SR):int(min(len(x), 2.0 * SR))])
            midi = int(round(pitch))
            tune = round((pitch - midi) * 100)
            if cfg.get("step") and prev_midi is not None and midi - prev_midi < cfg["step"]:
                continue
            if not cfg["sustain"]:
                n = int(min(len(x), cfg.get("length", 4.0) * SR))
                y = x[:n].copy()
                fade = int(0.6 * SR)
                y[-fade:] *= np.linspace(1, 0, fade) ** 2
                y *= 10 ** (-3 / 20) / (np.abs(y).max() + 1e-9)
                zone = {"midi": midi, "tune": tune, "file": f"{midi}.flac"}
                q = {"loop_s": 0, "click": 0, "splice_error": 0, "level_step_db": 0, "pumping_db": 0}
            else:
                f0 = 440 * 2 ** ((pitch - 69) / 12)
                y, s, e, q = make_loop(x, f0)
                level = np.sqrt((y[s:e] ** 2).mean())
                y *= 10 ** (-20 / 20) / (level + 1e-9)
                peak = np.abs(y).max()
                if peak > 0.97:
                    y *= 0.97 / peak
                held = simulate(y, s, e)
                q["click"] = round(click_score(held, s, e), 2)
                q["pumping_db"] = round(pumping_db(held, e), 1)
                zone = {"midi": midi, "tune": tune, "file": f"{midi}.flac", "loop": [round(s / SR, 5), round(e / SR, 5)]}
            sf.write(out_dir / zone["file"], y.astype(np.float32), SR, subtype="PCM_16", format="FLAC")
            zones.append(zone)
            prev_midi = midi
            report.append({"instrument": inst, "source": f.name, **zone, **q, "kb": round((out_dir / zone['file']).stat().st_size / 1024)})
            print(f"{inst:<12} {f.name:<10} -> midi {midi} ({tune:+d} cents, {pitch:.2f}) loop {q['loop_s']}s click {q.get('click')} splice {q['splice_error']} pumping {q['pumping_db']} dB, {report[-1]['kb']} KB", flush=True)
        manifest["instruments"][inst] = {"name": cfg["name"], "source": cfg["source"], "sustain": cfg["sustain"], "release": cfg["release"],
                                         "vibrato": cfg["vibrato"], "tone": cfg["tone"], "level": cfg["level"], "zones": zones}
    if not only:
        for alias, a in ALIASES.items():
            manifest["instruments"][alias] = a
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return {"manifest": manifest, "report": report}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append")
    ap.add_argument("--report", type=Path, default=None, help="write the per-note quality report (JSON) here")
    a = ap.parse_args()
    res = build(a.only)
    if a.report:
        a.report.write_text(json.dumps(res["report"], indent=1), encoding="utf-8")
    total = sum(r["kb"] for r in res["report"])
    print(f"{len(res['report'])} notes, {total / 1024:.1f} MB")
