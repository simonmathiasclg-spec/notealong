"""Instrumental hooks: the lead instrument's tune where nobody sings (intro, solo, outro).

The vocal melody comes from the vocals stem. A sax intro or a guitar solo sits in the backing track, so here
the stretches without singing are found, the backing track is listened to with Basic Pitch (which hears
several notes at once), and the top voice that carries on from frame to frame is taken as the lead. That
line then gets the same sax-friendly simplification as the sung melody (saxmelody.py).

The same line also says what to turn down for "Play the hooks yourself": `render_play_along` writes a copy
of the backing track with the lead's harmonics lowered in those stretches.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from .saxmelody import HOP, SaxParams, _runs, sax_notes

HOOKS_VERSION = 1
SR = 22050
LOW, HIGH = 55, 96           # G3 to C7: where a lead instrument plays
MIN_SECTION = 6.0            # a stretch without singing this long may hold a hook
REACH = 11                   # semitones either side of where the line mostly sits
ACT_MIN = 0.3                # Basic Pitch note activation for a pitch to count as sounding


# ------------------------------------------------------------------ where nobody sings

def quiet_sections(voiced: np.ndarray, words: list[dict], duration: float, min_len: float = MIN_SECTION) -> list[dict]:
    """The stretches without singing, as [{"start", "end", "label"}] with label Intro, Solo or Outro.
    `voiced` says per 10 ms frame whether the singer's pitch was heard; words count as singing too."""
    n = max(len(voiced), int(round(duration / HOP)))
    sung = np.zeros(n, bool)
    sung[:len(voiced)] = voiced
    for w in words:
        sung[max(0, int(w["start"] / HOP)):min(n, int(np.ceil(w["end"] / HOP)))] = True
    for a, b in _runs(~sung):                      # a breath is not a break
        if b - a < int(1.0 / HOP) and a > 0 and b < n:
            sung[a:b] = True
    for a, b in _runs(sung):                       # half a second of "voice" on its own is the band leaking
        if b - a < int(0.5 / HOP):
            sung[a:b] = False
    if not sung.any():
        return []
    first, last = int(np.argmax(sung)), n - int(np.argmax(sung[::-1]))
    out = []
    for a, b in _runs(~sung):
        start = a * HOP + (0.25 if a > 0 else 0.0)
        end = min(b * HOP - (0.25 if b < n else 0.0), duration)
        if end - start < min_len:
            continue
        # a word or two before the band comes in ("one, two…") does not make what follows a solo
        label = "Intro" if b <= first or start < 8.0 else "Outro" if a >= last or end > duration - 8.0 else "Solo"
        out.append({"start": round(start, 2), "end": round(end, 2), "label": label})
    return out


# ------------------------------------------------------------------ the lead line

def note_activations(backing: Path, start: float, end: float) -> np.ndarray:
    """Basic Pitch's note activations for a stretch of the backing track: (frames, 88), column 0 = A0."""
    import contextlib
    import io
    import os
    import tempfile

    import librosa
    import soundfile as sf
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    y, _ = librosa.load(str(backing), sr=SR, mono=True, offset=max(0.0, start), duration=max(0.5, end - start))
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp, y, SR)
        with contextlib.redirect_stdout(io.StringIO()):          # the model reports every window it reads
            out, _, _ = predict(tmp, ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3,
                                minimum_note_length=80, melodia_trick=False)
    finally:
        os.unlink(tmp)
    return np.asarray(out["note"], np.float32)


def lead_path(act: np.ndarray, **kw) -> tuple[np.ndarray, np.ndarray]:
    """The lead line through note activations: per frame a MIDI pitch (NaN where no lead sounds) and how
    strongly that pitch sounded. Found twice: the second time only within reach of where the line mostly
    sat the first time, since a hook stays within an octave or so and what lies far outside is the bass or
    an overtone."""
    midi, strength = _path(act, LOW, HIGH, **kw)
    on = ~np.isnan(midi)
    if on.sum() < 20:
        return midi, strength
    centre = float(np.median(midi[on]))
    return _path(act, max(LOW, int(round(centre)) - REACH), min(HIGH, int(round(centre)) + REACH + 1), **kw)


