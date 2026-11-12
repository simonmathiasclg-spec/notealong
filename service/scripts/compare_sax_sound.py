"""Measures how close a rendered saxophone line is to real saxophone playing, for comparing sound approaches.

    .venv/bin/python scripts/compare_sax_sound.py --performance <recording[:offset[:seconds]]> --notes <folder of
        real single notes> <render.wav> [...]

Two kinds of real recording are used, because no clean recording of a real player on these exact tunes exists:
  --performance  a real player's cover (the saxophone stem separated from a YouTube cover). The backing leaks
                 into the stem, so only the pitch and loudness of the lead line are measured on it.
  --notes        real single notes played without accompaniment (the MTG Solo Saxophones recordings, which the
                 app's sounds are NOT built from). The tone itself is measured on these.

Measures, on the stretches where one clear note is sounding:
  wander    how far notes sit from exact pitch, in cents (standard deviation between notes); a machine is 0
  drift     how much the pitch moves inside a note, in cents (median of each note's standard deviation)
  vibrato   share of long notes (over half a second) with vibrato, and its width in cents
  dynamics  loudness range between notes in dB (10th to 90th percentile)
  swell     how much the loudness moves inside a note, in dB (median of each note's standard deviation)
  tone      distance of the balance of the first ten harmonics from the real notes, in dB
  attack    time for a note that starts from silence to rise from -20 dB to -3 dB of its level, in ms

For each render it prints the measures, how far each is from the real figure (as a fraction of it, at most 2)
and the mean of those: smaller is closer to a real player.
"""
import argparse
import glob

import librosa
import numpy as np
import torch
import torchcrepe

SR = 22050
MEASURES = ["wander", "drift", "vibrato_share", "vibrato_cents", "dynamics", "swell", "tone", "attack"]
HOP_S = 0.01


