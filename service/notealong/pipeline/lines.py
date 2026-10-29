"""Group timed words into karaoke lines."""
from __future__ import annotations

from ..config import LINE_BREAK_GAP, LINE_MAX_CHARS, LINE_SOFT_GAP


def _ends_sentence(text: str) -> bool:
    return text.rstrip()[-1:] in ".!?。！？"


def build_lines(words: list[dict], segments: list[list[float]] | None = None,
                explicit_breaks: set[int] | None = None) -> None:
    """Assigns word['line'] in place.

    explicit_breaks: word indexes after which a new line must start (from pasted lyrics).
    segments: transcription segments; a segment boundary is a strong hint for a line break.
    """
    seg_starts = sorted(s[0] for s in (segments or []))
    line = 0
    chars = 0
    for i, w in enumerate(words):
        if i == 0:
            w["line"] = 0
            chars = len(w["text"])
            continue
        prev = words[i - 1]
        gap = w["start"] - prev["end"]
        new_line = False
        if explicit_breaks is not None:
            new_line = (i - 1) in explicit_breaks
        else:
            at_segment = any(abs(w["start"] - s) < 0.05 for s in seg_starts)
            if gap >= LINE_BREAK_GAP:
                new_line = True
            elif at_segment and chars >= LINE_MAX_CHARS * 0.5:
                new_line = True
            elif chars + 1 + len(w["text"]) > LINE_MAX_CHARS and (gap >= LINE_SOFT_GAP or _ends_sentence(prev["text"])):
                new_line = True
            elif chars + 1 + len(w["text"]) > LINE_MAX_CHARS * 1.5:
                new_line = True
        if new_line:
            line += 1
            chars = len(w["text"])
        else:
            chars += 1 + len(w["text"])
        w["line"] = line


def lines_from_words(words: list[dict]) -> list[dict]:
    lines: dict[int, dict] = {}
    for w in words:
        li = w["line"]
        if li not in lines:
            lines[li] = {"index": li, "kind": "lyric", "start": w["start"], "end": w["end"]}
        else:
            lines[li]["start"] = min(lines[li]["start"], w["start"])
            lines[li]["end"] = max(lines[li]["end"], w["end"])
    return [lines[k] for k in sorted(lines)]
