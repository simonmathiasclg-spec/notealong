"""Step 6: attach each note to the word being sung at that moment and build
"no lyric" blocks for notes outside any word."""
from __future__ import annotations

from ..config import ATTACH_TOLERANCE, DEFAULT_DETAIL_LEVEL, DETAIL_LEVELS, INSTRUMENTAL_BLOCK_GAP, CleanupParams
from .held import consolidate_held
from .onsets import Articulation


def attach_notes(notes: list[dict], words: list[dict], lines: list[dict], *,
                 art: Articulation | None = None, params: CleanupParams | None = None,
                 language: str | None = None, report: dict | None = None) -> list[dict]:
    """Sets note['word'] and note['line'] in place. Returns the full line list
    including instrumental blocks (re-indexed).

    Once every note knows its word, the fragments of held notes are joined
    (see held.py). `art` is the articulation evidence from the vocals stem;
    without it only fragments that touch inside one word are joined."""
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

    held = consolidate_held(notes, words, params or DETAIL_LEVELS[DEFAULT_DETAIL_LEVEL], art, language)
    if report is not None:
        report.update(held)

    return with_blocks(notes, words, lyric_lines)


HOOK_LINE_NOTES = 6          # an instrumental hook gets a new line at a breath after this many notes ...
HOOK_LINE_SECONDS = 9.0      # ... and in any case after twice as many, or this long


def with_blocks(notes: list[dict], words: list[dict], lyric_lines: list[dict]) -> list[dict]:
    """The full line list: the lyric lines plus a "no lyric" block for every run of notes without a word.
    Sets the line of every note and word in place (re-indexed)."""
    blocks: list[dict] = []
    for n in sorted((n for n in notes if n["word"] is None), key=lambda n: n["start"]):
        hook = n.get("hook")
        last = blocks[-1] if blocks else None
        gap = n["start"] - last["end"] if last else 0.0
        joins = last is not None and last["label"] == hook and gap <= INSTRUMENTAL_BLOCK_GAP
        if joins and hook:
            # a hook is cut into lines a player can take in: at a breath once the line has some length,
            # and anyway before it gets too long to read
            count, span = len(last["notes"]), n["start"] - last["start"]
            if (count >= HOOK_LINE_NOTES and gap >= 0.12) or count >= 2 * HOOK_LINE_NOTES or span >= HOOK_LINE_SECONDS:
                joins = False
        if joins:
            last["end"] = max(last["end"], n["end"])
            last["notes"].append(n)
        else:
            blocks.append({"start": n["start"], "end": n["end"], "notes": [n], "label": hook})

    all_lines = [dict(l, kind="lyric") for l in lyric_lines] + \
                [{"kind": "instrumental", "start": b["start"], "end": b["end"], "_notes": b["notes"], "label": b["label"]} for b in blocks]
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
    return [{"index": l["index"], "kind": l["kind"], "start": round(l["start"], 3), "end": round(l["end"], 3),
             "label": l.get("label")} for l in all_lines]
