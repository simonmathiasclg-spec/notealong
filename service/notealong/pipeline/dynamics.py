"""How loudly each note was sung, for "Hear it played".

The instrument follows the singer: a note sung loudly is played loudly. The level comes from the vocals
stem's level curve (envelope.json, see onsets.py), measured over the loud part of each note, compared with
the song's typical note and squeezed into a range an instrument can use (0 = very soft, 1 = full).
"""
from __future__ import annotations

import numpy as np

from .onsets import Articulation

MIDDLE = 0.68        # the level of a typical note
PER_DB = 0.03        # 6 dB louder than typical -> 0.18 higher
LOW, HIGH = 0.3, 1.0
SPREAD = 0.32        # a player's soft-to-loud notes differ by about this much; a mastered pop vocal is flatter
STRETCH_MAX = 2.5


def note_levels(notes: list, art: Articulation) -> dict[str, float]:
    """`notes` have id, start, end (seconds). Returns id -> level in 0..1."""
    raw: list[float] = []
    for n in notes:
        a = int(max(0, round(n.start / art.hop)))
        b = int(min(len(art.level), max(a + 1, round(n.end / art.hop))))
        seg = np.asarray(art.level[a:b], dtype=np.float64)
        if not len(seg):
            raw.append(float("nan"))
            continue
        # the loud half of the note: the consonant at the front and the fade at the end do not count
        raw.append(float(np.sort(seg)[len(seg) // 2:].mean()))
    arr = np.asarray(raw)
    ok = np.isfinite(arr)
    if not ok.any():
        return {}
    typical = float(np.median(arr[ok]))
    lev = np.where(ok, MIDDLE + (arr - typical) * PER_DB, MIDDLE)
    if ok.sum() >= 8:
        # records are levelled out in the mix: open the range up again to what a player would use
        lo, hi = np.percentile(lev[ok], [10, 90])
        if 1e-6 < hi - lo < SPREAD:
            lev = MIDDLE + (lev - MIDDLE) * min(STRETCH_MAX, SPREAD / (hi - lo))
    lev = np.clip(lev, LOW, HIGH)
    # a singer's loudness moves in phrases; one stray note should not jump out
    out = lev.copy()
    for i in range(len(lev)):
        near = [lev[j] for j in (i - 1, i + 1) if 0 <= j < len(lev) and abs(notes[j].start - notes[i].start) < 1.5]
        if near:
            out[i] = 0.7 * lev[i] + 0.3 * float(np.mean(near))
    return {n.id: round(float(v), 3) for n, v in zip(notes, out)}
