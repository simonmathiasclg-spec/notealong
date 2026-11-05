"""Held notes: one sustained sound must be one note.

When a singer holds or leans on a note (vibrato, a swell, an accent), the
pitch tracker often chops it into several notes of the same pitch, adds a
short note a semitone away where the voice scoops up into the note or sags at
the end, or flips between two neighbouring semitones on a wide vibrato. Shown
on screen that reads as "play this note again", but a sax player would simply
hold it.

`consolidate_held` runs after the notes have been matched to words and joins
such fragments. A junction between two notes is left alone when the singer
really starts again:

  - a new syllable starts (the notes belong to different words, or joining
    them would leave a word with fewer notes than it has syllables), or
  - the vocals show a real break at the junction: a dip in level (a closure
    or a breath), or, where no words are known, a clear onset, or
  - the silence between them is longer than `held_gap`.
"""
from __future__ import annotations

import re

from ..config import CleanupParams
from .onsets import Articulation

_VOWELS = "aeiouyàâäáãåāæéèêëēěíìîïīóòôöõōøœúùûüūůýÿ"
_VOWEL_RUN = re.compile(f"[{_VOWELS}]+")
_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
_LATIN = re.compile(r"[a-zà-ÿāēīōūœ]")


def count_syllables(text: str, language: str | None = None) -> int | None:
    """Rough number of sung syllables in a word, or None when it cannot be
    guessed (unknown script). It errs on the high side: too many syllables
    only means fewer notes are joined."""
    t = (text or "").lower()
    cjk = _CJK.findall(t)
    if cjk:
        return len(cjk)
    if not _LATIN.search(t):
        return None
    n = len(_VOWEL_RUN.findall(t))
    if (language or "").startswith("en") and n > 1 and re.search(r"[^aeiouy]e[sd]?$", t) and not re.search(r"[^aeiouy]le$", t):
        n -= 1   # silent final e: "make", "rules"
    return max(1, n)


def _dur(n: dict) -> float:
    return n["end"] - n["start"]


def _join(a: dict, b: dict, midi: int | None = None) -> dict:
    """a absorbs b (b follows a)."""
    a["end"] = max(a["end"], b["end"])
    a["start"] = min(a["start"], b["start"])
    a["confidence"] = max(a.get("confidence", 0), b.get("confidence", 0))
    if midi is not None:
        a["midi"] = midi
    return a


