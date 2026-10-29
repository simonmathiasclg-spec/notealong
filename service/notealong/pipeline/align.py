"""Step 5: align pasted lyrics to the audio.

We align the pasted words to the *transcribed* words (which carry timings)
with a fuzzy sequence alignment, copy the timings of matched words, and
interpolate the timings of unmatched words between their nearest anchors.
This is language-agnostic and needs no extra model; it inherits the timing
accuracy of the transcription step.
"""
from __future__ import annotations

import difflib
import re
import unicodedata

from unidecode import unidecode

_PUNCT = re.compile(r"[^\w']+", re.UNICODE)


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    t = unidecode(t)
    t = _PUNCT.sub("", t)
    return t


def tokenize_pasted(text: str) -> tuple[list[str], set[int]]:
    """Returns (words, break_after) where break_after holds word indexes that end a line."""
    words: list[str] = []
    breaks: set[int] = set()
    for raw_line in text.replace("\r", "").split("\n"):
        line_words = [w for w in raw_line.split() if normalize(w)]
        if not line_words:
            continue
        words.extend(line_words)
        breaks.add(len(words) - 1)
    return words, breaks


def _similar(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def align_words(pasted: list[str], transcribed: list[dict], min_similarity: float = 0.75) -> list[int | None]:
    """Needleman-Wunsch style alignment of pasted words to transcribed words.

    Returns for each pasted word the index of the matching transcribed word, or None.
    """
    P = [normalize(w) for w in pasted]
    T = [normalize(w["text"]) for w in transcribed]
    n, m = len(P), len(T)
    if n == 0 or m == 0:
        return [None] * n
    gap = -0.4
    # score matrix (n+1) x (m+1)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]  # 1 = diag, 2 = up (skip pasted), 3 = left (skip transcribed)
    for i in range(1, n + 1):
        score[i][0] = i * gap
        back[i][0] = 2
    for j in range(1, m + 1):
        score[0][j] = j * gap
        back[0][j] = 3
    for i in range(1, n + 1):
        pi = P[i - 1]
        for j in range(1, m + 1):
            sim = _similar(pi, T[j - 1])
            match = score[i - 1][j - 1] + (sim if sim >= min_similarity else -1.0 + sim * 0.5)
            up = score[i - 1][j] + gap
            left = score[i][j - 1] + gap
            best = max(match, up, left)
            score[i][j] = best
            back[i][j] = 1 if best == match else (2 if best == up else 3)
    result: list[int | None] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        b = back[i][j]
        if b == 1:
            if _similar(P[i - 1], T[j - 1]) >= min_similarity:
                result[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif b == 2:
            i -= 1
        else:
            j -= 1
    return result


def timed_words_from_pasted(pasted_text: str, transcribed: list[dict], duration: float) -> tuple[list[dict], set[int]]:
    """Build timed words for the pasted lyrics. Returns (words, line_breaks)."""
    pasted, breaks = tokenize_pasted(pasted_text)
    mapping = align_words(pasted, transcribed)
    n = len(pasted)
    starts: list[float | None] = [None] * n
    ends: list[float | None] = [None] * n
    for i, j in enumerate(mapping):
        if j is not None:
            starts[i] = transcribed[j]["start"]
            ends[i] = transcribed[j]["end"]
    # Interpolate unmatched words between anchors, weighting by word length.
    anchors = [i for i in range(n) if starts[i] is not None]
    if not anchors:
        # nothing matched: spread evenly across the song (better than nothing)
        step = duration / max(n, 1)
        for i in range(n):
            starts[i], ends[i] = i * step, (i + 0.9) * step
    else:
        def fill(lo: int, hi: int, t0: float, t1: float) -> None:
            idx = list(range(lo, hi + 1))
            if not idx:
                return
            weights = [max(len(normalize(pasted[k])), 1) for k in idx]
            total = sum(weights) + 0.0
            span = max(t1 - t0, 0.05 * len(idx))
            t = t0
            for k, wgt in zip(idx, weights):
                d = span * wgt / total
                starts[k], ends[k] = t, t + d * 0.9
                t += d
        first, last = anchors[0], anchors[-1]
        if first > 0:
            t1 = starts[first]
            t0 = max(0.0, t1 - 0.4 * first)
            fill(0, first - 1, t0, t1)
        for a, b in zip(anchors, anchors[1:]):
            if b - a > 1:
                fill(a + 1, b - 1, ends[a], starts[b])
        if last < n - 1:
            t0 = ends[last]
            fill(last + 1, n - 1, t0, min(duration, t0 + 0.4 * (n - 1 - last)))
    words = []
    for i in range(n):
        words.append({"text": pasted[i], "start": float(starts[i]), "end": float(ends[i]),
                      "confidence": 1.0 if mapping[i] is not None else 0.5})
    return words, breaks