def _path(act: np.ndarray, low: int, high: int, *, up: float = 0.5, jump: float = 0.5, rest: float = 0.25) -> tuple[np.ndarray, np.ndarray]:
    """One pass of `lead_path` over the pitches low..high.

    Among the pitches that sound, the higher one is preferred (the tune is the top voice), a pitch that
    carries on is preferred over a jump, and a silent state takes over where nothing sounds clearly."""
    a = act[:, low - 21:high - 21].T.astype(float)             # (pitch, frame)
    nb, nt = a.shape
    idx = np.arange(nb)
    obs = np.vstack([np.where(a >= ACT_MIN, np.log(a + 0.02) + up * idx[:, None] / 12.0, np.log(0.004)),
                     np.full((1, nt), np.log(rest + 0.02))])
    step = np.full((nb + 1, nb + 1), -1.5)
    step[:nb, :nb] = -jump * np.minimum(np.abs(idx[:, None] - idx[None, :]), 12)
    step[nb, nb] = 0.0
    score = obs[:, 0].copy()
    back = np.zeros((nb + 1, nt), np.int32)
    for t in range(1, nt):
        m = score[None, :] + step
        back[:, t] = m.argmax(1)
        score = m.max(1) + obs[:, t]
    state = np.zeros(nt, np.int32)
    state[-1] = int(score.argmax())
    for t in range(nt - 1, 0, -1):
        state[t - 1] = back[state[t], t]
    on = state < nb
    midi = np.where(on, state + low, np.nan).astype(float)
    strength = np.where(on, a[np.minimum(state, nb - 1), np.arange(nt)], 0.0)
    return midi, strength


def lead_curve(backing: Path, sections: list[dict], duration: float, cache: Path | None = None) -> tuple[np.ndarray, np.ndarray]:
    """The lead instrument's pitch every 10 ms over the whole song (NaN outside the sections and where no
    lead sounds) and its strength (0..1). Cached next to the song, per set of sections."""
    n = int(round(duration / HOP)) + 1
    sig = np.asarray([[s["start"], s["end"]] for s in sections], np.float32).reshape(-1, 2)
    if cache is not None and cache.exists():
        try:
            z = np.load(cache)
            if int(z["version"]) == HOOKS_VERSION and z["sections"].shape == sig.shape and np.allclose(z["sections"], sig) and len(z["midi"]) == n:
                return z["midi"].astype(float), z["strength"].astype(float)
        except Exception:
            pass
    midi = np.full(n, np.nan)
    strength = np.zeros(n)
    for s in sections:
        act = note_activations(backing, s["start"], s["end"])
        if len(act) < 20:
            continue
        m, st = lead_path(act)
        fps = len(act) / max(0.5, s["end"] - s["start"])
        a = int(round(s["start"] / HOP))
        k = min(n - a, int((s["end"] - s["start"]) / HOP))
        src = np.minimum((np.arange(k) * HOP * fps).astype(int), len(m) - 1)
        midi[a:a + k] = m[src]
        strength[a:a + k] = st[src]
    if cache is not None:
        np.savez_compressed(cache, midi=midi.astype(np.float32), strength=strength.astype(np.float32), sections=sig, version=HOOKS_VERSION)
    return midi, strength


# ------------------------------------------------------------------ notes

def hook_notes(midi: np.ndarray, strength: np.ndarray, sections: list[dict], *, beats: list[float] | None = None,
               key: dict | None = None, info: dict | None = None) -> list[dict]:
    """Sax-friendly notes of the lead line, section by section: [{"start", "end", "midi", "confidence",
    "word": None, "hook": label}]. A section where no lead is heard clearly gives no notes."""
    beat = float(np.median(np.diff(beats))) if beats is not None and len(beats) > 3 else 0.5
    while beat > 1.0:
        beat /= 2
    while beat < 0.33:
        beat *= 2
    # a player's simplification: a new note has to be held for about half a beat; quicker runs fold into it
    p = SaxParams(free_hold=float(min(0.3, max(0.16, 0.5 * beat))), free_min=0.14, level_floor_db=200.0)
    out: list[dict] = []
    report = []
    for s in sections:
        a, b = int(round(s["start"] / HOP)), min(len(midi), int(round(s["end"] / HOP)))
        if b - a < 50:
            continue
        m = np.full(len(midi), np.nan)
        m[a:b] = midi[a:b]
        on = ~np.isnan(m)
        share = float(on[a:b].mean())
        mean = float(strength[a:b][on[a:b]].mean()) if on[a:b].any() else 0.0
        entry = {"label": s["label"], "start": s["start"], "end": s["end"], "sounding": round(share, 2), "strength": round(mean, 2), "notes": 0}
        report.append(entry)
        if share < 0.3 or mean < 0.36:
            continue                                   # chords or drums only: nothing to play here
        conf = np.where(on, 1.0, 0.0)
        notes = sax_notes(np.nan_to_num(m), conf, np.where(on, -12.0, -80.0), [], beats=beats, key=key, p=p)
        notes = [n for n in notes if s["start"] - 0.05 <= n["start"] < s["end"]]
        if len(notes) < 4:
            continue
        for n in notes:
            i, j = int(n["start"] / HOP), max(int(n["start"] / HOP) + 1, int(n["end"] / HOP))
            hit = np.abs(m[i:j] - n["midi"]) < 0.5
            st = float(strength[i:j][hit].mean()) if hit.any() else 0.0
            # how sure: how strongly the note sounded, and how much of its length it really was that pitch
            c = n["confidence"] * min(1.0, 0.25 + st / 0.6) * min(1.0, 0.4 + float(hit.mean()) if len(hit) else 0.4)
            out.append({"start": n["start"], "end": min(n["end"], s["end"]), "midi": n["midi"], "confidence": round(float(max(0.05, min(1.0, c))), 3),
                        "word": None, "syl": 0, "edited": False, "hook": s["label"]})
        entry["notes"] = len(notes)
    if info is not None:
        info["sections"] = report
    return out


