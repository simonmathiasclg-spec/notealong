"""How many syllables a sung word has.

The sax-friendly melody (saxmelody.py) gives every syllable one note, so it needs to know how many a word
has. Only the count matters, not where a dictionary would hyphenate, so this is a small set of rules of our
own (no hyphenation library and no licence to track): vowel groups, with the usual exceptions for English
(silent e, -ed, -es), the diphthong rules of Spanish, Portuguese and Italian, and one syllable per character
for Korean, Japanese and Chinese. A wrong count costs little: one syllable too many plays a held note twice,
one too few keeps the longer of two notes.
"""
from __future__ import annotations

import re
import unicodedata

# English words the rules get wrong often enough in lyrics to list
_EN = {
    "every": 2, "everything": 3, "everyone": 3, "everybody": 4, "everywhere": 3, "different": 2, "people": 2,
    "being": 2, "going": 2, "doing": 2, "seeing": 2, "quiet": 2, "idea": 3, "real": 1, "really": 2, "our": 1,
    "hour": 1, "hours": 1, "fire": 1, "desire": 2, "higher": 2, "science": 2, "lion": 2, "poem": 2, "create": 2,
    "area": 3, "beautiful": 3, "business": 2, "evening": 2, "something": 2, "sometimes": 2, "somewhere": 2,
    "someone": 2, "somebody": 3, "anyone": 3, "anything": 3, "lonely": 2, "lovely": 2, "heaven": 2, "prayer": 1,
    "the": 1, "he": 1, "she": 1, "me": 1, "we": 1, "be": 1, "maybe": 2, "even": 2, "eyes": 1, "yeah": 1,
    "ooh": 1, "oh": 1, "ah": 1, "hey": 1, "baby": 2, "crazy": 2, "lady": 2, "only": 2, "over": 2, "open": 2,
    "broken": 2, "simple": 2, "little": 2, "trouble": 2, "middle": 2, "able": 2, "table": 2, "angel": 2,
    "angels": 2, "believe": 2, "whisper": 2, "whispered": 2, "listen": 2, "remember": 3, "forever": 3,
    "never": 2, "ever": 2, "together": 3, "diamond": 2, "diamonds": 2, "memory": 3, "memories": 3,
    "family": 3, "favorite": 3, "favourite": 3, "chocolate": 2, "camera": 3, "comfortable": 3, "interesting": 3,
    "world": 1, "girl": 1, "learned": 1, "loved": 1, "used": 1, "once": 1, "one": 1, "done": 1, "gone": 1,
    "come": 1, "comes": 1, "some": 1, "love": 1, "loves": 1, "have": 1, "give": 1, "live": 1, "lives": 1,
    "there": 1, "where": 1, "here": 1, "were": 1, "are": 1, "sure": 1, "pure": 1, "cure": 1, "more": 1,
    "before": 2, "anymore": 3, "tired": 1, "wired": 1, "poet": 2, "ruin": 2, "fluid": 2, "naive": 2, "dynamite": 3,
    "mother": 2, "mary": 2, "wisdom": 2, "reason": 2, "learning": 2, "second": 2, "hearted": 2,
}
_VOWELS_EN = "aeiouy"
_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")


def _letters(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalpha() or c == "'")


def _english(w: str) -> int:
    w = w.replace("'", "")
    if not w:
        return 1
    if w in _EN:
        return _EN[w]
    for suffix, extra in (("'s", 0), ("s", 0), ("ing", 1), ("ly", 1), ("ness", 1), ("less", 1), ("ful", 1)):
        stem = w[: -len(suffix)] if w.endswith(suffix) else ""
        if stem in _EN:
            return _EN[stem] + extra
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if n <= 1:
        return 1
    # silent final e (but "-le" after a consonant is its own syllable: little, simple)
    if w.endswith("e") and not w.endswith(("le", "ee", "ye")) and w[-2] not in _VOWELS_EN:
        n -= 1
    elif w.endswith("le") and len(w) > 2 and w[-3] in _VOWELS_EN:
        n -= 1                                   # whole, smile
    elif w.endswith("es") and len(w) > 3 and w[-3] not in _VOWELS_EN and not w.endswith(("ses", "zes", "xes", "ches", "shes", "ges", "ces")):
        n -= 1                                   # times, comes
    elif w.endswith("ed") and len(w) > 3 and w[-3] not in "td" and w[-3] not in _VOWELS_EN:
        n -= 1                                   # loved, turned (but wanted, needed)
    # vowel pairs that are two syllables
    n += len(re.findall(r"i[ao]|[aeiou]ing|eo(?!u)|ua(?!r)|uou|iet|ia", w)) and min(1, len(re.findall(r"ia|io(?!u)|[aeou]ing|iet|uou", w)))
    return max(1, n)


_STRONG = set("aeoáéóíúàèòâêôãõ")
_WEAK = set("iuüy")


def _romance(w: str) -> int:
    w = w.replace("'", "")
    w = re.sub(r"([qg])u([eiéí])", r"\1\2", w)        # silent u: que, guitarra
    n, prev = 0, ""
    i = 0
    while i < len(w):
        c = w[i]
        is_vowel = c in _STRONG or c in _WEAK
        if c == "y" and i + 1 < len(w) and (w[i + 1] in _STRONG or w[i + 1] in _WEAK):
            is_vowel = False                           # consonant y: yo, playa
        if is_vowel:
            if not prev:
                n += 1
            elif prev in _STRONG and c in _STRONG:
                n += 1                                 # hiatus: po-e-ta
            prev = c
        else:
            prev = ""
        i += 1
    return max(1, n)


def _generic(w: str) -> int:
    plain = unicodedata.normalize("NFKD", w)
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return max(1, len(re.findall(r"[aeiouy]+", plain)))


def count_syllables(text: str, language: str | None = None, roman: str | None = None) -> int:
    """Syllables in one word as it is sung. `roman` is the romanised form for non-Latin scripts."""
    cjk = _CJK.findall(text or "")
    if cjk:
        return max(1, len(cjk))
    w = _letters(text or "")
    lang = (language or "en").lower()[:2]
    if not w or not re.search(r"[a-zà-ÿ]", w):
        if roman:
            return _generic(_letters(roman))
        return 1
    if lang == "en":
        # hyphenated compounds count part by part
        return sum(_english(part) for part in re.split(r"[-–]", (text or "").lower()) if _letters(part)) or 1
    if lang in ("es", "pt", "it", "ca", "gl"):
        return _romance(w)
    return _generic(w)
