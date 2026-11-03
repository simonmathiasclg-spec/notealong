"""Easy / Medium / Hard from the melody itself: range, number of different
notes, how fast notes come, and how big the jumps are."""
from __future__ import annotations


def rate_difficulty(notes: list[dict], duration: float | None = None) -> tuple[str, dict]:
    """`notes` are song.json notes (midi/start/end). Returns (rating, details)."""
    midis = sorted(n["midi"] for n in notes)
    if not midis:
        return "easy", {}
    # robust range and note count: ignore the rare stray note at the extremes
    k = len(midis)
    lo, hi = midis[int(0.03 * (k - 1))], midis[int(0.97 * (k - 1))]
    rng = hi - lo
    counts: dict[int, int] = {}
    for m in midis:
        counts[m] = counts.get(m, 0) + 1
    distinct = sum(1 for c in counts.values() if c >= max(1, 0.02 * k))
    span = (max(n["end"] for n in notes) - min(n["start"] for n in notes)) or 1.0
    rate = len(notes) / span
    seq = [n["midi"] for n in sorted(notes, key=lambda n: n["start"])]
    leaps = [abs(b - a) for a, b in zip(seq, seq[1:])]
    big = sum(1 for l in leaps if l >= 7) / max(1, len(leaps))
    shortest = min(n["end"] - n["start"] for n in notes)
    score = 0.0
    score += 0 if rng <= 9 else 1 if rng <= 12 else 2 if rng <= 15 else 3
    score += 0 if distinct <= 6 else 1 if distinct <= 8 else 2 if distinct <= 10 else 3
    score += 0 if rate <= 1.6 else 1 if rate <= 2.3 else 2 if rate <= 3.0 else 3
    score += 0 if big < 0.1 else 1 if big < 0.2 else 2
    score += 1 if shortest < 0.2 else 0
    rating = "easy" if score <= 2 else "medium" if score <= 5 else "hard"
    return rating, {"range": rng, "distinct": distinct, "notes_per_second": round(rate, 2),
                    "big_leaps": round(big, 2), "shortest": round(shortest, 2), "score": score}
