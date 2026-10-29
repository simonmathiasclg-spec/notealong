"""Step 6: attach each note to the word being sung at that moment and build
"no lyric" blocks for notes outside any word."""
from __future__ import annotations

from ..config import ATTACH_TOLERANCE, INSTRUMENTAL_BLOCK_GAP


def _merge_repeats_within_words(notes: list[dict], max_gap: float = 0.02) -> None:
    """Two same-pitch notes with no gap inside ONE word are a spurious re-onset
    (a singer rarely re-attacks the same pitch within a word): join them.
    Across words they stay separate. Mutates `notes` in place."""
    notes.sort(key=lambda n: n["start"])
    out: list[dict] = []
    for n in notes:
        prev = out[-1] if out else None
        if (prev and n["word"] is not None and prev["word"] == n["word"]
                and prev["midi"] == n["midi"] and n["start"] - prev["end"] <= max_gap):
            prev["end"] = max(prev["end"], n["end"])
            prev["confidence"] = max(prev.get("confidence", 0), n.get("confidence", 0))
        else:
            out.append(n)
    notes[:] = out


def attach_notes(notes: list[dict], words: list[dict], lines: list[dict]) -> list[dict]:
    """Sets note['word'] and note['line'] in place. Returns the full line list
    including instrumental blocks (re-indexed)."""
    words = sorted(words, key=lambda w: w["start"])
    lyric_lines = [l for l in lines if l.get("kind", "lyric") == "lyric"]
    for n in notes:
        best, best_ov = None, 0.0
        for w in words:
            if w["end"] <= n["start"] - ATTACH_TOLERANCE:
                continue
            if w["start"] >= n["end"] + ATTACH_TOLERANCE:
                break
            ov = min(n["end"], w["end"]) - max(n["start"], w["start"])
            if ov > best_ov:
                best, best_ov = w, ov
        if best is None:
            # no overlap: closest word boundary within tolerance
            cands = [w for w in words
                     if abs(w["start"] - n["end"]) <= ATTACH_TOLERANCE or abs(n["start"] - w["end"]) <= ATTACH_TOLERANCE]
            if cands:
                best = min(cands, key=lambda w: min(abs(w["start"] - n["end"]), abs(n["start"] - w["end"])))
        n["word"] = best["id"] if best else None
        n["line"] = best["line"] if best else -1

    _merge_repeats_within_words(notes)

    # Group unattached notes into instrumental blocks.
    blocks: list[dict] = []
    for n in sorted((n for n in notes if n["word"] is None), key=lambda n: n["start"]):
        if blocks and n["start"] - blocks[-1]["end"] <= INSTRUMENTAL_BLOCK_GAP:
            blocks[-1]["end"] = max(blocks[-1]["end"], n["end"])
            blocks[-1]["notes"].append(n)
        else:
            blocks.append({"start": n["start"], "end": n["end"], "notes": [n]})

    all_lines = [dict(l, kind="lyric") for l in lyric_lines] + \
                [{"kind": "instrumental", "start": b["start"], "end": b["end"], "_notes": b["notes"]} for b in blocks]
    all_lines.sort(key=lambda l: l["start"])
    old_to_new = {}
    for new_idx, l in enumerate(all_lines):
        if l["kind"] == "lyric":
            old_to_new[l["index"]] = new_idx
        else:
            for n in l.pop("_notes"):
                n["line"] = new_idx
        l["index"] = new_idx
    for w in words:
        w["line"] = old_to_new[w["line"]]
    for n in notes:
        if n["word"] is not None:
            n["line"] = old_to_new[n["line"]]
    return [{"index": l["index"], "kind": l["kind"], "start": round(l["start"], 3), "end": round(l["end"], 3)}
            for l in all_lines]
