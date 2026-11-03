"""Parser for the hand-authored song format (catalog/songs/<id>.song).

A file has a header of `key: value` lines, a `chords:` section and a
`melody:` section. See catalog/songs/README.md for the full format. Everything
here is plain Python so it can be unit-tested without audio libraries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

NOTE_RE = re.compile(r"^(~)?([A-Ga-g])([#b]?)(-?\d)(.*)$")
PITCH_CLASS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
KEY_NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
             "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11}


class SongFormatError(ValueError):
    pass


@dataclass
class MelodyNote:
    beat: float          # offset from the first melody note, in beats
    beats: float         # duration in beats
    midi: int            # concert pitch; -1 for a rest
    syllable: str | None # None for rests and tied/slurred continuations
    word_index: int      # index into SongSpec.words (-1 for rests)
    line: int


@dataclass
class WordSpec:
    text: str
    line: int
    notes: list[int] = field(default_factory=list)   # indexes into melody
    original: str | None = None                      # original-script word when the lyric line is romanized


@dataclass
class ChordEvent:
    beat: float          # from bar 1 (beat 0 = first downbeat after the pickup)
    beats: float
    root: int | None     # pitch class, None = no chord
    quality: str         # "", "m", "7", "maj7", "m7", "dim", "aug", "sus4", "sus2", "6", "m6", "9"
    bass: int | None     # pitch class of a slash bass


@dataclass
class SongSpec:
    id: str
    meta: dict
    beats_per_bar: int
    beat_unit: int
    tempo: float
    pickup: float
    intro_bars: int
    outro_bars: int
    key_tonic: int
    key_mode: str
    key_name: str
    chords: list[ChordEvent]
    chord_bars: int
    melody: list[MelodyNote]
    words: list[WordSpec]
    lines: list[str]
    warnings: list[str] = field(default_factory=list)

    @property
    def melody_beats(self) -> float:
        return max((n.beat + n.beats for n in self.melody), default=0.0)


def parse_pitch(token: str) -> tuple[int, float, bool]:
    """'C4' -> (60, 1.0, False); '~G#4.' -> (68, 1.5, True); 'Bb3(2)' -> (58, 2.0, False)."""
    m = NOTE_RE.match(token)
    if not m:
        raise SongFormatError(f"Bad note '{token}'")
    tie, letter, acc, octave, rest = m.groups()
    midi = 12 * (int(octave) + 1) + PITCH_CLASS[letter.upper()] + (1 if acc == "#" else -1 if acc == "b" else 0)
    return midi, parse_duration(rest, token), bool(tie)


def parse_duration(suffix: str, token: str) -> float:
    if suffix == "":
        return 1.0
    if suffix == ".":
        return 1.5
    if suffix == "/":
        return 0.5
    if suffix == "//":
        return 0.25
    if suffix == "/.":
        return 0.75
    m = re.fullmatch(r"\(([0-9.]+)\)", suffix)
    if m:
        return float(m.group(1))
    raise SongFormatError(f"Bad duration in '{token}' (use . / // or (n))")


def parse_rest(token: str) -> float | None:
    m = re.fullmatch(r"r(.*)", token)
    if not m:
        return None
    return parse_duration(m.group(1), token)


CHORD_RE = re.compile(r"^([A-G][#b]?)(maj7|m7b5|m7|m6|m9|m|dim7|dim|aug|sus4|sus2|7sus4|add9|6|7|9|maj9|\+)?(?:/([A-G][#b]?))?$")


def parse_chord(sym: str) -> tuple[int | None, str, int | None]:
    if sym in ("NC", "N.C.", "-"):
        return None, "", None
    m = CHORD_RE.match(sym)
    if not m:
        raise SongFormatError(f"Bad chord '{sym}'")
    root, qual, bass = m.groups()
    qual = qual or ""
    if qual == "+":
        qual = "aug"
    return KEY_NAMES[root], qual, KEY_NAMES[bass] if bass else None


def parse_chords(text: str, beats_per_bar: int) -> tuple[list[ChordEvent], int]:
    bars = [b.strip() for b in text.replace("\n", " ").split("|")]
    bars = [b for b in bars if b != ""]
    events: list[ChordEvent] = []
    prev_bar: list[tuple] | None = None
    for bar_idx, bar in enumerate(bars):
        toks = bar.split()
        if toks == ["%"]:
            if prev_bar is None:
                raise SongFormatError("'%' in the first bar")
            toks_parsed = prev_bar
        else:
            # '/' repeats the previous chord in this slot so beat-level changes can be written
            slots: list[tuple] = []
            for t in toks:
                if t == "/":
                    if not slots:
                        raise SongFormatError(f"'/' at the start of bar {bar_idx + 1}")
                    slots.append(slots[-1])
                else:
                    slots.append(parse_chord(t))
            toks_parsed = slots
        n = len(toks_parsed)
        if n == 0:
            continue
        if beats_per_bar % n != 0 and n != 1:
            raise SongFormatError(f"Bar {bar_idx + 1}: {n} chords do not divide {beats_per_bar} beats evenly")
        slot = beats_per_bar / n
        for i, (root, qual, bass) in enumerate(toks_parsed):
            beat = bar_idx * beats_per_bar + i * slot
            if events and events[-1].root == root and events[-1].quality == qual and events[-1].bass == bass \
                    and abs(events[-1].beat + events[-1].beats - beat) < 1e-6 and i > 0:
                events[-1].beats += slot
            else:
                events.append(ChordEvent(beat=beat, beats=slot, root=root, quality=qual, bass=bass))
        prev_bar = toks_parsed
    return events, len(bars)


def parse_key(name: str) -> tuple[int, str, str]:
    parts = name.strip().split()
    if len(parts) != 2 or parts[0] not in KEY_NAMES or parts[1].lower() not in ("major", "minor"):
        raise SongFormatError(f"Bad key '{name}' (e.g. 'G major', 'A minor', 'Bb major')")
    return KEY_NAMES[parts[0]], parts[1].lower(), f"{parts[0]} {parts[1].lower()}"


def split_syllables(line: str) -> list[tuple[str, int]]:
    """'Twin-kle twin-kle lit-tle star' -> [('Twin',0),('kle',0),('twin',1),...] (syllable, word index)."""
    out: list[tuple[str, int]] = []
    for wi, word in enumerate(line.split()):
        for syl in word.split("-"):
            if syl == "":
                raise SongFormatError(f"Empty syllable in '{word}'")
            out.append((syl, wi))
    return out


def parse_song(text: str, song_id: str) -> SongSpec:
    lines = text.splitlines()
    meta: dict[str, str] = {}
    section = "header"
    chord_text: list[str] = []
    melody_lines: list[str] = []
    for raw in lines:
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            if section == "melody" and melody_lines and melody_lines[-1] != "":
                melody_lines.append("")
            continue
        if section == "header":
            if line.strip() == "chords:":
                section = "chords"
                continue
            if line.strip() == "melody:":
                section = "melody"
                continue
            if ":" not in line:
                raise SongFormatError(f"Header line without ':' -> {line!r}")
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip()
        elif section == "chords":
            if line.strip() == "melody:":
                section = "melody"
                continue
            chord_text.append(line)
        else:
            melody_lines.append(line)

    for required in ("title", "key", "tempo", "meter"):
        if required not in meta:
            raise SongFormatError(f"Missing '{required}:' in header")
    meter = meta["meter"].split("/")
    beats_per_bar, beat_unit = int(meter[0]), int(meter[1])
    tempo = float(meta["tempo"])
    pickup = float(meta.get("pickup", "0"))
    intro_bars = int(meta.get("intro", "1"))
    outro_bars = int(meta.get("outro", "1"))
    tonic, mode, key_name = parse_key(meta["key"])
    chords, chord_bars = parse_chords(" ".join(chord_text), beats_per_bar)
    if not chords:
        raise SongFormatError("No chords")

    # Melody: pairs of (lyric line, note line); blank lines separate verses.
    melody: list[MelodyNote] = []
    words: list[WordSpec] = []
    lyric_lines: list[str] = []
    beat = 0.0
    pending: list[str] = [l for l in melody_lines if l != ""]
    # Optional "= original script words" line between a (romanized) lyric line and its notes.
    groups: list[tuple[str, str | None, str]] = []
    i = 0
    while i < len(pending):
        lyric = pending[i]
        if lyric.startswith("="):
            raise SongFormatError("An '=' line must follow a lyric line")
        if i + 1 < len(pending) and pending[i + 1].startswith("="):
            original = pending[i + 1][1:].strip()
            notes_line = pending[i + 2] if i + 2 < len(pending) else None
            i += 3
        else:
            original = None
            notes_line = pending[i + 1] if i + 1 < len(pending) else None
            i += 2
        if notes_line is None:
            raise SongFormatError(f"Lyric line without notes: '{lyric}'")
        groups.append((lyric, original, notes_line))
    for line_index, (lyric, original, notes_line) in enumerate(groups):
        syllables = split_syllables(lyric)
        lyric_lines.append(" ".join(lyric.split()))
        word_offset = len(words)
        line_words = [WordSpec(text=w.replace("-", ""), line=line_index) for w in lyric.split()]
        if original is not None:
            orig_words = original.split()
            if len(orig_words) != len(line_words):
                raise SongFormatError(f"Line {line_index + 1}: {len(orig_words)} original-script words for {len(line_words)} words")
            for w, o in zip(line_words, orig_words):
                w.original = o
        words.extend(line_words)
        si = 0
        last_voiced: MelodyNote | None = None
        for tok in notes_line.split():
            rest = parse_rest(tok)
            if rest is not None:
                melody.append(MelodyNote(beat=beat, beats=rest, midi=-1, syllable=None, word_index=-1, line=line_index))
                beat += rest
                last_voiced = None
                continue
            midi, dur, tie = parse_pitch(tok)
            if tie:
                if last_voiced is None:
                    raise SongFormatError(f"Line {line_index + 1}: '{tok}' continues a syllable but no note came before it")
                note = MelodyNote(beat=beat, beats=dur, midi=midi, syllable=None, word_index=last_voiced.word_index, line=line_index)
            else:
                if si >= len(syllables):
                    raise SongFormatError(f"Line {line_index + 1} ('{lyric}'): more notes than syllables")
                syl, wi = syllables[si]
                si += 1
                note = MelodyNote(beat=beat, beats=dur, midi=midi, syllable=syl, word_index=word_offset + wi, line=line_index)
            melody.append(note)
            words[note.word_index].notes.append(len(melody) - 1)
            last_voiced = note
            beat += dur
        if si != len(syllables):
            raise SongFormatError(f"Line {line_index + 1} ('{lyric}'): {len(syllables)} syllables but only {si} notes")
    if not melody:
        raise SongFormatError("No melody")

    spec = SongSpec(
        id=song_id, meta=meta, beats_per_bar=beats_per_bar, beat_unit=beat_unit, tempo=tempo, pickup=pickup,
        intro_bars=intro_bars, outro_bars=outro_bars, key_tonic=tonic, key_mode=mode, key_name=key_name,
        chords=chords, chord_bars=chord_bars, melody=melody, words=words, lines=lyric_lines,
    )
    # Sanity checks that catch most typing mistakes.
    total = spec.melody_beats - pickup
    bars = total / beats_per_bar
    if abs(bars - round(bars)) > 1e-6:
        spec.warnings.append(f"melody is {bars:.2f} bars after the pickup (not a whole number of bars)")
    if chord_bars < round(bars):
        spec.warnings.append(f"{chord_bars} chord bars for {bars:.0f} melody bars (chords will repeat)")
    scale = {0, 2, 4, 5, 7, 9, 11} if mode == "major" else {0, 2, 3, 5, 7, 8, 10}
    for n in melody:
        if n.midi >= 0 and ((n.midi - tonic) % 12) not in scale:
            spec.warnings.append(f"note outside {key_name} at beat {n.beat:g} (line {n.line + 1}, '{n.syllable}')")
    return spec


def load_song_file(path: Path) -> SongSpec:
    return parse_song(path.read_text(encoding="utf-8"), path.stem)