def consolidate_held(notes: list[dict], words: list[dict], p: CleanupParams, art: Articulation | None,
                     language: str | None = None) -> dict:
    """Joins the fragments of held notes in place (notes must carry `word`).
    Returns a small report of what was joined."""
    report = {"before": len(notes), "same_pitch": 0, "wobbles": 0, "bends": 0}
    notes.sort(key=lambda n: n["start"])
    if not notes:
        report["after"] = 0
        return report

    word_text = {w["id"]: (w.get("roman") or w.get("text") or "") for w in words}
    budget: dict[str, int] = {}

    def min_notes(word_id: str) -> int:
        if word_id not in budget:
            budget[word_id] = count_syllables(word_text.get(word_id, ""), language) or 1
        return budget[word_id]

    def count_in(word_id: str) -> int:
        return sum(1 for n in notes if n.get("word") == word_id)

    def relation(a: dict, b: dict) -> str:
        """inside: same word. tail: a is sung on a word and b carries on after it
        without a word of its own. free: neither has a word. boundary: a new word starts."""
        wa, wb = a.get("word"), b.get("word")
        if wa is not None and wa == wb:
            return "inside"
        if wa is not None and wb is None:
            return "tail"
        if wa is None and wb is None:
            return "free"
        return "boundary"

    def can_drop_one(a: dict, b: dict, rel: str) -> bool:
        """May the two notes become one without leaving a syllable noteless?"""
        if a.get("edited") or b.get("edited"):
            return False
        if rel == "boundary":
            return False
        if rel == "inside":
            return count_in(a["word"]) - 1 >= min_notes(a["word"])
        return True

    def weak(prev_end: float, next_start: float, rel: str = "free") -> bool:
        """No sign that the singer started again at this junction.

        Inside a word that has more notes than syllables the text already says
        "one syllable", and an accent, a swell or a change of vowel also makes a
        strong onset. There only a real break in the sound counts: a dip in
        level, or an onset together with at least a small dip. Where there are
        no words to go by, a clear onset on its own is taken as a new start."""
        if art is None:
            return next_start - prev_end <= 0.02
        dip = art.dip_at(prev_end, next_start)
        onset = art.onset_at(next_start)
        if rel == "inside":
            return not (dip >= p.dip_min_db or (onset >= p.onset_min and dip >= 0.4 * p.dip_min_db))
        return not (onset >= p.onset_min or dip >= p.dip_min_db)

    def strength(prev_end: float, next_start: float) -> float:
        return art.onset_at(next_start) if art is not None else next_start - prev_end

    changed = True
    passes = 0
    while changed and passes < 8:
        changed = False
        passes += 1

        # 1. wide vibrato: A, a short neighbour semitone, A again -> one long A
        if art is not None and p.wobble_len > 0:
            i = 0
            while i + 2 < len(notes):
                a, w, c = notes[i], notes[i + 1], notes[i + 2]
                if (a["midi"] == c["midi"] and abs(w["midi"] - a["midi"]) == 1 and _dur(w) <= p.wobble_len
                        and w["start"] - a["end"] <= 0.05 and c["start"] - w["end"] <= 0.05
                        and relation(a, w) in ("inside", "tail", "free") and relation(w, c) in ("inside", "free")
                        and not (a.get("edited") or w.get("edited") or c.get("edited"))
                        and weak(a["end"], w["start"], relation(a, w)) and weak(w["end"], c["start"], relation(w, c))
                        and (a.get("word") is None or count_in(a["word"]) - 2 >= min_notes(a["word"]) or relation(a, w) == "tail")):
                    _join(_join(a, w), c, a["midi"])
                    del notes[i + 1:i + 3]
                    report["wobbles"] += 1
                    changed = True
                    continue
                i += 1

        # 2. bends: a short note a semitone away at the very start (a scoop up into
        #    the note) or at the very end (the pitch sagging as the note is let go)
        if art is not None and p.bend_len > 0:
            i = 0
            while i + 1 < len(notes):
                a, b = notes[i], notes[i + 1]
                rel = relation(a, b)
                if abs(a["midi"] - b["midi"]) == 1 and b["start"] - a["end"] <= 0.05 and can_drop_one(a, b, rel) and weak(a["end"], b["start"], rel):
                    prev = notes[i - 1] if i > 0 else None
                    nxt = notes[i + 2] if i + 2 < len(notes) else None
                    # scoop: short first note of its group, the real note follows
                    starts_group = prev is None or relation(prev, a) == "boundary" or a["start"] - prev["end"] > 0.1
                    passing_in = prev is not None and a["start"] - prev["end"] <= 0.1 and (prev["midi"] - a["midi"]) * (a["midi"] - b["midi"]) > 0
                    if starts_group and not passing_in and _dur(a) <= p.bend_len and _dur(b) >= 1.5 * _dur(a) and rel == "inside":
                        _join(a, b, b["midi"])
                        del notes[i + 1]
                        report["bends"] += 1
                        changed = True
                        continue
                    # tail: short last note of its group after the real note
                    ends_group = nxt is None or relation(b, nxt) == "boundary" or nxt["start"] - b["end"] > 0.1
                    passing_out = nxt is not None and nxt["start"] - b["end"] <= 0.1 and (a["midi"] - b["midi"]) * (b["midi"] - nxt["midi"]) > 0
                    if ends_group and not passing_out and _dur(b) <= p.bend_len and _dur(a) >= 1.5 * _dur(b):
                        _join(a, b, a["midi"])
                        del notes[i + 1]
                        report["bends"] += 1
                        changed = True
                        continue
                i += 1

        # 3. the same pitch again with no new start: weakest junctions first, so a
        #    word keeps the repeats with the clearest onsets when its syllables need them
        cands = []
        for i in range(len(notes) - 1):
            a, b = notes[i], notes[i + 1]
            if a["midi"] != b["midi"]:
                continue
            gap = b["start"] - a["end"]
            if gap > p.held_gap:
                continue
            rel = relation(a, b)
            if rel == "boundary" or not weak(a["end"], b["start"], rel):
                continue
            cands.append((strength(a["end"], b["start"]), a["id"], b["id"]))
        for _, aid, bid in sorted(cands):
            idx = {n["id"]: k for k, n in enumerate(notes)}
            if aid not in idx or bid not in idx or idx[bid] != idx[aid] + 1:
                continue
            a, b = notes[idx[aid]], notes[idx[bid]]
            if not can_drop_one(a, b, relation(a, b)):
                continue
            _join(a, b)
            del notes[idx[bid]]
            report["same_pitch"] += 1
            changed = True

    report["after"] = len(notes)
    return report
