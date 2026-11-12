"""What the sheet music view needs on top of the notes: the beat grid, the time signature and the chords.

Hand-authored catalog songs already know all of this exactly (it is written in their .song file), so nothing is
detected for them. For every other song the beats and bar lines come from Beat This! (CPJKU, MIT licence) run on
the backing track, and the chords from a small recogniser of our own: beat-by-beat chroma (librosa, ISC licence)
matched against major and minor triads, smoothed so chords change on beats and prefer bar lines, then a seventh
is added where the backing clearly plays one. No third-party chord model is used: the well known ones are either
GPL (Chordino) or trained weights under non-commercial terms (madmom).

The quantizing of the melody itself happens in the player (web/src/lib/score.ts), so that edits, key changes and
instrument changes show at once; this module only says where the beats are.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import numpy as np

VERSION = 2
_LOCK = threading.Lock()          # one detection at a time (it loads a model and a whole track)

MAJOR, MINOR = (0, 4, 7), (0, 3, 7)


# ---------------------------------------------------------------- beats

def regular_beats(beats: list[float], downbeats: list[float], duration: float) -> tuple[list[float], int, int]:
    """Makes a tracker's beats usable as a grid for notation.

    Fills beats the tracker skipped (quiet passages), carries the grid to both ends of the song at the nearest
    tempo, and settles on one number of beats per bar with one bar-line phase, so the time signature never
    flickers. Returns (beats, beats_per_bar, index of the first downbeat).
    """
    b = sorted(set(round(float(x), 4) for x in beats))
    if len(b) < 4:
        return [], 4, 0
    gaps = np.diff(b)
    med = float(np.median(gaps))
    filled = [b[0]]
    for i in range(1, len(b)):
        lo = max(0, i - 8)
        local = float(np.median(gaps[lo:i + 8])) or med
        k = int(round((b[i] - b[i - 1]) / local))
        if k >= 2 and (b[i] - b[i - 1]) > 1.5 * local:
            step = (b[i] - b[i - 1]) / k
            filled.extend(b[i - 1] + step * j for j in range(1, k))
        filled.append(b[i])
    first = float(np.median(np.diff(filled[:9])))
    last = float(np.median(np.diff(filled[-9:])))
    head: list[float] = []
    t = filled[0] - first
    while t >= 0:
        head.append(t)
        t -= first
    out = head[::-1] + filled
    t = out[-1] + last
    while t <= duration:
        out.append(t)
        t += last
    arr = np.asarray(out)
    idx = sorted(set(int(np.argmin(np.abs(arr - d))) for d in downbeats))
    per_bar = 4
    if len(idx) >= 3:
        steps = np.diff(idx)
        vals, counts = np.unique(steps[(steps >= 2) & (steps <= 12)], return_counts=True)
        if len(vals):
            per_bar = int(vals[np.argmax(counts)])
    phase = 0
    if idx:
        votes = np.bincount([i % per_bar for i in idx], minlength=per_bar)
        phase = int(np.argmax(votes))
    return [round(float(x), 4) for x in out], per_bar, phase


def meter_for(per_bar: int) -> tuple[int, int]:
    """Beats per bar from the tracker -> a time signature. Six quick beats in a bar read best as 6/8."""
    if per_bar in (6, 9, 12):
        return per_bar, 8
    return per_bar, 4


# ---------------------------------------------------------------- chords

def _templates() -> tuple[np.ndarray, list[tuple[int, str]]]:
    rows, names = [], []
    for quality, shape in (("", MAJOR), ("m", MINOR)):
        for root in range(12):
            v = np.zeros(12)
            for k, w in zip(shape, (1.0, 0.85, 0.9)):
                v[(root + k) % 12] = w
            rows.append(v / np.linalg.norm(v))
            names.append((root, quality))
    return np.asarray(rows), names


def in_key(tonic: int, mode: str) -> set[tuple[int, str]]:
    """The six everyday chords of a key (and the major dominant of a minor key)."""
    home = tonic if mode == "major" else (tonic + 3) % 12
    chords = {((home + k) % 12, "") for k in (0, 5, 7)} | {((home + k) % 12, "m") for k in (2, 4, 9)}
    if mode != "major":
        chords.add(((tonic + 7) % 12, ""))
    return chords


def chords_from_chroma(chroma: np.ndarray, bass: np.ndarray | None, per_bar: int, phase: int,
                       energy: np.ndarray | None = None, key: tuple[int, str] | None = None) -> list[tuple[int, int, int | None, str]]:
    """Chords from one chroma vector per beat. `chroma` and `bass` are (12, beats).

    `key` (tonic, mode) nudges close calls towards the chords that belong to the song's key.
    Returns [(first beat, beat after the last, root or None, quality)], with quality "", "m", "7" or "m7".
    """
    n = chroma.shape[1]
    if n == 0:
        return []
    T, names = _templates()
    c = np.nan_to_num(chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9))
    with np.errstate(all="ignore"):
        sim = np.nan_to_num(T @ c)                                                    # (24, beats)
    if bass is not None:
        bn = bass / (bass.sum(axis=0, keepdims=True) + 1e-9)
        sim = sim + 0.35 * np.vstack([bn, bn])                     # the bass usually plays the root
    if key is not None:
        home = in_key(*key)
        sim = sim + np.asarray([0.05 if nm in home else 0.0 for nm in names])[:, None]
    quiet = np.zeros(n, bool)
    if energy is not None and len(energy) == n:
        quiet = energy < 0.05 * np.percentile(energy, 90)
    S = len(names) + 1                                             # last state = no chord
    emit = np.zeros((S, n))
    emit[:-1] = 9.0 * sim
    emit[-1] = np.where(quiet, 9.0 * 2.0, 9.0 * 0.45)
    # A change costs more in the middle of a bar than on its first beat (half-bars in between).
    cost = np.full(n, 3.2)
    for i in range(n):
        pos = (i - phase) % per_bar
        if pos == 0:
            cost[i] = 1.4
        elif per_bar % 2 == 0 and pos == per_bar // 2:
            cost[i] = 2.3
    score = emit[:, 0].copy()
    back = np.zeros((S, n), int)
    for i in range(1, n):
        best = int(np.argmax(score))
        switch = score[best] - cost[i]
        stay = score
        take = switch > stay
        back[:, i] = np.where(take, best, np.arange(S))
        score = np.where(take, switch, stay) + emit[:, i]
    path = np.zeros(n, int)
    path[-1] = int(np.argmax(score))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[path[i], i]
    # a chord that lasts a single beat is nearly always a passing note in the band, not a change to read
    if per_bar >= 3:
        i = 1
        while i < n:
            j = i
            while j < n and path[j] == path[i]:
                j += 1
            if j - i == 1 and path[i] != path[i - 1]:
                path[i] = path[i - 1]
            i = j
    out: list[tuple[int, int, int | None, str]] = []
    i = 0
    while i < n:
        j = i
        while j < n and path[j] == path[i]:
            j += 1
        if path[i] == S - 1:
            out.append((i, j, None, ""))
        else:
            root, quality = names[path[i]]
            out.append((i, j, root, _seventh(chroma[:, i:j].mean(axis=1), root, quality)))
        i = j
    return out


def _seventh(mean: np.ndarray, root: int, quality: str) -> str:
    """Adds a seventh only where it is played about as strongly as the chord's own notes."""
    shape = MINOR if quality == "m" else MAJOR
    own = float(np.mean([mean[(root + k) % 12] for k in shape]))
    others = float(np.median(mean))
    if own <= 0:
        return quality
    flat7, maj7 = float(mean[(root + 10) % 12]), float(mean[(root + 11) % 12])
    if flat7 > 0.8 * own and flat7 > 1.6 * others and flat7 >= maj7:
        return "m7" if quality == "m" else "7"
    return quality