def harmonics(y: np.ndarray, midi: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """How the sound's energy is shared among its first ten harmonics (dB), over the frames in `mask`.
    Unlike a plain average spectrum this does not depend on which notes happen to be played."""
    spec = np.abs(librosa.stft(y, n_fft=4096, hop_length=int(SR * HOP_S))) ** 2
    total = np.zeros(10)
    for i in np.nonzero(mask[:spec.shape[1]])[0]:
        hz = librosa.midi_to_hz(midi[i])
        row = np.zeros(10)
        for k in range(10):
            b = int(round((k + 1) * hz * 4096 / SR))
            if b + 2 < spec.shape[0]:
                row[k] = spec[b - 2:b + 3, i].sum()
        if row.sum() > 0:
            total += row / row.sum()
    return 10 * np.log10(total / max(total.sum(), 1e-12) + 1e-6)


def rise_ms(db: np.ndarray, a: int, b: int) -> float | None:
    """Time from -20 dB to -3 dB of the note's level, for a note that starts from quiet (frames of HOP_S)."""
    if a < 8 or db[a - 8:a - 3].max() > np.median(db[a:b]) - 15:
        return None
    level = np.percentile(db[a:b], 80)
    seg = db[a - 8:b]
    lo, hi = np.nonzero(seg >= level - 20)[0], np.nonzero(seg >= level - 3)[0]
    return float((hi[0] - lo[0]) * HOP_S * 1000) if len(lo) and len(hi) and hi[0] >= lo[0] else None


def track(y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pitch (MIDI), how sure the tracker is, and loudness in dB, every 10 ms."""
    y16 = librosa.resample(y, orig_sr=SR, target_sr=16000)
    f0, per = torchcrepe.predict(torch.from_numpy(y16)[None], 16000, hop_length=160, fmin=110.0, fmax=1100.0, model="tiny",
                                 decoder=torchcrepe.decode.weighted_argmax, return_periodicity=True, batch_size=1024, device="cpu")
    per = torchcrepe.filter.median(per, 3)[0].numpy()
    coarse = librosa.hz_to_midi(f0[0].numpy())
    # the tracker says where a clear note is; its pitch comes in steps, so the exact pitch is measured separately
    fine = librosa.hz_to_midi(librosa.yin(y16, fmin=110.0, fmax=1100.0, sr=16000, frame_length=1024, hop_length=160))
    rms = librosa.feature.rms(y=y16, frame_length=640, hop_length=160)[0]
    n = min(len(coarse), len(fine), len(rms))
    per = np.where(np.abs(coarse[:n] - fine[:n]) < 0.6, per[:n], 0.0)
    return fine[:n], per, 20 * np.log10(rms[:n] + 1e-9)


def measure(path: str, offset: float = 0.0, duration: float | None = None, real_tone: np.ndarray | None = None, lead_only: bool = False) -> dict[str, float]:
    y, _ = librosa.load(path, sr=SR, mono=True, offset=offset, duration=duration)
    y = y / (np.max(np.abs(y)) or 1.0)
    midi, per, db = track(y)
    n = len(midi)
    clear = (per > (0.75 if lead_only else 0.5)) & (db > np.max(db) - 30)
    # runs of one note: clear frames whose pitch stays within 0.6 of a semitone of the run so far
    runs, i = [], 0
    while i < n:
        if not clear[i]:
            i += 1
            continue
        j = i + 1
        while j < n and clear[j] and abs(midi[j] - np.median(midi[i:j])) < 0.6:
            j += 1
        if j - i >= 8:
            runs.append((i, j))
        i = j
    in_run = np.zeros(n, bool)
    for a, b in runs:
        in_run[a + 3:b - 2] = True
    wander, drift, swell, vib_has, vib_cents, attacks = [], [], [], [], [], []
    for a, b in runs:
        m = midi[a + 3:b - 2]                     # leave the ends, where the pitch is still arriving
        if len(m) < 4:
            continue
        wander.append((np.median(m) - np.round(np.median(m))) * 100)
        drift.append(np.std(m) * 100)
        swell.append(np.std(db[a + 3:b - 2]))
        if (b - a) * HOP_S >= 0.5:
            seg = (midi[a + 15:b - 2] - np.median(m)) * 100
            seg = seg - np.polyval(np.polyfit(np.arange(len(seg)), seg, 1), np.arange(len(seg)))
            win = np.hanning(len(seg))
            sp = np.abs(np.fft.rfft(seg * win, 2048))
            fr = np.fft.rfftfreq(2048, HOP_S)
            width = 4 * sp[(fr >= 4) & (fr <= 7.5)].max() / win.sum()     # peak to peak
            vib_has.append(width > 12)
            if width > 12:
                vib_cents.append(width)
        r = rise_ms(db, a, b)
        if r is not None:
            attacks.append(r)
    out = {
        "wander": float(np.std(wander)), "drift": float(np.median(drift)),
        "vibrato_share": float(np.mean(vib_has)) if vib_has else 0.0,
        "vibrato_cents": float(np.median(vib_cents)) if vib_cents else 0.0,
        "dynamics": float(np.subtract(*np.percentile([np.median(db[a:b]) for a, b in runs], [90, 10]))),
        "swell": float(np.median(swell)),
        "tone": float("nan") if real_tone is None else float(np.sqrt(np.mean((np.maximum(harmonics(y, midi, in_run), -40) - np.maximum(real_tone, -40)) ** 2))),
        "attack": float(np.median(attacks)) if attacks else float("nan"),
        "notes": len(runs),
    }
    return out


def real_notes(folder: str) -> tuple[np.ndarray, float]:
    """The average spectrum and the typical attack time of real single notes."""
    spectra, attacks = [], []
    for path in sorted(glob.glob(f"{folder}/alt_[pf]_*.flac")):
        y, _ = librosa.load(path, sr=SR, mono=True)
        y = np.concatenate([np.zeros(int(0.15 * SR)), y / (np.max(np.abs(y)) or 1.0)])
        rms = librosa.feature.rms(y=y, frame_length=882, hop_length=int(SR * HOP_S))[0]
        db = 20 * np.log10(rms + 1e-9)
        loud = np.nonzero(db > db.max() - 12)[0]
        pitch = librosa.hz_to_midi(librosa.yin(y, fmin=110.0, fmax=1100.0, sr=SR, frame_length=2048, hop_length=int(SR * HOP_S)))
        m = min(len(pitch), len(db))
        steady = (db[:m] > db.max() - 12) & (np.abs(pitch[:m] - np.median(pitch[:m][db[:m] > db.max() - 12])) < 0.6)
        spectra.append(10 ** (harmonics(y, pitch[:m], steady) / 10))
        r = rise_ms(db, int(loud[0]), int(loud[-1]))
        if r is not None:
            attacks.append(r)
    mean = np.mean(spectra, axis=0)
    return 10 * np.log10(mean / mean.sum()), float(np.median(attacks))


def show(d: dict[str, float]) -> str:
    return ", ".join(f"{k} {v:.2f}" if abs(v) < 1 else f"{k} {v:.1f}" for k, v in d.items())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--performance", action="append", default=[], help="path[:offset[:seconds]] of a real player's line")
    ap.add_argument("--notes", required=True, help="folder of real single notes")
    ap.add_argument("renders", nargs="+")
    args = ap.parse_args()
    tone, attack = real_notes(args.notes)
    real = []
    for spec in args.performance:
        parts = spec.split(":")
        r = measure(parts[0], float(parts[1]) if len(parts) > 1 else 0.0, float(parts[2]) if len(parts) > 2 else None, lead_only=True)
        real.append(r)
        print("real player:", show(r))
    target = {k: float(np.mean([r[k] for r in real])) for k in MEASURES if k not in ("tone", "attack")}
    target["attack"] = attack
    print("real target:", show(target), "(tone is a distance, target 0)")
    for path in args.renders:
        r = measure(path, real_tone=tone)
        dist = {}
        for k in MEASURES:
            if np.isnan(r[k]):
                continue
            if k.startswith("vibrato"):
                continue                      # reported, not scored: the separated stem of the real player is too rough to say how much vibrato there is
            dist[k] = min(2.0, r[k] / 6.0 if k == "tone" else abs(r[k] - target[k]) / max(target[k], 1e-6))
        print(f"{path.split('/')[-1]}: {show(r)}")
        print(f"    distance from real: {show(dist)} | overall {np.mean(list(dist.values())):.2f}")


if __name__ == "__main__":
    main()
