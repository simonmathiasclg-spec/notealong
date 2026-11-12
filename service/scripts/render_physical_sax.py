"""Renders a melody on a physical model of a saxophone (a reed driving a tube, after the Synthesis
ToolKit's "Saxofony" by Perry Cook and Gary Scavone), for comparison with the sampled sax.

    .venv/bin/python scripts/render_physical_sax.py <song-id> <out.wav> <from> <to>

Not used by the app: see docs/listening-samples/sax-sound/README.md for how it compares.
"""
import json
import math
import sys
import urllib.request

import numpy as np
import soundfile as sf

SR = 44100


def render(notes: list[dict], start: float, end: float) -> np.ndarray:
    n = int((end - start + 1.5) * SR)
    out = np.zeros(n)
    size = 4096
    d0 = [0.0] * size   # reed to bell and back
    d1 = [0.0] * size   # reed to mouthpiece end
    w = 0
    rng = np.random.default_rng(7)
    noise = rng.uniform(-1, 1, n) * 0.12
    # per sample: target breath pressure and the tube length (pitch) of the note sounding
    breath = np.zeros(n)
    period = np.full(n, SR / 220.0)
    last_end = -1.0
    for note in notes:
        a = int((note["start"] - start) * SR)
        b = int((note["end"] - start) * SR)
        if b <= 0 or a >= n:
            continue
        a = max(a, 0)
        hz = 440.0 * 2 ** ((note["midi"] - 69) / 12)
        period[a:] = SR / hz - 0.5       # the loop filter adds half a sample
        breath[a:b] = 0.62
        if note["start"] - last_end < 0.05 and a > 0:
            breath[max(a - 300, 0):a] = 0.62   # runs on: the breath does not stop
        last_end = note["end"]
    # the player's breath does not switch on and off instantly
    k_up, k_down = 1 - math.exp(-1 / (0.012 * SR)), 1 - math.exp(-1 / (0.03 * SR))
    env = 0.0
    lp_prev = 0.0
    position = 0.2
    vib_phase = 0.0
    held = 0
    for i in range(n):
        target = breath[i]
        env += (target - env) * (k_up if target > env else k_down)
        held = held + 1 if target > 0 else 0
        vib_phase += 2 * math.pi * 5.3 / SR
        vib = math.sin(vib_phase) * 0.03 * min(1.0, max(0.0, (held / SR - 0.4) * 2))
        p = env * (1 + noise[i] + vib)
        total = period[i]
        l0 = (1 - position) * total
        l1 = position * total
        # read both delay lines with linear interpolation
        r = w - l0
        i0 = int(math.floor(r))
        f = r - i0
        x0 = d0[i0 % size] * (1 - f) + d0[(i0 + 1) % size] * f
        r = w - l1
        i1 = int(math.floor(r))
        f = r - i1
        x1 = d1[i1 % size] * (1 - f) + d1[(i1 + 1) % size] * f
        lp = 0.5 * (x0 + lp_prev)
        lp_prev = x0
        temp = -0.95 * lp
        last = temp - x1
        diff = p - last
        reed = 0.7 + 0.3 * diff
        reed = 1.0 if reed > 1 else (-1.0 if reed < -1 else reed)
        d1[w % size] = temp
        d0[w % size] = p - diff * reed - temp
        w += 1
        out[i] = last
    out -= np.mean(out)
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.5


if __name__ == "__main__":
    song, path, start, end = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    info = json.load(urllib.request.urlopen(f"http://localhost:8000/api/songs/{song}"))
    notes = sorted((x for x in info["notes"] if start <= x["start"] < end), key=lambda x: x["start"])
    audio = render(notes, start, end)
    sf.write(path, np.stack([audio, audio], axis=1), SR, subtype="PCM_16")
    print("wrote", path, len(notes), "notes")