def detect_chords(path: Path, beats: list[float], per_bar: int, phase: int, key: tuple[int, str] | None = None) -> list[dict]:
    import librosa
    sr, hop = 22050, 2048
    y, _ = librosa.load(str(path), sr=sr, mono=True)
    y = librosa.effects.harmonic(y, margin=2.0)
    tuning = float(librosa.estimate_tuning(y=y, sr=sr))
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, tuning=tuning, fmin=librosa.note_to_hz("C2"), n_octaves=5)
    low = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, tuning=tuning, fmin=librosa.note_to_hz("C1"), n_octaves=2)
    rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=hop)[0]
    frames = librosa.time_to_frames(np.asarray(beats), sr=sr, hop_length=hop)
    frames = np.clip(frames, 0, chroma.shape[1] - 1)
    edges = np.unique(frames)
    sync = lambda m, how: librosa.util.sync(m, edges, aggregate=how, pad=False)       # noqa: E731
    c, b, e = sync(chroma, np.median), sync(low, np.median), sync(rms[None, :chroma.shape[1]], np.mean)[0]
    # beats that fell on the same frame were merged by np.unique: map each beat interval to its column
    col = np.searchsorted(edges, frames[:-1], side="left")
    col = np.clip(col, 0, c.shape[1] - 1)
    c, b, e = c[:, col], b[:, col], e[col]
    segs = chords_from_chroma(c, b, per_bar, phase, e, key)
    out = []
    for i, j, root, quality in segs:
        out.append({"start": beats[i], "end": beats[min(j, len(beats) - 1)], "root": root, "quality": quality, "bass": None})
    return out