# ------------------------------------------------------------------ "Play the hooks yourself"

def lead_mask(midi: np.ndarray, sr: int, n_fft: int, hop: int, n_frames: int, *, depth_db: float = -16.0,
              cents: float = 45.0, harmonics: int = 12) -> np.ndarray:
    """Gain per STFT bin and frame (1 = untouched) that lowers the lead line's harmonics."""
    freqs = np.arange(n_fft // 2 + 1) * sr / n_fft
    floor = 10 ** (depth_db / 20)
    gain = np.ones((len(freqs), n_frames), np.float32)
    t = np.minimum(((np.arange(n_frames) * hop / sr) / HOP).astype(int), len(midi) - 1)
    pitch = midi[t]
    ratio = 2 ** (cents / 1200)
    for m in np.unique(pitch[~np.isnan(pitch)]):
        f0 = 440.0 * 2 ** ((m - 69) / 12)
        col = np.ones(len(freqs), np.float32)
        for h in range(1, harmonics + 1):
            f = f0 * h
            if f > 9000:
                break
            lo, hi = np.searchsorted(freqs, f / ratio), np.searchsorted(freqs, f * ratio) + 1
            col[max(0, lo - 1):hi + 1] = np.minimum(col[max(0, lo - 1):hi + 1], (1 + floor) / 2)   # soft edge
            col[lo:hi] = floor
        gain[:, pitch == m] = col[:, None]
    # no clicks: ease in and out over a few frames
    kernel = np.hanning(7)
    kernel /= kernel.sum()
    return np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="same"), 1, gain).astype(np.float32)


def reduce_lead(audio: np.ndarray, sr: int, midi: np.ndarray, **kw) -> np.ndarray:
    """`audio` (channels, samples) with the lead line (`midi` every 10 ms, NaN = leave alone) turned down."""
    import librosa
    n_fft, hop = 4096, 1024
    out = np.empty_like(audio)
    gain = None
    for c in range(audio.shape[0]):
        spec = librosa.stft(audio[c], n_fft=n_fft, hop_length=hop)
        if gain is None:
            gain = lead_mask(midi, sr, n_fft, hop, spec.shape[1], **kw)
        out[c] = librosa.istft(spec * gain, hop_length=hop, length=audio.shape[1])
    return out


def render_play_along(backing: Path, out: Path, midi: np.ndarray, sections: list[dict]) -> Path:
    """A copy of the backing track in which the lead line is turned down inside the hook sections."""
    import soundfile as sf

    from . import audio as audio_mod
    wav = out.with_suffix(".tmp.wav")
    audio_mod.to_wav(backing, wav)
    try:
        y, sr = sf.read(str(wav), dtype="float32", always_2d=True)
        y = y.T.copy()
        for s in sections:
            a = max(0, int((s["start"] - 0.5) * sr))
            b = min(y.shape[1], int((s["end"] + 0.5) * sr))
            if b - a < sr:
                continue
            part = np.full(int((b - a) / sr / HOP) + 2, np.nan)
            i = int(round(a / sr / HOP))
            seg = midi[i:i + len(part)]
            part[:len(seg)] = seg
            fixed = reduce_lead(y[:, a:b], sr, part)
            fade = min(int(0.05 * sr), (b - a) // 4)       # cross-fade into the untouched track
            ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            fixed[:, :fade] = fixed[:, :fade] * ramp + y[:, a:a + fade] * (1 - ramp)
            fixed[:, -fade:] = fixed[:, -fade:] * ramp[::-1] + y[:, b - fade:b] * (1 - ramp[::-1])
            y[:, a:b] = fixed
        audio_mod.write_wav(wav, np.clip(y, -1, 1), sr)
        audio_mod.encode_stem(wav, out)
    finally:
        wav.unlink(missing_ok=True)
    return out
