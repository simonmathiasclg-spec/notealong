"""Notes from the singer's pitch curve.

Basic Pitch (melody.py) is a general note detector. This module takes the other route: measure the voice's
pitch every 10 ms with a pitch tracker made for singing, then cut that curve into notes the way a player
hears them:
  * a note starts where the voice attacks, settles on a new semitone, or re-attacks the same pitch
    (a level dip and rise: a new syllable on the same note);
  * vibrato, a scoop up into a note, a fall at its end and small wobbles stay inside one note;
  * a note's pitch is the median of its stable middle, never the scoop;
  * a held note lasts as long as the voice holds the pitch, and runs straight into the next note when the
    singer goes on without a break (legato).

Pitch trackers (all usable in a paid product): FCPE (MIT, weights in the torchfcpe package) and CREPE
(MIT, torchcrepe). See docs/ACCURACY_REPORT.md for how they compare.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np

HOP = 0.01   # seconds per pitch frame


@dataclass
class SegParams:
    min_conf: float = 0.5          # pitch-tracker confidence for a frame to count as sung
    min_level_db: float = -38.0    # below the stem's loud level by more than this: not sung (bleed, breath)
    smooth_frames: int = 15        # running median that takes vibrato out before deciding on semitones
    settle_frames: int = 5         # a new semitone must hold this long (50 ms) to start a new note
    reattack_db: float = 6.0       # a level dip of this much followed by a rise: a new syllable on the same pitch
    onset_min: float = 0.6         # a spectral-flux onset this strong (1.0 = a typical strong attack) starts a new syllable
    min_note: float = 0.08         # shorter notes are absorbed by a neighbour
    legato_gap: float = 0.06       # gaps shorter than this between notes are closed (the singer goes straight on)
    bridge_unvoiced: float = 0.015 # only single-frame dropouts of the pitch tracker are bridged: a real gap is a consonant
    octave_fix: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


# ---- pitch tracking ---------------------------------------------------------------
def _device() -> str:
    from .stems import _pick_device
    return _pick_device()


def track_fcpe(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """(midi, confidence) per 10 ms with FCPE. FCPE gives no probability; a frame is confident (1) when it
    finds a pitch and 0 when it calls the frame unvoiced."""
    import torch
    from torchfcpe import spawn_bundled_infer_model
    from .audio import load_mono
    y, sr = load_mono(path, sr=16000)
    peak = float(np.abs(y).max()) or 1.0
    y = y / max(1.0, peak)                    # FCPE expects audio within [-1, 1]
    dev = _device()
    model = spawn_bundled_infer_model(device=dev)
    n_frames = int(np.ceil(len(y) / (sr * HOP)))
    out = []
    chunk = sr * 30
    for i in range(0, len(y), chunk):
        seg = torch.from_numpy(y[i:i + chunk].copy()).float()[None, :, None].to(dev)
        frames = int(np.ceil(seg.shape[1] / (sr * HOP)))
        with torch.no_grad():
            f0 = model.infer(seg, sr=sr, decoder_mode="local_argmax", threshold=0.006, f0_min=65, f0_max=1100,
                             interp_uv=False, output_interp_target_length=frames)
        out.append(f0.squeeze().detach().cpu().numpy().reshape(-1)[:frames])
    f0 = np.concatenate(out)[:n_frames]
    conf = (f0 > 0).astype(np.float32)
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), 0.0)
    return midi.astype(np.float32), conf


def track_crepe(path: Path, model: str = "tiny") -> tuple[np.ndarray, np.ndarray]:
    """(midi, periodicity) per 10 ms with CREPE, in 30 s chunks."""
    import torch
    import torchcrepe
    from .audio import load_mono
    y, sr = load_mono(path, sr=16000)
    dev = _device() if model == "full" else "cpu"
    mids, pers = [], []
    step = sr * 30
    for i in range(0, len(y), step):
        seg = torch.from_numpy(y[i:i + step].copy())[None]
        with torch.no_grad():
            f0, per = torchcrepe.predict(seg, sr, hop_length=160, fmin=65, fmax=1100, model=model, decoder=torchcrepe.decode.viterbi,
                                         return_periodicity=True, batch_size=256, device=dev)
        per = torchcrepe.filter.median(per, 3)
        n = int(np.ceil(min(step, len(y) - i) / 160))
        mids.append((69 + 12 * np.log2(np.maximum(f0[0].cpu().numpy(), 1e-6) / 440.0))[:n])
        pers.append(per[0].cpu().numpy()[:n])
    return np.concatenate(mids).astype(np.float32), np.concatenate(pers).astype(np.float32)


def level_db(path: Path, n_frames: int | None = None) -> np.ndarray:
    """Level of the vocals per 10 ms frame, in dB."""
    from .audio import load_mono
    y, sr = load_mono(path, sr=16000)
    hop = int(sr * HOP)
    n = n_frames or int(np.ceil(len(y) / hop))
    y = np.pad(y, (0, max(0, n * hop - len(y))))[: n * hop]
    rms = np.sqrt(np.mean(y.reshape(n, hop) ** 2, axis=1) + 1e-12)
    return (20 * np.log10(rms + 1e-9)).astype(np.float32)


# ---- segmentation -----------------------------------------------------------------
def _running_median(x: np.ndarray, mask: np.ndarray, w: int) -> np.ndarray:
    """Median of the voiced frames in a window of w frames around each frame (unvoiced frames ignored)."""
    out = np.zeros_like(x)
    h = w // 2
    idx = np.flatnonzero(mask)
    for i in idx:
        a, b = max(0, i - h), min(len(x), i + h + 1)
        v = x[a:b][mask[a:b]]
        out[i] = np.median(v) if len(v) else x[i]
    return out


def notes_from_pitch(midi: np.ndarray, conf: np.ndarray, db: np.ndarray, p: SegParams | None = None,
                     word_starts: list[float] | None = None, onset: np.ndarray | None = None, onset_hop: float | None = None) -> list[dict]:
    p = p or SegParams()
    n = min(len(midi), len(conf), len(db))
    midi, conf, db = midi[:n], conf[:n], db[:n]
    loud = np.percentile(db[conf >= p.min_conf], 95) if (conf >= p.min_conf).any() else db.max()
    voiced = (conf >= p.min_conf) & (db >= loud + p.min_level_db) & (midi > 20)
    # close tiny unvoiced holes (consonants) so a sung syllable stays one run
    bridge = int(round(p.bridge_unvoiced / HOP))
    v = voiced.copy()
    i = 0
    while i < n:
        if not v[i]:
            j = i
            while j < n and not v[j]:
                j += 1
            if 0 < i and j < n and j - i <= bridge and abs(midi[i - 1] - midi[j]) < 1.5:
                v[i:j] = True
                midi[i:j] = np.linspace(midi[i - 1], midi[j], j - i + 2)[1:-1]
            i = j
        else:
            i += 1
    voiced = v
    centre = _running_median(midi, voiced, p.smooth_frames)          # vibrato and wobbles taken out
    semis = np.round(centre).astype(int)
    # level dips: a re-attack inside a voiced run
    from scipy.ndimage import minimum_filter1d
    dips = np.zeros(n, dtype=bool)
    lo = minimum_filter1d(db, 9)
    for i in range(6, n - 3):
        if voiced[i] and db[i + 2] - lo[i] >= p.reattack_db and db[i - 6:i].max() - lo[i] >= p.reattack_db and lo[i] == db[i]:
            dips[i] = True
    word_frames = set(int(round(t / HOP)) for t in (word_starts or []))
    # spectral-flux onset peaks (consonants, fresh attacks), resampled to the pitch frames
    if onset is not None and onset_hop:
        from scipy.signal import find_peaks
        peaks, _ = find_peaks(onset, height=p.onset_min, distance=max(1, int(p.min_note / onset_hop)))
        for k in peaks:
            f = int(round(k * onset_hop / HOP))
            if 0 < f < n:
                dips[f] = True

    segs: list[list[int]] = []         # [start_frame, end_frame_exclusive, semitone]
    i = 0
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        start = i
        cur = semis[i]
        j = i + 1
        while j < n and voiced[j]:
            change = semis[j] != cur and np.all(semis[j:j + p.settle_frames] == semis[j]) and j + p.settle_frames <= n
            reattack = dips[j] and j - start >= int(p.min_note / HOP)
            word = j in word_frames and (dips[j - 2:j + 3].any()) and j - start >= int(p.min_note / HOP)
            if change or reattack or word:
                # a legato move: the boundary sits where the pitch crosses half way between the two notes
                if change:
                    mid = (cur + semis[j]) / 2.0
                    k = j
                    while k > start + 1 and (midi[k - 1] - mid) * (semis[j] - cur) > 0:
                        k -= 1
                    cut = max(start + 1, min(j, k))
                else:
                    cut = j
                segs.append([start, cut, cur])
                start = cut
                cur = semis[j]
            j += 1
        segs.append([start, j, cur])
        i = j

    # each note's pitch: median of its stable middle (the scoop in and the fall out left aside)
    notes = []
    for a, b, _ in segs:
        L = b - a
        core = midi[a + L // 5: b - L // 5] if L >= 5 else midi[a:b]
        core = core[core > 20]
        if not len(core):
            continue
        notes.append({"start": a * HOP, "end": b * HOP, "midi": int(round(float(np.median(core)))),
                      "confidence": float(np.mean(conf[a:b])), "level_db": float(np.mean(db[a:b]))})
    # short notes join a neighbour: the one with the same or nearest pitch that touches them
    changed = True
    while changed:
        changed = False
        for k, nt in enumerate(notes):
            if nt["end"] - nt["start"] >= p.min_note:
                continue
            prev = notes[k - 1] if k > 0 and nt["start"] - notes[k - 1]["end"] < 0.02 else None
            nxt = notes[k + 1] if k + 1 < len(notes) and notes[k + 1]["start"] - nt["end"] < 0.02 else None
            target = None
            if prev and nxt:
                target = prev if abs(prev["midi"] - nt["midi"]) <= abs(nxt["midi"] - nt["midi"]) else nxt
            else:
                target = prev or nxt
            if target is None:
                del notes[k]
            elif target is prev:
                prev["end"] = nt["end"]
                del notes[k]
            else:
                nxt["start"] = nt["start"]
                del notes[k]
            changed = True
            break
    # same pitch either side of a tiny gap with no re-attack: one held note
    merged: list[dict] = []
    for nt in notes:
        if merged and merged[-1]["midi"] == nt["midi"] and nt["start"] - merged[-1]["end"] <= p.bridge_unvoiced:
            merged[-1]["end"] = nt["end"]
        else:
            merged.append(nt)
    notes = merged
    # octave slips: a note an octave away from both neighbours, which agree with each other
    if p.octave_fix:
        for k in range(1, len(notes) - 1):
            a, b, c = notes[k - 1]["midi"], notes[k]["midi"], notes[k + 1]["midi"]
            for sh in (12, -12):
                if abs(b + sh - a) <= 4 and abs(b + sh - c) <= 4 and abs(b - a) >= 8 and abs(b - c) >= 8:
                    notes[k]["midi"] = b + sh
    # legato: close small gaps
    for a, b in zip(notes, notes[1:]):
        if 0 < b["start"] - a["end"] <= p.legato_gap:
            a["end"] = b["start"]
    for k, nt in enumerate(notes):
        nt["start"] = round(nt["start"], 3)
        nt["end"] = round(nt["end"], 3)
    return notes


# ---- refining detected notes with the pitch curve ----------------------------------
@dataclass
class RefineParams:
    min_conf: float = 0.5            # pitch-curve frames below this confidence are not trusted
    repitch_min_voiced: float = 0.5  # re-read a note's pitch only when this share of its middle is pitched
    drop_unvoiced: float = 0.25      # a note whose span is pitched less than this share is not sung: dropped
    merge_gap: float = 0.10          # same-pitch notes this close are one held note unless re-attacked
    onset_min: float = 0.6           # spectral-flux onset this strong at the junction: a re-attack (keep apart)
    dip_db: float = 6.0              # level dip this deep at the junction: a re-attack
    extend_max: float = 1.5          # a held note may grow by at most this much while the voice holds its pitch
    hold_tol: float = 0.6            # semitones: the voice still holds the note's pitch within this
    across_words: bool = False       # join the same pitch across a word boundary too, when nothing is re-attacked:
    across_onset: float = 0.3        #   the onset at the junction is below this (a vowel carried into the next word)
    across_dip: float = 3.0          #   and the level dips by less than this

    def to_dict(self) -> dict:
        return asdict(self)


def refine_with_pitch(notes: list[dict], midi: np.ndarray, conf: np.ndarray, db: np.ndarray, art=None,
                      p: RefineParams | None = None, report: dict | None = None) -> list[dict]:
    """Corrects notes found by the note detector with the singer's pitch curve (10 ms frames)."""
    p = p or RefineParams()
    rep = report if report is not None else {}
    rep.update({"repitched": 0, "dropped_unpitched": 0, "merged_held": 0, "extended": 0})
    n = len(midi)
    ok = (conf >= p.min_conf) & (midi > 20)
    out = []
    for nt in sorted(notes, key=lambda x: x["start"]):
        if nt.get("edited"):
            out.append(nt)
            continue
        a, b = int(nt["start"] / HOP), min(n, int(nt["end"] / HOP))
        if b <= a:
            out.append(nt)
            continue
        if ok[a:b].mean() < p.drop_unvoiced:
            rep["dropped_unpitched"] += 1
            continue
        L = b - a
        a2, b2 = a + L // 5, b - L // 5
        seg = midi[a2:b2][ok[a2:b2]]
        if len(seg) >= max(3, p.repitch_min_voiced * (b2 - a2)):
            new = int(round(float(np.median(seg))))
            if new != nt["midi"]:
                rep["repitched"] += 1
                nt = dict(nt, midi=new)
        out.append(nt)
    # one held note: same pitch either side of a short gap, with no re-attack in between
    merged: list[dict] = []
    for nt in out:
        prev = merged[-1] if merged else None
        if (prev is not None and prev["midi"] == nt["midi"] and not prev.get("edited") and not nt.get("edited")
                and nt["start"] - prev["end"] <= p.merge_gap):
            same_word = prev.get("word", nt.get("word")) == nt.get("word", prev.get("word"))
            if same_word:
                joined = not (art is not None and art.rearticulated(prev["end"], nt["start"], p.onset_min, p.dip_db))
            else:
                # across words only when the sound is plainly continuous (no attack, no dip at all)
                joined = (p.across_words and art is not None and art.onset_at(nt["start"]) < p.across_onset
                          and art.dip_at(prev["end"], nt["start"]) < p.across_dip)
            if joined:
                prev["end"] = max(prev["end"], nt["end"])
                if prev.get("word") is None:
                    prev["word"] = nt.get("word")
                rep["merged_held"] += 1
                continue
        merged.append(nt)
    # how sure we are of each note: the share of its frames where the voice is on its pitch
    for nt in merged:
        if nt.get("edited"):
            continue
        a, b = int(nt["start"] / HOP), min(n, int(nt["end"] / HOP))
        if b > a:
            on = ok[a:b] & (np.abs(midi[a:b] - nt["midi"]) <= p.hold_tol)
            nt["confidence"] = round(float(on.mean()), 3)
    # sustain: a note lasts while the voice stays on its pitch, up to the next note
    for k, nt in enumerate(merged):
        if nt.get("edited"):
            continue
        limit = merged[k + 1]["start"] if k + 1 < len(merged) else nt["end"] + p.extend_max
        limit = min(limit, nt["end"] + p.extend_max)
        e = int(nt["end"] / HOP)
        stop = min(n, int(limit / HOP))
        j = e
        while j < stop and ok[j] and abs(midi[j] - nt["midi"]) <= p.hold_tol:
            j += 1
        if j > e + 2:
            nt["end"] = round(j * HOP, 3)
            rep["extended"] += 1
    return merged


def align_to_attacks(notes: list[dict], art, window: float = 0.08, min_onset: float = 0.35, report: dict | None = None) -> list[dict]:
    """Moves a note's start back to the singer's attack: the strongest vocal onset (spectral flux) in the
    `window` seconds before the detected start, when there is a clear one. The pitch detector tends to start a
    note once the pitch has settled, after the consonant; a player starts it with the syllable."""
    rep = report if report is not None else {}
    rep["attack_aligned"] = 0
    if art is None:
        return notes
    notes = sorted(notes, key=lambda n: n["start"])
    hop = art.hop
    for k, nt in enumerate(notes):
        if nt.get("edited"):
            continue
        a = int(max(0, (nt["start"] - window) / hop))
        b = int(nt["start"] / hop) + 1
        seg = art.onset[a:b]
        if not len(seg):
            continue
        i = int(np.argmax(seg))
        if seg[i] < min_onset:
            continue
        t = (a + i) * hop
        prev = notes[k - 1] if k > 0 else None
        if t < nt["start"] - 0.012 and (prev is None or t > prev["start"] + 0.06):
            if prev is not None and prev["end"] > t:
                prev["end"] = round(t, 3)
            nt["start"] = round(t, 3)
            rep["attack_aligned"] += 1
    return notes
