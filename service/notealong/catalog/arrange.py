"""Turns a SongSpec into a band arrangement: a list of parts (one instrument
each, as MIDI) for the backing track, plus a guide melody.

Every style is a small band chosen for the kind of song: a folk song gets an
acoustic guitar, a bass and light percussion; a carol gets strings, bells and a
soft choir; a swing tune gets a walking bass, brushes, piano comping and horn
stabs. The arranger never plays the melody: that is the player's job.

What makes it sound played rather than programmed:
  - an instrumental intro (so the groove and tempo are heard before the first note)
  - voicings that move as little as possible from chord to chord
  - bass lines that walk into the next chord
  - drum fills before each new section and a clear ending
  - small random differences in timing and loudness on every note (seeded per song,
    so a rebuild gives the same track)
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

import pretty_midi

from .dsl import ChordEvent, SongSpec

# General MIDI programs used for the guide melody (kept for build.py)
VOICE_OOHS, FLUTE, CLARINET = 53, 73, 71

QUALITY_INTERVALS = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "dim": [0, 3, 6], "dim7": [0, 3, 6, 9], "m7b5": [0, 3, 6, 10], "aug": [0, 4, 8], "sus4": [0, 5, 7],
    "sus2": [0, 2, 7], "7sus4": [0, 5, 7, 10], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "9": [0, 4, 7, 10, 14],
    "maj9": [0, 4, 7, 11, 14], "m9": [0, 3, 7, 10, 14], "add9": [0, 4, 7, 14],
}

# General MIDI percussion
KICK, RIM, SNARE, CLAP, TOM_FLOOR, HAT, TOM_LOW, HAT_PEDAL, TOM_MID, HAT_OPEN = 36, 37, 38, 39, 41, 42, 45, 44, 47, 46
CRASH, TOM_HIGH, RIDE, TAMB, COWBELL = 49, 50, 51, 54, 56
BONGO_HI, BONGO_LO, CONGA_MUTE, CONGA_HI, CONGA_LO = 60, 61, 62, 63, 64
CABASA, MARACAS, CLAVES, WOOD_HI, WOOD_LO, TRI_MUTE, TRI_OPEN, SHAKER, SLEIGH, CASTANETS = 69, 70, 75, 76, 77, 80, 81, 82, 83, 85
BRUSH_TAP, BRUSH_SLAP, BRUSH_SWIRL = 38, 39, 40      # in the brush kit


@dataclass(frozen=True)
class Sound:
    """One preset in one of the soundfonts ("gu" = GeneralUser GS, "ms" = MuseScore General)."""
    sf: str
    program: int
    bank: int = 0
    drum: bool = False


@dataclass
class Part:
    """One player in the band and how they sit in the mix."""
    name: str
    sound: Sound
    pattern: str                 # method name on Arranger: _p_<pattern>
    role: str                    # bass | comp | comp2 | pad | perc | color: sets the loudness in the mix
    pan: float = 0.0             # -1 (left) .. 1 (right)
    reverb: float = 0.18         # how much of the part is sent to the room
    opts: dict = field(default_factory=dict)


# ---- sounds -----------------------------------------------------------------
STEEL = Sound("gu", 25)
NYLON = Sound("gu", 24)
TWELVE = Sound("gu", 25, bank=8)
MANDOLIN = Sound("gu", 25, bank=16)
UKULELE = Sound("gu", 24, bank=8)
BANJO = Sound("gu", 105)
PIANO = Sound("ms", 0)
MELLOW_PIANO = Sound("ms", 0, bank=8)
EPIANO = Sound("gu", 4)
CELESTA = Sound("gu", 8)
GLOCK = Sound("gu", 9)
MUSIC_BOX = Sound("gu", 10)
MARIMBA = Sound("gu", 12)
TUBULAR = Sound("gu", 14)
ORGAN = Sound("gu", 16)
CHURCH_ORGAN = Sound("ms", 19)
REED_ORGAN = Sound("gu", 20)
ACCORDION = Sound("gu", 21)
ITALIAN_ACCORDION = Sound("gu", 21, bank=8)
UPRIGHT = Sound("gu", 32)
FINGER_BASS = Sound("gu", 33)
PIZZ = Sound("ms", 45)
HARP = Sound("gu", 46)
STRINGS = Sound("ms", 48)
SLOW_STRINGS = Sound("ms", 49)
CHOIR = Sound("gu", 52)
OOHS = Sound("ms", 53)
TUBA = Sound("gu", 58)
HORNS = Sound("gu", 60)
BRASS = Sound("gu", 61)
MUTED_TRUMPET = Sound("gu", 59)
TROMBONE = Sound("gu", 57)
CELLO = Sound("ms", 42)
CONTRABASS = Sound("ms", 43)
WARM_PAD = Sound("gu", 89)
SITAR = Sound("gu", 104)
KOTO = Sound("gu", 107)
KALIMBA = Sound("gu", 108)
TIMPANI = Sound("ms", 47)
KIT = Sound("gu", 0, drum=True)
ROOM_KIT = Sound("gu", 8, drum=True)
JAZZ_KIT = Sound("gu", 32, drum=True)
BRUSH_KIT = Sound("gu", 40, drum=True)
ORCH_KIT = Sound("gu", 48, drum=True)


def P(name, sound, pattern, role, pan=0.0, reverb=0.18, **opts) -> Part:
    return Part(name, sound, pattern, role, pan, reverb, opts)


@dataclass
class Style:
    parts: list[Part]
    room: str = "room"           # room | hall | chapel | club: the reverb the band plays in
    swing: float = 0.5           # where the off-beat eighth falls inside the beat (0.5 straight, 0.66 swung)
    loose: float = 0.009         # timing looseness in seconds (standard deviation)


STYLES: dict[str, Style] = {
    # acoustic guitar band
    "folk": Style([
        P("guitar", STEEL, "strum", "comp", pan=-0.25),
        P("picking", NYLON, "pick", "comp2", pan=0.3, reverb=0.22),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("percussion", BRUSH_KIT, "drums_light", "perc", reverb=0.12),
    ]),
    "country": Style([
        P("guitar", STEEL, "boom_chick", "comp", pan=-0.3),
        P("banjo", BANJO, "pick", "comp2", pan=0.35, reverb=0.12, roll=True),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("drums", BRUSH_KIT, "drums_train", "perc", reverb=0.1),
    ]),
    "ballad": Style([
        P("piano", PIANO, "piano_ballad", "comp", pan=-0.1, reverb=0.25),
        P("strings", STRINGS, "pad", "pad", pan=0.15, reverb=0.4),
        P("bass", UPRIGHT, "bass_long", "bass", reverb=0.05),
        P("percussion", BRUSH_KIT, "drums_brush_ballad", "perc", reverb=0.2),
    ], room="hall"),
    "waltz": Style([
        P("piano", PIANO, "offbeat", "comp", pan=-0.2, reverb=0.2),
        P("strings", STRINGS, "pad", "pad", pan=0.2, reverb=0.4),
        P("bass", UPRIGHT, "bass_oom", "bass", reverb=0.05),
        P("percussion", BRUSH_KIT, "drums_waltz", "perc", reverb=0.15),
    ], room="hall"),
    "march": Style([
        P("brass", BRASS, "offbeat", "comp", pan=0.2, reverb=0.25, short=True),
        P("horns", HORNS, "pad", "pad", pan=-0.25, reverb=0.3),
        P("tuba", TUBA, "bass_oom", "bass", reverb=0.1, alternate=True),
        P("drums", ORCH_KIT, "drums_march", "perc", reverb=0.2),
    ], room="hall", loose=0.006),
    "swing": Style([
        P("piano", PIANO, "swing_comp", "comp", pan=-0.25, reverb=0.15),
        P("horns", BRASS, "stabs", "color", pan=0.3, reverb=0.25),
        P("bass", UPRIGHT, "bass_walk", "bass", reverb=0.05),
        P("drums", BRUSH_KIT, "drums_swing", "perc", reverb=0.12),
    ], room="club", swing=0.66),
    "latin": Style([
        P("guitar", NYLON, "latin_guitar", "comp", pan=-0.25, reverb=0.15),
        P("second guitar", NYLON, "pick", "comp2", pan=0.3, reverb=0.2),
        P("bass", UPRIGHT, "bass_latin", "bass", reverb=0.05),
        P("percussion", KIT, "drums_latin", "perc", reverb=0.12),
    ]),
    "lullaby": Style([
        P("piano", MELLOW_PIANO, "arp", "comp", pan=-0.1, reverb=0.3, soft=True),
        P("pad", WARM_PAD, "pad", "pad", pan=0.1, reverb=0.45),
        P("music box", MUSIC_BOX, "sparkle", "color", pan=0.3, reverb=0.4),
        P("bass", UPRIGHT, "bass_long", "bass", reverb=0.05),
    ], room="hall", loose=0.012),
    "hymn": Style([
        P("organ", CHURCH_ORGAN, "organ", "comp", reverb=0.45),
        P("strings", STRINGS, "pad", "pad", pan=0.2, reverb=0.45),
        P("pedal", CONTRABASS, "bass_long", "bass", reverb=0.2),
    ], room="chapel", loose=0.005),
    "gospel": Style([
        P("piano", PIANO, "gospel_piano", "comp", pan=-0.25, reverb=0.18),
        P("organ", ORGAN, "organ", "pad", pan=0.25, reverb=0.3, rhythmic=True),
        P("bass", FINGER_BASS, "bass_two", "bass", reverb=0.05, walkups=True),
        P("drums", ROOM_KIT, "drums_gospel", "perc", reverb=0.15),
    ], room="chapel", swing=0.58),
    "carol": Style([
        P("strings", STRINGS, "pad", "comp", pan=-0.15, reverb=0.4, rearticulate=True),
        P("harp", HARP, "arp", "comp2", pan=0.3, reverb=0.35),
        P("choir", CHOIR, "pad", "pad", pan=0.1, reverb=0.5, low=True),
        P("bells", TUBULAR, "bells", "color", pan=-0.3, reverb=0.5),
        P("bass", CONTRABASS, "bass_long", "bass", reverb=0.2, pulse=True),
        P("sleigh bells", ORCH_KIT, "drums_sleigh", "perc", reverb=0.25, gain=-6),
    ], room="chapel", loose=0.007),
    "celtic": Style([
        P("harp", HARP, "arp", "comp", pan=-0.2, reverb=0.3),
        P("guitar", STEEL, "pick", "comp2", pan=0.3, reverb=0.2),
        P("strings", SLOW_STRINGS, "pad", "pad", reverb=0.45, drone=True),
        P("bass", UPRIGHT, "bass_long", "bass", reverb=0.05),
        P("frame drum", KIT, "drums_frame", "perc", reverb=0.25, gain=-2),
    ], room="hall"),
    "shanty": Style([
        P("concertina", ACCORDION, "offbeat", "comp", pan=0.25, reverb=0.2, ands=True),
        P("guitar", STEEL, "strum", "comp2", pan=-0.3),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("stomps", ROOM_KIT, "drums_stomp", "perc", reverb=0.2),
    ], swing=0.6),
    "klezmer": Style([
        P("accordion", ACCORDION, "offbeat", "comp", pan=0.25, reverb=0.18, ands=True),
        P("mandolin", MANDOLIN, "tremolo", "comp2", pan=-0.3, reverb=0.2),
        P("bass", UPRIGHT, "bass_oom", "bass", reverb=0.05, alternate=True),
        P("tambourine", KIT, "drums_tambourine", "perc", reverb=0.15, gain=-4),
    ]),
    "polka": Style([
        P("accordion", ITALIAN_ACCORDION, "offbeat", "comp", pan=0.25, reverb=0.18, ands=True),
        P("guitar", STEEL, "boom_chick", "comp2", pan=-0.3),
        P("tuba", TUBA, "bass_oom", "bass", reverb=0.08, alternate=True),
        P("drums", KIT, "drums_polka", "perc", reverb=0.12),
    ]),
    "italian": Style([
        P("guitar", NYLON, "boom_chick", "comp", pan=0.15, reverb=0.15),
        P("mandolin", MANDOLIN, "tremolo", "comp2", pan=-0.3, reverb=0.2),
        P("accordion", ITALIAN_ACCORDION, "pad", "pad", pan=0.3, reverb=0.25),
        P("bass", UPRIGHT, "bass_oom", "bass", reverb=0.05, alternate=True),
        P("tambourine", KIT, "drums_tambourine", "perc", reverb=0.15, gain=-4),
    ]),
    "asian": Style([
        P("koto", KOTO, "arp", "comp", pan=-0.2, reverb=0.35, open5=True, gain=-1.5),
        P("harp", HARP, "pick", "comp2", pan=0.3, reverb=0.35, open5=True),
        P("strings", SLOW_STRINGS, "pad", "pad", reverb=0.5, open5=True),
        P("bass", CONTRABASS, "bass_long", "bass", reverb=0.15),
        P("woodblock", KIT, "drums_woodblock", "perc", reverb=0.3, gain=-4),
    ], room="hall", loose=0.011),
    "african": Style([
        P("marimba", MARIMBA, "ostinato", "comp", pan=-0.25, reverb=0.2),
        P("kalimba", KALIMBA, "pick", "comp2", pan=0.3, reverb=0.25),
        P("bass", FINGER_BASS, "bass_latin", "bass", reverb=0.05),
        P("hand drums", KIT, "drums_hand", "perc", reverb=0.15, kind="african"),
    ]),
    "indian": Style([
        P("tanpura", SITAR, "tanpura", "comp2", pan=-0.3, reverb=0.4),
        P("harmonium", REED_ORGAN, "pad", "comp", pan=0.2, reverb=0.3, rearticulate=True),
        P("bass", CONTRABASS, "bass_long", "bass", reverb=0.1),
        P("tabla", KIT, "drums_hand", "perc", reverb=0.18, kind="indian"),
    ], room="hall"),
    "arabic": Style([
        P("oud", NYLON, "pick", "comp", pan=-0.2, reverb=0.2, low=True),
        P("strings", STRINGS, "pad", "pad", pan=0.2, reverb=0.4, open5=True),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("darbuka", KIT, "drums_hand", "perc", reverb=0.18, kind="arabic"),
    ]),
    "andean": Style([
        P("charango", UKULELE, "strum", "comp", pan=0.25, reverb=0.18),
        P("guitar", NYLON, "pick", "comp2", pan=-0.3, reverb=0.2),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("bombo", KIT, "drums_bombo", "perc", reverb=0.22),
    ]),
    "children": Style([
        P("ukulele", UKULELE, "strum", "comp", pan=-0.25, reverb=0.15),
        P("glockenspiel", GLOCK, "sparkle", "color", pan=0.3, reverb=0.3, gain=3, busy=True),
        P("pizzicato", PIZZ, "offbeat", "comp2", pan=0.2, reverb=0.25, gain=1.5),
        P("bass", UPRIGHT, "bass_two", "bass", reverb=0.05),
        P("percussion", KIT, "drums_toy", "perc", reverb=0.12, gain=-3),
    ]),
    "orchestral": Style([
        P("strings", STRINGS, "pad", "comp", pan=-0.1, reverb=0.4, rearticulate=True),
        P("pizzicato", PIZZ, "offbeat", "comp2", pan=0.25, reverb=0.3),
        P("horns", HORNS, "pad", "pad", pan=0.2, reverb=0.4, low=True),
        P("basses", CONTRABASS, "bass_two", "bass", reverb=0.2),
        P("timpani", TIMPANI, "timpani", "color", reverb=0.4),
    ], room="hall", loose=0.007),
}
# older style names used by some song files
ALIASES = {"pad": "ballad", "lively": "folk", "accordion": "polka", "slavic": "klezmer"}


def style_for(name: str | None) -> tuple[str, Style]:
    key = (name or "folk").strip().lower()
    key = ALIASES.get(key, key)
    if key not in STYLES:
        key = "folk"
    return key, STYLES[key]


def chord_pcs(ev: ChordEvent) -> list[int]:
    ivs = QUALITY_INTERVALS.get(ev.quality, [0, 4, 7])
    return [(ev.root + i) % 12 for i in ivs]


class Arranger:
    def __init__(self, spec: SongSpec):
        self.spec = spec
        self.style_name, self.style = style_for(spec.meta.get("style"))
        self.rng = random.Random(f"{spec.id}:{self.style_name}")
        self.beat_len = 60.0 / spec.tempo
        self.bpb = spec.beats_per_bar
        self.bar_len = self.beat_len * self.bpb
        # the pulse is what a foot taps: the beat, or three eighths in 6/8, 9/8, 12/8
        self.pulse_beats = 3 if self.compound else 1
        self.pulses = self.bpb // self.pulse_beats
        self.pulse_len = self.pulse_beats * self.beat_len
        self.intro_bars = self._intro_bars()
        self.outro_bars = max(1, spec.outro_bars) if self.bar_len >= 2.0 else max(2, spec.outro_bars)
        # the melody's first note starts `pickup` beats before bar 1
        self.bar1 = self.intro_bars * self.bar_len
        self.melody_start = self.bar1 - spec.pickup * self.beat_len
        self.song_bars = max(1, int(round((spec.melody_beats - spec.pickup) / self.bpb + 0.49)))
        self.end = self.bar1 + (self.song_bars + self.outro_bars) * self.bar_len
        self._timeline = self._build_timeline()
        self._melody = [(s, e) for (s, e, m) in self.melody_times() if m >= 0]

    # ---- shape of the song ---------------------------------------------------
    def _intro_bars(self) -> int:
        """Every song gets an instrumental intro long enough to feel the tempo:
        two bars, or one when a bar is long, or four when bars are very short."""
        if self.spec.meta.get("intro_exact"):
            return max(0, self.spec.intro_bars)
        if self.bar_len >= 3.2:
            return 1
        if self.bar_len * 2 < 2.6:
            return 4
        return 2

    @property
    def compound(self) -> bool:
        """6/8, 9/8, 12/8 written with the eighth as the beat: pulses every 3 beats."""
        return self.spec.beat_unit == 8 and self.spec.beats_per_bar % 3 == 0 and self.spec.beats_per_bar >= 6

    def _build_timeline(self) -> list[tuple[float, float, ChordEvent]]:
        """[(start_s, end_s, chord)] from t=0 to the end of the outro."""
        spec = self.spec
        events: list[tuple[float, float, ChordEvent]] = []
        first = next((c for c in spec.chords if c.root is not None), spec.chords[0])
        intro_chords = spec.meta.get("intro_chords")
        if self.bar1 > 0:
            done = False
            if intro_chords:
                from .dsl import parse_chords
                evs, n_bars = parse_chords(intro_chords, self.bpb)
                if n_bars == self.intro_bars:
                    for ev in evs:
                        events.append((ev.beat * self.beat_len, (ev.beat + ev.beats) * self.beat_len, ev))
                    done = True
            if not done:
                events.append((0.0, self.bar1, first))
        total_beats = self.song_bars * self.bpb
        bar = 0
        while bar < self.song_bars:
            for ev in spec.chords:
                start_beat = bar * self.bpb + ev.beat
                if start_beat >= total_beats:
                    break
                s = self.bar1 + start_beat * self.beat_len
                e = self.bar1 + min(total_beats, start_beat + ev.beats) * self.beat_len
                events.append((s, e, ev))
            bar += spec.chord_bars
        end = self.bar1 + self.song_bars * self.bar_len
        # ending: the home chord, held
        last = events[-1][2]
        final = last if (last.root == spec.key_tonic) else first
        events.append((end, self.end, final))
        return events

    def chord_timeline(self) -> list[tuple[float, float, ChordEvent]]:
        return self._timeline

    def chord_at(self, t: float) -> ChordEvent:
        tl = self._timeline
        lo, hi = 0, len(tl) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if tl[mid][0] <= t + 1e-6:
                lo = mid
            else:
                hi = mid - 1
        return tl[lo][2]

    def next_change(self, t: float) -> tuple[float, ChordEvent] | None:
        """The next moment the harmony moves to a different root after t."""
        cur = self.chord_at(t)
        for (s, _e, ev) in self._timeline:
            if s > t + 1e-6 and ev.root is not None and (ev.root != cur.root or ev.quality != cur.quality):
                return s, ev
        return None

    def bars(self) -> range:
        return range(-self.intro_bars, self.song_bars + self.outro_bars)

    def bar_start(self, bar: int) -> float:
        return self.bar1 + bar * self.bar_len

    def at(self, bar: int, pulse: float, frac: float = 0.0) -> float:
        """Seconds of a position: bar, pulse within the bar, fraction of the pulse."""
        return self.bar1 + bar * self.bar_len + (pulse + frac) * self.pulse_len

    @property
    def off(self) -> float:
        """Where the off-beat falls inside a pulse: the third eighth in 6/8, the swung or straight "and" otherwise."""
        return 2 / 3 if self.compound else self.style.swing

    def is_intro(self, bar: int) -> bool:
        return bar < 0

    def is_ending(self, bar: int) -> bool:
        return bar >= self.song_bars

    def is_fill(self, bar: int) -> bool:
        """The bar that leads into a new section: the last bar of the intro, every eighth bar, the last bar of the song."""
        if bar == -1 or bar == self.song_bars - 1:
            return True
        return bar >= 0 and (bar + 1) % 8 == 0 and bar < self.song_bars - 2

    def melody_resting(self, s: float, e: float) -> bool:
        return not any(ms < e - 0.02 and me > s + 0.02 for ms, me in self._melody)

    def melody_still(self, s: float, e: float) -> bool:
        """No melody note starts between s and e: the melody is resting or holding a long note."""
        return not any(s - 0.04 <= ms <= e for ms, _ in self._melody)

    # ---- small helpers ---------------------------------------------------------
    def _loose(self, t: float, scale: float = 1.0) -> float:
        d = self.rng.gauss(0, self.style.loose * scale)
        return max(0.0, t + max(-0.022, min(0.022, d)))

    def _vel(self, v: float, spread: float = 5) -> int:
        return int(max(8, min(124, round(v + self.rng.gauss(0, spread)))))

    def _add(self, inst, pitch, s, e, vel, loose: float = 1.0):
        if pitch is None or e - s <= 0.015:
            return
        s2 = self._loose(s, loose) if loose else s
        inst.notes.append(pretty_midi.Note(velocity=self._vel(vel, 4 if loose else 0), pitch=int(max(0, min(127, pitch))), start=float(s2), end=float(max(s2 + 0.03, e))))

    def _hit(self, inst, note, t, vel, loose: float = 0.6):
        self._add(inst, note, t, t + 0.12, vel, loose)

    def voicing(self, ev: ChordEvent, lo: int, hi: int, n: int = 3, prev: list[int] | None = None, open5: bool = False) -> list[int]:
        """Close-position chord between lo and hi, the inversion nearest to the previous chord."""
        if ev.root is None:
            return []
        pcs = chord_pcs(ev)
        if open5:                                  # root and fifth only: for tunes that are not harmonised in thirds
            pcs = [pcs[0], pcs[2] if len(pcs) > 2 else (pcs[0] + 7) % 12]
            n = max(n, 3)
        if len(pcs) > n and not open5:             # drop the fifth first, then the root, keep the colour notes
            order = [1, 3, 0, 2, 4][:len(pcs)]
            pcs = [pcs[i] for i in sorted(order[:n])]
        cands = []
        for start in range(lo, hi + 1):
            if start % 12 not in pcs:
                continue
            v = [start]
            p = start
            while len(v) < n:
                p += 1
                if p % 12 in pcs:
                    v.append(p)
                if p > hi + 12:
                    break
            if len(v) == n and v[-1] <= hi + 4:
                cands.append(v)
        if not cands:
            return sorted(lo + ((pc - lo) % 12) for pc in pcs)[:n]
        centre = (lo + hi) / 2
        if prev:
            pc = sum(prev) / len(prev)
            return min(cands, key=lambda v: sum(min(abs(a - b) for b in prev) for a in v) + 0.3 * abs(sum(v) / len(v) - pc) + 0.1 * abs(sum(v) / len(v) - centre))
        return min(cands, key=lambda v: abs(sum(v) / len(v) - centre))

    def bass_note(self, pc: int, lo: int = 31) -> int:
        return lo + ((pc - lo) % 12)

    def bass_tones(self, ev: ChordEvent, lo: int = 31) -> tuple[int, int, int]:
        """(root, fifth, third) in the bass register; the fifth sits above the root unless that is too high."""
        root_pc = ev.bass if ev.bass is not None else ev.root
        root = self.bass_note(root_pc, lo)
        pcs = chord_pcs(ev)
        fifth = root + ((pcs[2] if len(pcs) > 2 else (ev.root + 7)) - root_pc) % 12
        if fifth > lo + 17:
            fifth -= 12
        third = root + (pcs[1] - root_pc) % 12
        if third > lo + 17:
            third -= 12
        return root, fifth, third

    def approach(self, frm: int, target: int) -> int:
        """A leading note into `target`: a scale step below or above it, from the side we are coming from."""
        scale = {0, 2, 4, 5, 7, 9, 11} if self.spec.key_mode == "major" else {0, 2, 3, 5, 7, 8, 10}
        below = frm <= target
        for d in ((-2, -1) if below else (2, 1)):
            p = target + d
            if (p - self.spec.key_tonic) % 12 in scale:
                return p
        return target + (-1 if below else 1)

    def _spans(self, bar: int) -> list[tuple[float, float, ChordEvent]]:
        """The chords of one bar as (start, end, chord)."""
        s0, e0 = self.bar_start(bar), self.bar_start(bar + 1)
        out = []
        for (s, e, ev) in self._timeline:
            if e <= s0 + 1e-6 or s >= e0 - 1e-6:
                continue
            out.append((max(s, s0), min(e, e0), ev))
        return out

    # ---- building the band --------------------------------------------------------
    def band(self) -> list[tuple[Part, pretty_midi.Instrument]]:
        out = []
        for part in self.style.parts:
            inst = pretty_midi.Instrument(program=part.sound.program, is_drum=part.sound.drum, name=part.name)
            getattr(self, f"_p_{part.pattern}")(inst, part)
            inst.notes.sort(key=lambda n: n.start)
            if inst.notes:
                out.append((part, inst))
        return out

    def backing(self) -> pretty_midi.PrettyMIDI:
        """The whole band in one MIDI file (for inspection and tests; rendering goes part by part)."""
        pm = pretty_midi.PrettyMIDI(initial_tempo=self.spec.tempo)
        pm.instruments.extend(inst for _, inst in self.band())
        return pm

    # ================================ patterns ===================================
    # ---- bass ----
    def _bass_ending(self, inst, bar: int) -> bool:
        if not self.is_ending(bar):
            return False
        if bar == self.song_bars:
            root, _, _ = self.bass_tones(self.chord_at(self.bar_start(bar)))
            self._add(inst, root, self.bar_start(bar), self.end - 0.3, 84, 0.5)
        return True

    def _p_bass_two(self, inst, part):
        """Root on the strong pulse, fifth on the next strong one, a walk-up into each new chord."""
        walk = True
        for bar in self.bars():
            if self._bass_ending(inst, bar):
                continue
            strong = [0] if self.pulses <= 3 else [0, 2]
            if self.pulses == 2:
                strong = [0, 1]
            for i, pu in enumerate(strong):
                t = self.at(bar, pu)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                root, fifth, third = self.bass_tones(ev)
                nxt_t = self.at(bar, strong[i + 1]) if i + 1 < len(strong) else self.bar_start(bar + 1)
                pitch = root if (i == 0 or self.chord_at(t - 0.01).root != ev.root) else fifth
                if self.pulses == 3 and bar % 2 == 1 and self.chord_at(self.bar_start(bar - 1)).root == ev.root:
                    pitch = fifth                       # in three: root one bar, fifth the next
                change = self.next_change(t)
                lead = None
                if walk and change and abs(change[0] - nxt_t) < 1e-3 and nxt_t - t >= self.pulse_len * 1.5:
                    target = self.bass_tones(change[1])[0]
                    lead = self.approach(pitch, target)
                hold_to = nxt_t - (self.pulse_len if lead is not None else 0) - 0.04
                self._add(inst, pitch, t, max(t + self.pulse_len * 0.8, hold_to), 86 if i == 0 else 78)
                if lead is not None:
                    self._add(inst, lead, nxt_t - self.pulse_len, nxt_t - 0.04, 74)

    def _p_bass_oom(self, inst, part):
        """One note per bar on the downbeat (two in four): the "oom" of oom-pah."""
        alternate = part.opts.get("alternate", False)
        for bar in self.bars():
            if self._bass_ending(inst, bar):
                continue
            pulses = [0] if self.pulses == 3 else list(range(0, self.pulses, 1 if self.pulses == 2 else 2))
            for i, pu in enumerate(pulses):
                t = self.at(bar, pu)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                root, fifth, _ = self.bass_tones(ev)
                k = i if self.pulses != 3 else bar
                pitch = fifth if (alternate or self.pulses == 3) and k % 2 == 1 and self.chord_at(t - self.pulse_len).root == ev.root else root
                self._add(inst, pitch, t, t + self.pulse_len * (0.9 if self.pulses != 3 else 1.6), 88 if pu == 0 else 80)
            if self.is_fill(bar) and self.pulses >= 3:           # walk into the next section
                nxt = self.chord_at(self.bar_start(bar + 1))
                if nxt.root is not None:
                    target = self.bass_tones(nxt)[0]
                    self._add(inst, self.approach(target - 3, target), self.at(bar, self.pulses - 1), self.bar_start(bar + 1) - 0.04, 76)

    def _p_bass_long(self, inst, part):
        """Sustained roots: one note per chord (re-struck each bar when the part asks for a pulse)."""
        pulse = part.opts.get("pulse", False)
        for bar in self.bars():
            if self._bass_ending(inst, bar):
                continue
            for (s, e, ev) in self._spans(bar):
                if ev.root is None:
                    continue
                root, fifth, _ = self.bass_tones(ev)
                self._add(inst, root, s, e - 0.03, 78, 0.5)
                if pulse and self.pulses >= 3 and e - s >= self.pulse_len * 2.5:
                    mid = s + self.pulse_len * (2 if self.pulses == 4 else 1)
                    inst.notes[-1].end = mid - 0.03
                    self._add(inst, fifth if self.pulses == 4 else root, mid, e - 0.03, 68, 0.5)

    def _p_bass_walk(self, inst, part):
        """Walking bass: a note on every pulse, chord tones first, the last one leading into the next chord."""
        prev = None
        for bar in self.bars():
            if self._bass_ending(inst, bar):
                continue
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                root, fifth, third = self.bass_tones(ev)
                nxt_t = self.at(bar, pu + 1)
                nxt = self.chord_at(nxt_t + 0.01)
                first_of_chord = pu == 0 or self.chord_at(t - 0.01).root != ev.root
                if first_of_chord:
                    pitch = root
                elif nxt.root is not None and (nxt.root != ev.root or pu == self.pulses - 1):
                    target = self.bass_tones(nxt)[0]
                    pitch = self.approach(prev or root, target) if target != (prev or root) else fifth
                else:
                    pitch = [third, fifth, root + 12 if root + 12 <= 50 else fifth][(pu - 1) % 3]
                    if prev is not None and pitch == prev:
                        pitch = fifth if prev != fifth else third
                self._add(inst, pitch, t, nxt_t - 0.03, 88 if pu % 2 == 0 else 80)
                prev = pitch

    def _p_bass_latin(self, inst, part):
        """Root on one, fifth on the "and" of two, an anticipated root at the end of the bar."""
        for bar in self.bars():
            if self._bass_ending(inst, bar):
                continue
            t0 = self.bar_start(bar)
            ev = self.chord_at(t0)
            if ev.root is None:
                continue
            root, fifth, _ = self.bass_tones(ev)
            if self.pulses >= 4:
                self._add(inst, root, t0, self.at(bar, 1, self.off) - 0.04, 88)
                ev2 = self.chord_at(self.at(bar, 1, self.off))
                r2, f2, _ = self.bass_tones(ev2) if ev2.root is not None else (root, fifth, 0)
                self._add(inst, f2, self.at(bar, 1, self.off), self.at(bar, 3) - 0.04, 80)
                nxt = self.chord_at(self.bar_start(bar + 1))
                tgt = self.bass_tones(nxt)[0] if nxt.root is not None else r2
                self._add(inst, tgt, self.at(bar, 3), self.bar_start(bar + 1) - 0.04, 82)
            elif self.pulses == 3:
                self._add(inst, root, t0, self.at(bar, 1) - 0.04, 88)
                self._add(inst, fifth, self.at(bar, 1, self.off), self.at(bar, 2, self.off) - 0.04, 78)
                self._add(inst, root if bar % 2 else fifth, self.at(bar, 2, self.off), self.bar_start(bar + 1) - 0.04, 76)
            else:
                self._add(inst, root, t0, self.at(bar, 0, self.off) - 0.03, 88)
                self._add(inst, fifth, self.at(bar, 0, self.off), self.at(bar, 1, self.off) - 0.03, 80)
                self._add(inst, root, self.at(bar, 1, self.off), self.bar_start(bar + 1) - 0.03, 76)

    # ---- guitars and other plucked chords ----
    def _guitar_chord(self, ev: ChordEvent, low: int = 43, high: int = 67) -> list[int]:
        """A guitar-like spread: root, fifth, root, third, fifth from the lowest root upwards."""
        if ev.root is None:
            return []
        pcs = chord_pcs(ev)
        root = low + ((ev.root - low) % 12)
        out = [root]
        p = root
        want = [pcs[2 % len(pcs)], pcs[0], pcs[1], pcs[2 % len(pcs)]] + ([pcs[3]] if len(pcs) > 3 else [])
        for pc in want:
            p += 1
            while p % 12 != pc:
                p += 1
            if p > high:
                break
            out.append(p)
        if len(pcs) > 3 and pcs[3] not in [x % 12 for x in out]:     # make sure a seventh is heard
            out[-1] = out[-1] - ((out[-1] - pcs[3]) % 12)
        return sorted(set(out))

    def _strum(self, inst, pitches, t, until, vel, up=False, spread=0.014):
        order = pitches[::-1][:4] if up else pitches
        for i, p in enumerate(order):
            self._add(inst, p, t + i * spread, until, vel - i * 2 - (10 if up else 0), 0.4)

    def _strum_shape(self) -> list[tuple[int, float, str]]:
        """(pulse, fraction, stroke) per bar. D = full down-stroke, d = lighter down, U = up-stroke."""
        o = self.off
        fast = self.pulse_len < 0.4
        if self.compound:
            return [x for pu in range(self.pulses) for x in ((pu, 0, "D" if pu == 0 else "d"), (pu, 2 / 3, "U"))]
        if self.pulses == 4:
            return [(0, 0, "D"), (1, 0, "d"), (2, 0, "d"), (3, 0, "d")] + ([] if fast else [(1, o, "U"), (2, o, "U"), (3, o, "U")])
        if self.pulses == 3:
            return [(0, 0, "D"), (1, 0, "d"), (2, 0, "d")] + ([] if fast else [(1, o, "U"), (2, o, "U")])
        return [(0, 0, "D"), (1, 0, "d")] + ([(0, o, "U")] if fast else [(0, o, "U"), (1, o, "U")])

    def _p_strum(self, inst, part):
        high = 72 if part.sound in (UKULELE,) else 67
        low = 55 if part.sound in (UKULELE,) else 43
        shape = sorted(self._strum_shape(), key=lambda x: x[0] + x[1])
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    self._strum(inst, self._guitar_chord(self.chord_at(self.bar_start(bar)), low, high), self.bar_start(bar), self.end - 0.3, 84, spread=0.03)
                continue
            quiet = -8 if self.is_intro(bar) else 0
            for i, (pu, fr, stroke) in enumerate(shape):
                t = self.at(bar, pu, fr)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                nxt = self.at(bar, *shape[i + 1][:2]) if i + 1 < len(shape) else self.bar_start(bar + 1)
                vel = {"D": 80, "d": 68, "U": 60}[stroke] + quiet
                self._strum(inst, self._guitar_chord(ev, low, high), t, nxt + 0.08, vel, up=stroke == "U")

    def _p_boom_chick(self, inst, part):
        """Country and polka guitar: a bass string on the pulse, the chord on the off-beat."""
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    self._strum(inst, self._guitar_chord(self.chord_at(self.bar_start(bar))), self.bar_start(bar), self.end - 0.3, 82, spread=0.03)
                continue
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                chord = self._guitar_chord(ev)
                if self.pulses == 3:
                    if pu == 0:
                        self._add(inst, chord[0] if bar % 2 == 0 else chord[min(1, len(chord) - 1)], t, t + self.pulse_len, 80)
                    else:
                        self._strum(inst, chord[2:], t, t + self.pulse_len * 0.7, 66)
                    continue
                if self.compound:
                    self._add(inst, chord[0] if pu % 2 == 0 else chord[min(1, len(chord) - 1)], t, t + self.pulse_len * 0.6, 80)
                    self._strum(inst, chord[2:], self.at(bar, pu, 2 / 3), self.at(bar, pu + 1) - 0.02, 64)
                    continue
                if self.pulse_len < 0.42 or self.pulses == 4:        # two-beat feel: bass on 1 and 3, chord on 2 and 4
                    if pu % 2 == 0:
                        self._add(inst, chord[0] if (pu // 2) % 2 == 0 else chord[min(1, len(chord) - 1)], t, t + self.pulse_len * 0.9, 80)
                    else:
                        self._strum(inst, chord[2:], t, t + self.pulse_len * 0.6, 68)
                else:                                                  # bass on the beat, chord on the "and"
                    self._add(inst, chord[0] if pu % 2 == 0 else chord[min(1, len(chord) - 1)], t, t + self.pulse_len * 0.5, 80)
                    self._strum(inst, chord[2:], self.at(bar, pu, self.off), self.at(bar, pu + 1) - 0.03, 66)

    def _p_pick(self, inst, part):
        """Finger-picking: the thumb alternates bass strings while the fingers play the upper notes."""
        o = part.opts
        lo, hi = (40, 62) if o.get("low") else (48, 67)
        if part.sound == KALIMBA:
            lo, hi = 60, 84
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    v = self.voicing(self.chord_at(self.bar_start(bar)), lo, hi, 4, prev, o.get("open5", False))
                    for i, p in enumerate(v):
                        self._add(inst, p, self.bar_start(bar) + i * 0.07, self.end - 0.3, 70 - i * 2, 0.3)
                continue
            if self.is_intro(bar) and bar < -1 and self.intro_bars > 1 and part.role == "comp2":
                continue                                   # the second guitar joins for the last bar of the intro
            steps = []
            if self.compound:
                for pu in range(self.pulses):
                    steps += [(pu, 0.0, 0), (pu, 1 / 3, 2), (pu, 2 / 3, 3)]
            elif o.get("roll") and self.pulse_len >= 0.38:        # banjo roll in sixteenths
                for pu in range(self.pulses):
                    steps += [(pu, 0.0, 0), (pu, 0.25, 2), (pu, 0.5, 3), (pu, 0.75, 1)]
            else:
                order = [0, 2, 1, 3]
                for pu in range(self.pulses):
                    steps += [(pu, 0.0, order[(2 * pu) % 4] if pu else 0), (pu, self.off, order[(2 * pu + 1) % 4])]
            for (pu, fr, idx) in steps:
                t = self.at(bar, pu, fr)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                v = self.voicing(ev, lo, hi, 4, prev, o.get("open5", False))
                if len(v) < 2:
                    continue
                prev = v
                p = v[min(idx, len(v) - 1)]
                if idx == 0 and pu % 2 == 1 and len(v) > 2 and fr == 0:
                    p = v[1]                              # alternate the thumb
                self._add(inst, p, t, t + self.pulse_len * 1.4, (72 if fr == 0 else 60) - (6 if self.is_intro(bar) else 0))

    def _p_latin_guitar(self, inst, part):
        """Rumba-style strum: a bass note, then the chord in a syncopated pattern."""
        o = self.off
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    self._strum(inst, self._guitar_chord(self.chord_at(self.bar_start(bar))), self.bar_start(bar), self.end - 0.3, 84, spread=0.035)
                continue
            if self.compound:
                shape = [x for pu in range(self.pulses) for x in ((pu, 0.0, "B"), (pu, 1 / 3, "c"), (pu, 2 / 3, "C"))]
            elif self.pulses == 4:
                shape = [(0, 0, "B"), (0, o, "c"), (1, 0, "C"), (1, o, "c"), (2, 0, "B"), (2, o, "C"), (3, 0, "c"), (3, o, "C")]
            elif self.pulses == 3:
                shape = [(0, 0, "B"), (0, o, "c"), (1, 0, "C"), (1, o, "c"), (2, 0, "C"), (2, o, "c")]
            else:
                shape = [(0, 0, "B"), (0, o, "C"), (1, 0, "c"), (1, o, "C")]
            for i, (pu, fr, kind) in enumerate(shape):
                t = self.at(bar, pu, fr)
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                chord = self._guitar_chord(ev)
                nxt = self.at(bar, *shape[i + 1][:2]) if i + 1 < len(shape) else self.bar_start(bar + 1)
                if kind == "B":
                    self._add(inst, chord[0], t, nxt + 0.1, 82)
                else:
                    self._strum(inst, chord[1:], t, nxt - 0.02 if kind == "c" else nxt + 0.06, 74 if kind == "C" else 58, up=kind == "c", spread=0.01)

    def _p_tremolo(self, inst, part):
        """Mandolin: quick repeated double-stops on the top notes of the chord."""
        prev = None
        div = 3 if self.compound else (4 if self.pulse_len >= 0.5 else 2)
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    v = self.voicing(self.chord_at(self.bar_start(bar)), 62, 81, 3, prev)
                    n = int((self.end - 0.6 - self.bar_start(bar)) / (self.pulse_len / div))
                    for k in range(max(1, n)):
                        tt = self.bar_start(bar) + k * self.pulse_len / div
                        for p in v[-2:]:
                            self._add(inst, p, tt, tt + self.pulse_len / div + 0.03, 66 - min(20, k), 0.3)
                continue
            for pu in range(self.pulses):
                for k in range(div):
                    t = self.at(bar, pu, k / div)
                    ev = self.chord_at(t)
                    if ev.root is None:
                        continue
                    v = self.voicing(ev, 62, 81, 3, prev)
                    prev = v
                    for p in v[-2:]:
                        self._add(inst, p, t, t + self.pulse_len / div + 0.03, (70 if k == 0 else 56) - (6 if self.is_intro(bar) else 0), 0.3)

    # ---- keyboards ----
    def _p_piano_ballad(self, inst, part):
        """Left hand rolls root, fifth and tenth; right hand plays the chord and answers softly."""
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    ev = self.chord_at(self.bar_start(bar))
                    root = self.bass_note(ev.root if ev.bass is None else ev.bass, 36)
                    notes = [root, root + 7] + self.voicing(ev, 52, 69, 3, prev)
                    for i, p in enumerate(notes):
                        self._add(inst, p, self.bar_start(bar) + i * 0.05, self.end - 0.3, 74 - i, 0.3)
                continue
            for (s, e, ev) in self._spans(bar):
                if ev.root is None:
                    continue
                root = self.bass_note(ev.root if ev.bass is None else ev.bass, 36)
                pcs = chord_pcs(ev)
                third = root + 12 + (pcs[1] - ev.root) % 12
                lh = [root, root + 7, root + 12, third]
                v = self.voicing(ev, 52, 69, 3, prev)
                prev = v
                step = self.pulse_len / (3 if self.compound else 2)
                n = max(1, int(round((e - s) / step)))
                for k in range(n):
                    t = s + k * step
                    self._add(inst, lh[k % 4] if k % 8 < 4 else lh[3 - k % 4], t, min(e, t + step * 2.5), 62 if k % 2 == 0 else 52)
                for p in v:
                    self._add(inst, p, s, e - 0.05, 66 - (6 if self.is_intro(bar) else 0), 0.7)
                if e - s >= self.pulse_len * 2.5:                       # answer on a later pulse
                    t2 = s + self.pulse_len * (2 if self.pulses == 4 else 1 if self.pulses == 2 else 2)
                    if t2 < e - 0.1:
                        for p in v[1:]:
                            self._add(inst, p, t2, e - 0.05, 50, 0.7)

    def _p_offbeat(self, inst, part):
        """The "pah" of oom-pah: chords on the off-beats (pulses two and three in a waltz)."""
        o = part.opts
        lo, hi = (50, 67) if part.sound not in (PIZZ, NYLON) else (48, 65)
        short = o.get("short") or part.sound in (PIZZ,)
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    v = self.voicing(self.chord_at(self.bar_start(bar)), lo, hi, 3, prev)
                    for p in v:
                        self._add(inst, p, self.bar_start(bar), self.end - 0.4 if not short else self.bar_start(bar) + self.pulse_len, 80, 0.5)
                continue
            hits: list[tuple[float, float]] = []                 # (time, length in pulses)
            if self.compound:
                hits = [(self.at(bar, pu, f), 0.3) for pu in range(self.pulses) for f in (1 / 3, 2 / 3)]
            elif self.pulses == 3:
                hits = [(self.at(bar, 1), 0.8), (self.at(bar, 2), 0.8)]
            elif o.get("ands") or self.pulses == 2:
                hits = [(self.at(bar, pu, self.off), 0.45) for pu in range(self.pulses)]
            else:
                hits = [(self.at(bar, 1), 0.8), (self.at(bar, 3), 0.8)]
            for (t, ln) in hits:
                ev = self.chord_at(t)
                if ev.root is None:
                    continue
                v = self.voicing(ev, lo, hi, 3, prev)
                prev = v
                for p in v:
                    self._add(inst, p, t, t + self.pulse_len * (0.3 if short else ln), 70 - (6 if self.is_intro(bar) else 0), 0.6)

    def _p_swing_comp(self, inst, part):
        """Jazz piano comping: short syncopated chords, thirds and sevenths on top of the bass."""
        prev = None
        shapes4 = [[(0, 0.0, 0.5), (1, "o", 0.9)], [(0, "o", 0.6), (2, "o", 0.9)], [(1, 0.0, 0.4), (3, 0.0, 0.5)], [(0, 0.0, 0.4), (2, 0.0, 0.4), (3, "o", 0.8)]]
        shapes3 = [[(0, 0.0, 0.5), (1, "o", 0.8)], [(1, 0.0, 0.4), (2, 0.0, 0.5)]]
        shapes2 = [[(0, 0.0, 0.4), (1, "o", 0.5)], [(0, "o", 0.5), (1, 0.0, 0.4)]]
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    v = self.voicing(self.chord_at(self.bar_start(bar)), 52, 72, 4, prev)
                    for i, p in enumerate(v):
                        self._add(inst, p, self.bar_start(bar) + i * 0.02, self.end - 0.4, 82, 0.4)
                continue
            shapes = shapes4 if self.pulses >= 4 else shapes3 if self.pulses == 3 else shapes2
            shape = shapes[self.rng.randrange(len(shapes))] if bar >= 0 else shapes[0]
            for (pu, fr, ln) in shape:
                t = self.at(bar, pu, self.off if fr == "o" else fr)
                ev = self.chord_at(t + 0.02)
                if ev.root is None:
                    continue
                if ev.quality in ("", "m"):                       # give plain triads a sixth or seventh, as a jazz pianist would
                    ev = ChordEvent(ev.beat, ev.beats, ev.root, "6" if ev.quality == "" else "m7", ev.bass)
                v = self.voicing(ev, 52, 68, 3, prev)
                prev = v
                for p in v:
                    self._add(inst, p, t, t + self.pulse_len * ln * 0.6, 82 if fr == 0.0 else 90, 0.7)

    def _p_gospel_piano(self, inst, part):
        """Gospel piano: full chords on the beat, pushes on the off-beats, octaves in the left hand."""
        prev = None
        o = self.off
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    ev = self.chord_at(self.bar_start(bar))
                    root = self.bass_note(ev.root, 36)
                    for i, p in enumerate([root, root + 12] + self.voicing(ev, 52, 70, 4, prev)):
                        self._add(inst, p, self.bar_start(bar) + i * 0.025, self.end - 0.3, 88, 0.3)
                continue
            if self.compound:
                shape = [(pu, f, a) for pu in range(self.pulses) for (f, a) in ((0.0, 1), (2 / 3, 0))]
            elif self.pulses == 4:
                shape = [(0, 0, 1), (1, o, 0), (2, 0, 1), (3, 0, 0), (3, o, 0)] if bar % 2 == 0 else [(0, 0, 1), (1, 0, 0), (2, o, 0), (3, 0, 1)]
            elif self.pulses == 3:
                shape = [(0, 0, 1), (1, o, 0), (2, 0, 0)] if bar % 2 == 0 else [(0, 0, 1), (1, 0, 0), (2, 0, 0), (2, o, 0)]
            else:
                shape = [(0, 0, 1), (0, o, 0), (1, 0, 1), (1, o, 0)]
            for i, (pu, fr, strong) in enumerate(shape):
                t = self.at(bar, pu, fr)
                ev = self.chord_at(t + 0.02)
                if ev.root is None:
                    continue
                nxt = self.at(bar, *shape[i + 1][:2]) if i + 1 < len(shape) else self.bar_start(bar + 1)
                v = self.voicing(ev, 52, 70, 4 if len(chord_pcs(ev)) > 3 else 3, prev)
                prev = v
                for p in v:
                    self._add(inst, p, t, nxt - 0.03, (92 if strong else 76) - (8 if self.is_intro(bar) else 0), 0.7)
                if strong:
                    root = self.bass_note(ev.root if ev.bass is None else ev.bass, 36)
                    self._add(inst, root, t, nxt - 0.03, 76)
                    self._add(inst, root + 12, t, nxt - 0.03, 66)

    def _p_organ(self, inst, part):
        """Held chords. With `rhythmic`, the organ also leans into the back-beats."""
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    for p in self.voicing(self.chord_at(self.bar_start(bar)), 48, 67, 4, prev):
                        self._add(inst, p, self.bar_start(bar), self.end - 0.5, 76, 0.3)
                continue
            for (s, e, ev) in self._spans(bar):
                if ev.root is None:
                    continue
                v = self.voicing(ev, 48, 67, 4 if not part.opts.get("rhythmic") else 3, prev)
                prev = v
                for p in v:
                    self._add(inst, p, s, e - 0.02, 70 - (6 if self.is_intro(bar) else 0), 0.3)

    def _p_pad(self, inst, part):
        """Sustained chords that move by the smallest steps from one harmony to the next."""
        o = part.opts
        lo, hi = (43, 60) if o.get("low") else (48, 65)
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    for p in self.voicing(self.chord_at(self.bar_start(bar)), lo, hi, 3, prev, o.get("open5", False)):
                        self._add(inst, p, self.bar_start(bar) - 0.02, self.end - 0.4, 68, 0.3)
                continue
            if o.get("drone"):
                if bar == -self.intro_bars or (bar >= 0 and bar % 4 == 0):
                    tonic = 48 + (self.spec.key_tonic - 48) % 12
                    until = min(self.bar_start(self.song_bars), self.bar_start(bar + (4 if bar >= 0 else self.intro_bars)))
                    self._add(inst, tonic, self.bar_start(bar), until + 0.1, 58, 0.3)
                    self._add(inst, tonic + 7, self.bar_start(bar), until + 0.1, 52, 0.3)
                continue
            for (s, e, ev) in self._spans(bar):
                if ev.root is None:
                    continue
                v = self.voicing(ev, lo, hi, 3, prev, o.get("open5", False))
                same = prev == v
                prev = v
                if same and inst.notes and not o.get("rearticulate") and abs(inst.notes[-1].end - (s - 0.02 + 0.0)) < 0.2:
                    for n in inst.notes[-len(v):]:
                        n.end = e + 0.04                        # same chord: keep holding instead of bowing again
                    continue
                for p in v:
                    self._add(inst, p, s - 0.02, e + 0.04, 62 - (6 if self.is_intro(bar) else 0), 0.3)

    def _p_arp(self, inst, part):
        """Broken chords over two octaves (harp, koto, a soft piano)."""
        o = part.opts
        soft = o.get("soft", False)
        prev = None
        step = self.pulse_len / (3 if self.compound else 2)
        if not self.compound and self.pulse_len < 0.45:
            step = self.pulse_len
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    v = self.voicing(self.chord_at(self.bar_start(bar)), 48, 67, 3, prev, o.get("open5", False))
                    run = v + [p + 12 for p in v] + [v[0] + 24]
                    for i, p in enumerate(run):
                        self._add(inst, p, self.bar_start(bar) + i * 0.07, self.end - 0.3, 72 - i, 0.3)
                continue
            for (s, e, ev) in self._spans(bar):
                if ev.root is None:
                    continue
                v = self.voicing(ev, 48, 66, 3, prev, o.get("open5", False))
                prev = v
                run = v + [v[0] + 12, v[1] + 12] if len(v) >= 2 else v
                seq = run + run[-2:0:-1]
                n = max(1, int(round((e - s) / step)))
                for k in range(n):
                    t = s + k * step
                    self._add(inst, seq[k % len(seq)], t, t + max(step * 3, self.pulse_len * 1.5), (64 if k % (3 if self.compound else 2) == 0 else 54) - (8 if soft else 0) - (5 if self.is_intro(bar) else 0), 1.2 if soft else 1.0)

    def _p_ostinato(self, inst, part):
        """A repeating marimba figure built from the chord notes, with the off-beats leaned on."""
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    for i, p in enumerate(self.voicing(self.chord_at(self.bar_start(bar)), 55, 76, 3, prev)):
                        self._add(inst, p, self.bar_start(bar) + i * 0.03, self.bar_start(bar) + self.pulse_len * 2, 80, 0.4)
                continue
            div = 3 if self.compound else 2
            figure = [0, 2, 1, 2, 0, 1, 2, 1]
            for pu in range(self.pulses):
                for k in range(div):
                    idx = pu * div + k
                    if not self.compound and idx % 8 in (3,):        # leave a breath in the figure
                        continue
                    t = self.at(bar, pu, k / div if self.compound else (0 if k == 0 else self.off))
                    ev = self.chord_at(t)
                    if ev.root is None:
                        continue
                    v = self.voicing(ev, 57, 76, 3, prev)
                    prev = v
                    self._add(inst, v[figure[idx % 8] % len(v)], t, t + self.pulse_len * 0.5, 74 if k else 66)

    def _p_tanpura(self, inst, part):
        """The drone of Indian music: fifth, upper tonic twice, lower tonic, slowly, over and over."""
        tonic = 48 + (self.spec.key_tonic - 48) % 12
        cycle = [tonic + 7, tonic + 12, tonic + 12, tonic]
        step = max(self.pulse_len, 0.55)
        t = 0.0
        k = 0
        while t < self.end - 1.0:
            self._add(inst, cycle[k % 4], t, min(self.end - 0.3, t + step * 3.5), 62 if k % 4 else 68, 1.5)
            t += step
            k += 1

    # ---- colour ----
    def _p_bells(self, inst, part):
        """A bell on the first beat of every other bar, and a peal at the end."""
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    ev = self.chord_at(self.bar_start(bar))
                    root = 72 + (ev.root - 72) % 12
                    for i, p in enumerate([root, root + 7, root + 12]):
                        self._add(inst, p, self.bar_start(bar) + i * self.pulse_len * 0.5, self.end - 0.2, 78 - i * 4, 0.4)
                continue
            if bar < 0 and bar != -self.intro_bars:
                continue
            if bar % 2 == 0:
                ev = self.chord_at(self.bar_start(bar))
                if ev.root is None:
                    continue
                pcs = chord_pcs(ev)
                pc = pcs[0] if bar % 4 == 0 else pcs[2 % len(pcs)]
                self._add(inst, 67 + (pc - 67) % 12, self.bar_start(bar), self.bar_start(bar) + self.bar_len * 1.5, 66, 0.4)

    def _p_sparkle(self, inst, part):
        """A few high notes of the chord, where the melody is not busy (music box, glockenspiel)."""
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    ev = self.chord_at(self.bar_start(bar))
                    v = self.voicing(ev, 79, 96, 3)
                    for i, p in enumerate(v):
                        self._add(inst, p, self.bar_start(bar) + self.pulse_len * 0.25 * i, self.end - 0.3, 64, 0.4)
                continue
            if self.is_intro(bar):
                ev = self.chord_at(self.bar_start(bar))
                v = self.voicing(ev, 79, 96, 3)
                for pu in range(self.pulses):
                    self._add(inst, v[pu % len(v)], self.at(bar, pu), self.at(bar, pu) + self.pulse_len, 58)
                continue
            if part.opts.get("busy"):                      # a steady chime on the strong pulses (children's band)
                v = self.voicing(self.chord_at(self.bar_start(bar)), 76, 93, 3)
                for k, pu in enumerate([0] if self.pulses <= 3 else [0, 2]):
                    t = self.at(bar, pu)
                    v = self.voicing(self.chord_at(t), 76, 93, 3) or v
                    self._add(inst, v[(bar + k) % len(v)], t, t + self.pulse_len, 60 if pu == 0 else 52)
                continue
            pu = self.pulses - 1
            t = self.at(bar, pu)
            if bar % 2 == 1 and self.melody_still(t - 0.05, t + self.pulse_len):
                v = self.voicing(self.chord_at(t), 79, 96, 3)
                self._add(inst, v[-1], t, t + self.pulse_len, 56)
                self._add(inst, v[0], self.at(bar, pu, self.off), self.at(bar, pu, self.off) + self.pulse_len, 50)
            elif bar % 4 == 0:
                v = self.voicing(self.chord_at(self.bar_start(bar)), 79, 96, 3)
                self._add(inst, v[1 % len(v)], self.bar_start(bar), self.bar_start(bar) + self.pulse_len * 1.5, 50)

    def _p_stabs(self, inst, part):
        """Horn section: short answers where the melody rests, a held chord at the very end."""
        prev = None
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    for p in self.voicing(self.chord_at(self.bar_start(bar)), 58, 77, 4, prev):
                        self._add(inst, p, self.bar_start(bar), self.end - 0.6, 92, 0.4)
                continue
            if bar < -1:
                continue
            last = self.pulses - 1
            t1, t2 = self.at(bar, last - 1, self.off), self.at(bar, last, self.off)
            if (bar % 2 == 1 or self.is_fill(bar)) and self.melody_still(t1 - 0.03, t2 + self.pulse_len * 0.3):
                for (t, ln, vel) in ((t1, 0.25, 84), (t2, 0.3, 94)):
                    ev = self.chord_at(t + 0.02)
                    if ev.root is None:
                        continue
                    if ev.quality in ("", "m"):
                        ev = ChordEvent(ev.beat, ev.beats, ev.root, "6" if ev.quality == "" else "m7", ev.bass)
                    v = self.voicing(ev, 58, 76, 3, prev)
                    prev = v
                    for p in v:
                        self._add(inst, p, t, t + self.pulse_len * ln, vel, 0.5)

    def _p_timpani(self, inst, part):
        tonic = 41 + (self.spec.key_tonic - 41) % 12
        dom = 41 + (self.spec.key_tonic + 7 - 41) % 12
        for bar in self.bars():
            if bar == self.song_bars:
                for k in range(8):                                  # a roll into the final chord
                    self._add(inst, tonic, self.bar_start(bar) - self.pulse_len + k * self.pulse_len / 8, self.bar_start(bar) + 0.2, 50 + k * 5, 0.3)
                self._add(inst, tonic, self.bar_start(bar), self.bar_start(bar) + self.bar_len, 96, 0.3)
            elif self.is_fill(bar) and bar >= 0:
                self._add(inst, dom, self.at(bar, self.pulses - 1), self.bar_start(bar + 1), 72)
            elif bar >= 0 and bar % 4 == 0:
                self._add(inst, tonic, self.bar_start(bar), self.bar_start(bar) + self.pulse_len, 70)

    # ---- percussion ----
    def _fill(self, inst, bar: int, kit: str = "kit"):
        """The last pulse (or two) of a section: a short run that says "here comes the next bit"."""
        last = self.pulses - 1
        div = 3 if self.compound else (4 if self.pulse_len >= 0.55 else 2)
        if kit == "brush":
            seq = [BRUSH_TAP, BRUSH_TAP, BRUSH_SLAP, BRUSH_TAP]
        elif kit == "hand":
            seq = [CONGA_HI, CONGA_HI, CONGA_LO, CONGA_HI]
        elif kit == "march":
            seq = [SNARE, SNARE, SNARE, SNARE]
        else:
            seq = [SNARE, TOM_HIGH, TOM_MID, TOM_LOW]
        start_pulse = last - 1 if (self.pulses >= 4 and self.pulse_len < 0.75) else last
        k = 0
        for pu in range(start_pulse, self.pulses):
            for d in range(div):
                frac = d / div if (self.compound or div == 4) else (0 if d == 0 else self.off)
                self._hit(inst, seq[min(len(seq) - 1, (k * len(seq)) // max(1, (self.pulses - start_pulse) * div))], self.at(bar, pu, frac), 62 + k * 5, 0.4)
                k += 1

    def _crash(self, inst, bar: int, vel: int = 78):
        self._add(inst, CRASH, self.bar_start(bar), self.bar_start(bar) + 1.5, vel, 0.3)

    def _drum_bars(self, inst, kit: str = "kit", crash: bool = True):
        """Yields the bars the groove plays in, handling the ending and the fills."""
        for bar in self.bars():
            if self.is_ending(bar):
                if bar == self.song_bars:
                    if kit == "hand":
                        self._hit(inst, CONGA_LO, self.bar_start(bar), 90, 0.3)
                    elif kit == "brush":
                        self._hit(inst, KICK, self.bar_start(bar), 70, 0.3)
                        self._add(inst, RIDE, self.bar_start(bar), self.bar_start(bar) + 2, 60, 0.3)
                    else:
                        self._hit(inst, KICK, self.bar_start(bar), 88, 0.3)
                        if crash:
                            self._crash(inst, bar, 84)
                continue
            yield bar, self.is_fill(bar)
            if self.is_fill(bar):
                self._fill(inst, bar, kit)
                if crash and bar + 1 < self.song_bars and kit == "kit":
                    self._crash(inst, bar + 1, 70)

    def _p_drums_light(self, inst, part):
        """Brushes and a soft kick: enough to feel the pulse, never in the way."""
        for bar, fill in self._drum_bars(inst, "brush", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                strong = pu == 0 or (self.pulses == 4 and pu == 2)
                if strong:
                    self._hit(inst, KICK, t, 62 if pu == 0 else 52)
                elif not (fill and pu == self.pulses - 1):
                    self._hit(inst, BRUSH_SLAP, t, 50)
                self._hit(inst, SHAKER, t, 44, 0.8)
                if self.compound:
                    self._hit(inst, SHAKER, self.at(bar, pu, 1 / 3), 26, 0.8)
                    self._hit(inst, SHAKER, self.at(bar, pu, 2 / 3), 32, 0.8)
                elif self.pulse_len >= 0.4:
                    self._hit(inst, SHAKER, self.at(bar, pu, self.off), 30, 0.8)

    def _p_drums_train(self, inst, part):
        """Country "train" beat: brushes in steady eighths with the back-beat leaned on."""
        for bar, fill in self._drum_bars(inst, "brush", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                back = (self.pulses == 4 and pu % 2 == 1) or (self.pulses == 2 and pu == 1) or (self.pulses == 3 and pu > 0)
                if not back:
                    self._hit(inst, KICK, t, 66)
                self._hit(inst, BRUSH_SLAP if back else BRUSH_TAP, t, 66 if back else 46)
                if self.compound:
                    self._hit(inst, BRUSH_TAP, self.at(bar, pu, 1 / 3), 34)
                    self._hit(inst, BRUSH_TAP, self.at(bar, pu, 2 / 3), 42)
                else:
                    self._hit(inst, BRUSH_TAP, self.at(bar, pu, self.off), 40)
                    if self.pulse_len >= 0.5:
                        self._hit(inst, BRUSH_TAP, self.at(bar, pu, 0.25), 28)
                        self._hit(inst, BRUSH_TAP, self.at(bar, pu, 0.75), 30)

    def _p_drums_brush_ballad(self, inst, part):
        """A slow brush swirl, a soft kick on one, the back-beat barely tapped. Enters after the intro."""
        for bar, fill in self._drum_bars(inst, "brush", crash=False):
            if bar < -1:
                continue
            self._add(inst, BRUSH_SWIRL, self.bar_start(bar), self.bar_start(bar) + self.bar_len * 0.9, 44, 0.3)
            self._hit(inst, KICK, self.bar_start(bar), 50)
            for pu in range(1, self.pulses):
                if (self.pulses == 4 and pu % 2 == 1) or self.pulses != 4:
                    self._hit(inst, BRUSH_TAP, self.at(bar, pu), 38)

    def _p_drums_waltz(self, inst, part):
        for bar, fill in self._drum_bars(inst, "brush", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                if pu == 0:
                    self._hit(inst, KICK, t, 62)
                    self._add(inst, BRUSH_SWIRL, t, t + self.pulse_len * 0.9, 40, 0.3)
                else:
                    self._hit(inst, BRUSH_TAP, t, 48 if pu == 1 else 44)
                if self.compound:
                    self._hit(inst, HAT_PEDAL, self.at(bar, pu, 2 / 3), 30)

    def _p_drums_march(self, inst, part):
        """Snare drum with rolls, bass drum on the strong beats, a cymbal at each new section."""
        for bar, fill in self._drum_bars(inst, "march"):
            if bar >= 0 and bar % 8 == 0:
                self._crash(inst, bar, 72)
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                strong = pu % 2 == 0 if self.pulses != 3 else pu == 0
                if strong:
                    self._hit(inst, KICK, t, 78, 0.3)
                self._hit(inst, SNARE, t, 62 if not strong else 54, 0.3)
                if self.compound:
                    self._hit(inst, SNARE, self.at(bar, pu, 2 / 3), 46, 0.3)
                else:
                    self._hit(inst, SNARE, self.at(bar, pu, 0.5), 44, 0.3)
                    if pu % 2 == 1 and self.pulse_len >= 0.42:          # the little roll before the beat
                        self._hit(inst, SNARE, self.at(bar, pu, 0.75), 40, 0.3)

    def _p_drums_swing(self, inst, part):
        """Brushes: the ride pattern, the hi-hat closing on two and four, a feathered bass drum."""
        for bar, fill in self._drum_bars(inst, "brush", crash=False):
            self._add(inst, BRUSH_SWIRL, self.bar_start(bar), self.bar_start(bar) + self.bar_len * 0.95, 46, 0.3)
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                back = (pu % 2 == 1) if self.pulses != 3 else pu > 0
                self._hit(inst, RIDE, t, 58 if back else 50)
                if back:
                    self._hit(inst, HAT_PEDAL, t, 54)
                    self._hit(inst, RIDE, self.at(bar, pu, self.off), 42)
                else:
                    self._hit(inst, KICK, t, 40)
                if back and not fill and self.rng.random() < 0.25:
                    self._hit(inst, BRUSH_SLAP, self.at(bar, pu, self.off), 44)

    def _p_drums_gospel(self, inst, part):
        """Kick, a snare back-beat with tambourine, steady hi-hat; a crash at each new section."""
        for bar, fill in self._drum_bars(inst, "kit"):
            if bar < -1:
                # the intro starts on hi-hat alone so the count is clear
                for pu in range(self.pulses):
                    self._hit(inst, HAT, self.at(bar, pu), 52)
                continue
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                back = (pu % 2 == 1) if self.pulses != 3 else pu > 0
                if self.pulses == 3:
                    back = pu == 2
                if not back and (pu == 0 or self.pulses != 3):
                    self._hit(inst, KICK, t, 84 if pu == 0 else 72)
                if back:
                    self._hit(inst, SNARE, t, 78)
                    self._hit(inst, TAMB, t, 58)
                self._hit(inst, HAT, t, 56)
                if self.compound:
                    self._hit(inst, HAT, self.at(bar, pu, 1 / 3), 36)
                    self._hit(inst, HAT, self.at(bar, pu, 2 / 3), 46)
                elif self.pulse_len >= 0.36:
                    self._hit(inst, HAT, self.at(bar, pu, self.off), 42)
                if self.pulses == 4 and pu == 2 and bar % 2 == 1 and not self.compound:
                    self._hit(inst, KICK, self.at(bar, pu, self.off), 62)   # a push into the back-beat

    def _p_drums_latin(self, inst, part):
        """Shaker in eighths, claves, congas, and a light kick."""
        clave = {0: [(0, 0.0), (1, "o"), (3, 0.0)], 1: [(1, 0.0), (2, 0.0)]}          # 3-2 son clave over two bars of four
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                self._hit(inst, MARACAS, t, 56, 0.8)
                if self.compound:
                    self._hit(inst, MARACAS, self.at(bar, pu, 1 / 3), 34, 0.8)
                    self._hit(inst, MARACAS, self.at(bar, pu, 2 / 3), 44, 0.8)
                else:
                    self._hit(inst, MARACAS, self.at(bar, pu, self.off), 42, 0.8)
                if pu == 0:
                    self._hit(inst, KICK, t, 60)
                if self.pulses == 4:
                    if pu == 1:
                        self._hit(inst, CONGA_MUTE, t, 60)
                    if pu == 3:
                        self._hit(inst, CONGA_HI, t, 66)
                        self._hit(inst, CONGA_LO, self.at(bar, pu, self.off), 62)
                elif pu == self.pulses - 1:
                    self._hit(inst, CONGA_HI, t, 62)
                    self._hit(inst, CONGA_LO, self.at(bar, pu, self.off), 58)
                elif pu == 1:
                    self._hit(inst, CONGA_MUTE, t, 56)
            if self.pulses == 4 and bar >= -1:
                for (pu, fr) in clave[bar % 2]:
                    self._hit(inst, CLAVES, self.at(bar, pu, self.off if fr == "o" else fr), 66, 0.4)
            elif bar >= 0:
                self._hit(inst, CLAVES, self.bar_start(bar), 60, 0.4)
                if self.pulses == 3:
                    self._hit(inst, CLAVES, self.at(bar, 1, self.off), 54, 0.4)

    def _p_drums_hand(self, inst, part):
        """Hand drums. "arabic": the maqsum rhythm (dum tek . tek dum . tek .); "indian": a keherwa-like
        cycle; "african": a djembe-style pattern with a bell."""
        kind = part.opts.get("kind", "african")
        low, high, slap = (CONGA_LO, BONGO_HI, CONGA_MUTE) if kind != "indian" else (CONGA_LO, BONGO_HI, BONGO_LO)
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            if self.compound or self.pulses == 3:
                for pu in range(self.pulses):
                    t = self.at(bar, pu)
                    self._hit(inst, low if pu == 0 else slap, t, 82 if pu == 0 else 62)
                    for f in ((1 / 3, 2 / 3) if self.compound else (self.off,)):
                        self._hit(inst, high, self.at(bar, pu, f), 48)
                    if kind == "african":
                        self._hit(inst, COWBELL, t, 46, 0.4)
                continue
            # eight eighths per bar of four (or two bars of two)
            if kind == "arabic":
                cell = "DT-TD-T-"
            elif kind == "indian":
                cell = "DtTtDtTt"
            else:
                cell = "D-tTD-TT"
            eighths = self.pulses * 2
            for k in range(eighths):
                c = cell[(k + (bar % 2) * eighths) % 8 if eighths < 8 else k % 8]
                t = self.at(bar, k // 2, 0 if k % 2 == 0 else self.off)
                if c == "D":
                    self._hit(inst, low, t, 84)
                elif c == "T":
                    self._hit(inst, high, t, 66)
                elif c == "t":
                    self._hit(inst, slap, t, 46)
            if kind == "african":
                for pu in range(self.pulses):
                    self._hit(inst, COWBELL, self.at(bar, pu), 44, 0.4)
                    if pu % 2 == 1:
                        self._hit(inst, COWBELL, self.at(bar, pu, self.off), 36, 0.4)
                self._hit(inst, SHAKER, self.bar_start(bar), 40, 0.8)
            elif kind == "arabic":
                for pu in range(self.pulses):
                    self._hit(inst, TAMB, self.at(bar, pu, self.off), 34, 0.8)

    def _p_drums_stomp(self, inst, part):
        """Sea shanty: boots on the deck and hands clapping the back-beat."""
        for bar, fill in self._drum_bars(inst, "kit", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                back = (pu % 2 == 1) if self.pulses != 3 else pu > 0
                if not back:
                    self._hit(inst, KICK, t, 86)
                    self._hit(inst, TOM_FLOOR, t, 70)
                else:
                    self._hit(inst, CLAP, t, 66)
                    self._hit(inst, TAMB, t, 50)

    def _p_drums_tambourine(self, inst, part):
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                self._hit(inst, TAMB, t, 62 if pu == 0 else 50)
                if self.compound:
                    self._hit(inst, TAMB, self.at(bar, pu, 1 / 3), 34)
                    self._hit(inst, TAMB, self.at(bar, pu, 2 / 3), 44)
                else:
                    self._hit(inst, TAMB, self.at(bar, pu, self.off), 58)
                    if self.pulse_len >= 0.5:
                        self._hit(inst, TAMB, self.at(bar, pu, 0.75), 36)
                if pu == 0:
                    self._hit(inst, KICK, t, 58)

    def _p_drums_polka(self, inst, part):
        for bar, fill in self._drum_bars(inst, "kit"):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                self._hit(inst, KICK, t, 78 if pu == 0 else 66)
                if self.compound:
                    self._hit(inst, SNARE, self.at(bar, pu, 2 / 3), 54)
                    self._hit(inst, HAT, self.at(bar, pu, 1 / 3), 36)
                else:
                    self._hit(inst, SNARE, self.at(bar, pu, self.off), 60)
                self._hit(inst, HAT, t, 46)

    def _p_drums_frame(self, inst, part):
        """A frame drum (bodhran-like): low stroke on one, light strokes after it."""
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            if bar < 0 and bar != -1:
                continue
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                self._hit(inst, TOM_LOW if pu == 0 else TOM_MID, t, 62 if pu == 0 else 40)
                if self.compound:
                    self._hit(inst, TOM_MID, self.at(bar, pu, 2 / 3), 34)
                elif self.pulse_len >= 0.5 and pu % 2 == 1:
                    self._hit(inst, TOM_MID, self.at(bar, pu, self.off), 32)

    def _p_drums_bombo(self, inst, part):
        """Andean bombo: a deep stroke on one, rim strokes answering."""
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                if pu == 0:
                    self._hit(inst, TOM_FLOOR, t, 84)
                else:
                    self._hit(inst, RIM, t, 54)
                    if not self.compound:
                        self._hit(inst, RIM, self.at(bar, pu, self.off), 42)
                self._hit(inst, SHAKER, t, 40, 0.8)

    def _p_drums_woodblock(self, inst, part):
        for bar, fill in self._drum_bars(inst, "hand", crash=False):
            if bar % 2 == 0:
                self._hit(inst, WOOD_LO, self.bar_start(bar), 50)
            if self.pulses >= 3:
                self._hit(inst, WOOD_HI, self.at(bar, self.pulses - 1), 36)
            if bar >= 0 and bar % 8 == 0:
                self._hit(inst, TOM_FLOOR, self.bar_start(bar), 60)

    def _p_drums_sleigh(self, inst, part):
        """Sleigh bells on the pulse for bright carols; a triangle for slow ones."""
        bright = self.pulse_len < 0.62 and not self.compound
        for bar, fill in self._drum_bars(inst, "none", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                if bright:
                    self._hit(inst, SLEIGH, t, 58 if pu % 2 == 0 else 48)
                    self._hit(inst, SLEIGH, self.at(bar, pu, 0.5), 36)
                elif pu == 0 and bar % 2 == 0:
                    self._add(inst, TRI_OPEN, t, t + 1.0, 44, 0.4)

    def _p_drums_toy(self, inst, part):
        """Children's songs: woodblock, triangle and a soft kick, like a classroom band."""
        for bar, fill in self._drum_bars(inst, "none", crash=False):
            for pu in range(self.pulses):
                t = self.at(bar, pu)
                if pu == 0:
                    self._hit(inst, KICK, t, 56)
                    self._add(inst, TRI_OPEN, t, t + 0.6, 40, 0.4)
                else:
                    self._hit(inst, WOOD_HI if pu % 2 else WOOD_LO, t, 46)
                if self.compound:
                    self._hit(inst, SHAKER, self.at(bar, pu, 2 / 3), 32, 0.8)
                elif self.pulse_len >= 0.4:
                    self._hit(inst, SHAKER, self.at(bar, pu, self.off), 34, 0.8)

    # ---- guide melody -----------------------------------------------------------------
    def guide(self, program: int = VOICE_OOHS) -> pretty_midi.PrettyMIDI:
        pm = pretty_midi.PrettyMIDI(initial_tempo=self.spec.tempo)
        inst = pretty_midi.Instrument(program=program, name="guide")
        for (s, e, midi) in self.melody_times():
            if midi >= 0:
                inst.notes.append(pretty_midi.Note(velocity=84, pitch=int(midi), start=float(s), end=float(max(s + 0.03, e - 0.02))))
        pm.instruments.append(inst)
        return pm

    def melody_times(self) -> list[tuple[float, float, int]]:
        out = []
        for n in self.spec.melody:
            s = self.melody_start + n.beat * self.beat_len
            out.append((s, s + n.beats * self.beat_len, n.midi))
        return out

    def total_seconds(self) -> float:
        return self.end