# ---------------------------------------------------------------- the two sources

def authored_score(song_file: Path, duration: float) -> dict:
    """Exact grid, chords and syllables for a hand-authored song, read from its .song file."""
    from ..catalog.arrange import Arranger
    from ..catalog.dsl import load_song_file
    spec = load_song_file(song_file)
    arr = Arranger(spec)
    end = max(duration, arr.end)
    count = int(np.ceil(end / arr.beat_len)) + 1
    beats = [round(i * arr.beat_len, 4) for i in range(count)]
    chords = []
    for s, e, ev in arr._timeline:
        if chords and chords[-1]["root"] == ev.root and chords[-1]["quality"] == ev.quality and chords[-1]["bass"] == ev.bass \
                and abs(chords[-1]["end"] - s) < 1e-6 and (s < arr.bar1 or e > arr.bar1 + arr.song_bars * arr.bar_len):
            chords[-1]["end"] = round(e, 4)          # the held intro and ending chords are one symbol
            continue
        chords.append({"start": round(s, 4), "end": round(e, 4), "root": ev.root, "quality": ev.quality, "bass": ev.bass})
    syllables: dict[str, str] = {}
    for w in spec.words:
        sung = [i for i in w.notes if spec.melody[i].syllable]
        for k, i in enumerate(sung):
            text = (spec.melody[i].syllable or "").replace("‿", " ")
            syllables[f"n{i}"] = text + ("-" if k < len(sung) - 1 else "")
    return {"version": VERSION, "source": "authored", "meter": [spec.beats_per_bar, spec.beat_unit], "tempo": spec.tempo,
            "beats": beats, "downbeat": 0, "first_bar": round(arr.bar1, 4), "chords": chords, "syllables": syllables}


def detected_score(backing: Path, duration: float, key: tuple[int, str] | None = None) -> dict:
    from .beats import detect_beats
    found = detect_beats(backing)
    beats, per_bar, phase = regular_beats(found["beats"], found["downbeats"], duration)
    if not beats:
        return {"version": VERSION, "source": "none", "meter": [4, 4], "tempo": None, "beats": [], "downbeat": 0, "chords": [], "syllables": {}}
    n, d = meter_for(per_bar)
    tempo = 60.0 / float(np.median(np.diff(beats)))
    chords = detect_chords(backing, beats, per_bar, phase, key)
    return {"version": VERSION, "source": "detected", "meter": [n, d], "tempo": round(tempo, 1), "beats": beats, "downbeat": phase,
            "chords": chords, "syllables": {}}


def song_score(song_file: Path | None, backing: Path, cache: Path, duration: float, key: tuple[int, str] | None = None) -> dict:
    """The score data for one song. Detection runs once and is kept next to the song."""
    if song_file is not None and song_file.exists():
        return authored_score(song_file, duration)
    if cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("version") == VERSION:
                return data
        except (OSError, ValueError):
            pass
    with _LOCK:
        if cache.exists():
            try:
                data = json.loads(cache.read_text(encoding="utf-8"))
                if data.get("version") == VERSION:
                    return data
            except (OSError, ValueError):
                pass
        data = detected_score(backing, duration, key)
        tmp = cache.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(cache)
        return data
