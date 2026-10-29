"""Romanize lyrics written in non-Latin scripts so a player can read them.

Language-specific libraries are used where they exist (Devanagari and other
Indic scripts, Korean, Japanese, Chinese); everything else falls back to
Unidecode, which gives a readable approximation for Cyrillic, Greek, Arabic,
Hebrew, Thai and more.
"""
from __future__ import annotations

import re
import unicodedata

_LATIN_RE = re.compile(r"[A-Za-zÀ-ɏḀ-ỿ]")

INDIC_SCHEMES = {
    "hi": "devanagari", "mr": "devanagari", "ne": "devanagari", "sa": "devanagari",
    "bn": "bengali", "pa": "gurmukhi", "gu": "gujarati", "ta": "tamil",
    "te": "telugu", "kn": "kannada", "ml": "malayalam",
}


def is_latin_script(text: str) -> bool:
    """True when most letters in the text are Latin."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    latin = sum(1 for c in letters if _LATIN_RE.match(c))
    return latin / len(letters) >= 0.6


def _strip_diacritics(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def romanize_word(text: str, language: str | None) -> str:
    lang = (language or "").lower()[:2]
    try:
        if lang in INDIC_SCHEMES:
            from indic_transliteration import sanscript
            out = sanscript.transliterate(text, INDIC_SCHEMES[lang], sanscript.IAST)
            return _strip_diacritics(out)
        if lang == "ko":
            from korean_romanizer.romanizer import Romanizer
            return Romanizer(text).romanize()
        if lang == "ja":
            import pykakasi
            kks = pykakasi.kakasi()
            return "".join(item["hepburn"] for item in kks.convert(text))
        if lang == "zh":
            from pypinyin import lazy_pinyin
            return "".join(lazy_pinyin(text))
    except Exception:
        pass
    from unidecode import unidecode
    return unidecode(text).strip()


def romanize_words(words: list[dict], language: str | None) -> None:
    """Adds a `roman` field in place where the word is not already Latin."""
    for w in words:
        if is_latin_script(w["text"]):
            w["roman"] = None
        else:
            w["roman"] = romanize_word(w["text"], language) or None
