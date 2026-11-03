"""Turns a SongSpec into two MIDI arrangements: a backing track (chords, bass,
light percussion) and a guide melody. Deliberately simple and musical rather
than clever: the point is a pleasant, steady bed to play along to."""
from __future__ import annotations

import random
from dataclasses import dataclass

import pretty_midi

from .dsl import ChordEvent, SongSpec

# General MIDI programs
PIANO, EPIANO, NYLON, STEEL, STRINGS, PAD, VIBES, ACCORDION = 0, 4, 24, 25, 48, 89, 11, 21
ACOUSTIC_BASS, FINGER_BASS = 32, 33
VOICE_OOHS, FLUTE, CLARINET = 53, 73, 71

QUALITY_INTERVALS = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "dim": [0, 3, 6], "dim7": [0, 3, 6, 9], "m7b5": [0, 3, 6, 10], "aug": [0, 4, 8], "sus4": [0, 5, 7],
    "sus2": [0, 2, 7], "7sus4": [0, 5, 7, 10], "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "9": [0, 4, 7, 10, 14],
    "maj9": [0, 4, 7, 11, 14], "m9": [0, 3, 7, 10, 14], "add9": [0, 4, 7, 14],
}


@dataclass
class Style:
    chord_program: int
    bass_program: int
    pattern: str          # "strum", "arp", "block", "waltz", "march", "swing", "latin", "pad"
    drums: str            # "none", "soft", "folk", "waltz", "swing", "latin", "march"
    chord_velocity: int = 62
    bass_velocity: int = 70


STYLES: dict[str, Style] = {
    "folk": Style(STEEL, ACOUSTIC_BASS, "strum", "folk"),
    "ballad": Style(PIANO, ACOUSTIC_BASS, "arp", "soft", chord_velocity=58),
    "waltz": Style(PIANO, ACOUSTIC_BASS, "waltz", "waltz"),
    "march": Style(PIANO, ACOUSTIC_BASS, "march", "march", chord_velocity=66),
    "swing": Style(PIANO, ACOUSTIC_BASS, "swing", "swing"),
    "latin": Style(NYLON, ACOUSTIC_BASS, "latin", "latin"),
    "lullaby": Style(EPIANO, ACOUSTIC_BASS, "arp", "none", chord_velocity=50, bass_velocity=52),
    "hymn": Style(STRINGS, ACOUSTIC_BASS, "pad", "none", chord_velocity=56, bass_velocity=58),
    "pad": Style(PAD, FINGER_BASS, "pad", "soft", chord_velocity=54),
    "lively": Style(STEEL, ACOUSTIC_BASS, "strum", "folk", chord_velocity=70, bass_velocity=76),
    "accordion": Style(ACCORDION, ACOUSTIC_BASS, "block", "waltz", chord_velocity=58),
}


def chord_pitches(ev: ChordEvent, low: int = 52, high: int = 72) -> list[int]:
    """Close voicing of the chord kept between `low` and `high` (E3..C5)."""
    if ev.root is None:
        return []
    ivs = QUALITY_INTERVALS.get(ev.quality, [0, 4, 7])
    pcs = [(ev.root + i) % 12 for i in ivs]
    pitches: list[int] = []
    for pc in pcs:
        p = low + ((pc - low) % 12)
        while p > high:
            p -= 12
        pitches.append(p)
    pitches.sort()
    return pitches


def bass_pitches(ev: ChordEvent) -> tuple[int | None, int | None]:
    """(root, fifth) in the bass register."""
    if ev.root is None:
        return None, None
    root_pc = ev.bass if ev.bass is not None else ev.root
    root = 36 + ((root_pc - 36) % 12)       # C2..B2
    fifth_pc = (ev.root + (6 if ev.quality.startswith("dim") else 7)) % 12
    fifth = 36 + ((fifth_pc - 36) % 12)
    if fifth < root:
        fifth += 12
    return root, fifth


class Arranger:
    def __init__(self, spec: SongSpec):
        self.spec = spec
        self.beat_len = 60.0 / spec.tempo
        self.bar_len = self.beat_len * spec.beats_per_bar
        # The melody's first note starts `pickup` beats before bar 1.
        self.bar1 = spec.intro_bars * self.bar_len
        if spec.pickup > 0 and spec.intro_bars == 0:
            self.bar1 = spec.pickup * self.beat_len
        self.melody_start = self.bar1 - spec.pickup * self.beat_len
        self.style = STYLES.get(spec.meta.get("style", "folk"), STYLES["folk"])
        self.rng = random.Random(spec.id)

    # ---- timeline --------------------------------------------------------
    def chord_timeline(self) -> list[tuple[float, float, ChordEvent]]:
        """[(start_s, end_s, chord)] from t=0 to the end of the outro."""
        spec = self.spec
        bars_needed = max(1, int(round((spec.melody_beats - spec.pickup) / spec.beats_per_bar + 0.49)))
        events: list[tuple[float, float, ChordEvent]] = []
        first = spec.chords[0]
        intro_chords = spec.meta.get("intro_chords")
        if self.bar1 > 0:
            if intro_chords:
                from .dsl import parse_chords
                evs, _ = parse_chords(intro_chords, spec.beats_per_bar)
                for ev in evs:
                    events.append((ev.beat * self.beat_len, (ev.beat + ev.beats) * self.beat_len, ev))
            else:
                events.append((0.0, self.bar1, first))
        bar = 0
        while bar < bars_needed:
            for ev in spec.chords:
                start_beat = bar * spec.beats_per_bar + ev.beat
                if start_beat >= bars_needed * spec.beats_per_bar:
                    break
                s = self.bar1 + start_beat * self.beat_len
                events.append((s, s + ev.beats * self.beat_len, ev))
            bar += spec.chord_bars
        end = self.bar1 + bars_needed * self.bar_len
        # outro: hold the last chord (or the first chord if the song ends on the dominant)
        final = spec.chords[-1] if (spec.chords[-1].root == spec.key_tonic) else first
        outro = max(0, spec.outro_bars)
        if outro:
            events.append((end, end + outro * self.bar_len, final))
            end += outro * self.bar_len
        self.end = end
        return events

    # ---- backing ----------------------------------------------------------
    def backing(self) -> pretty_midi.PrettyMIDI:
        spec = self.spec
        pm = pretty_midi.PrettyMIDI(initial_tempo=spec.tempo)
        chords = pretty_midi.Instrument(program=self.style.chord_program, name="chords")
        bass = pretty_midi.Instrument(program=self.style.bass_program, name="bass")
        drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
        timeline = self.chord_timeline()
        for (s, e, ev) in timeline:
            self._chords(chords, s, e, ev)
            self._bass(bass, s, e, ev)
        self._drums(drums, timeline)
        pm.instruments.extend([chords, bass, drums])
        return pm

    def _add(self, inst, pitch, s, e, vel):
        if pitch is None or e - s <= 0.01:
            return
        inst.notes.append(pretty_midi.Note(velocity=max(1, min(127, int(vel))), pitch=int(pitch), start=float(s), end=float(e)))

    def _beats(self, s, e):
        """Beat grid positions inside [s, e) aligned to the song's beat grid."""
        t = s
        out = []
        while t < e - 1e-6:
            out.append(t)
            t += self.beat_len
        return out

    def _chords(self, inst, s, e, ev: ChordEvent):
        pitches = chord_pitches(ev)
        if not pitches:
            return
        st = self.style
        pat = st.pattern
        v = st.chord_velocity
        beats = self._beats(s, e)
        bpb = self.spec.beats_per_bar
        if pat == "pad":
            for p in pitches:
                self._add(inst, p, s, e - 0.03, v)
            return
        if pat == "block":
            for i, b in enumerate(beats):
                pos = self._pos_in_bar(b)
                if self.compound and pos % 3 != 0:
                    continue
                for p in pitches:
                    self._add(inst, p, b, min(e, b + self.beat_len * (3 if self.compound else 1)) - 0.03, v - (0 if pos == 0 else 8))
            return
        if pat == "arp":
            # gentle broken chord in eighths: 1 3 5 8 5 3 ...
            seq = pitches + [pitches[0] + 12] + pitches[::-1][:-1]
            t = s
            i = 0
            while t < e - 1e-6:
                p = seq[i % len(seq)]
                self._add(inst, p, t, min(e, t + self.beat_len * 0.5) + 0.05, v - (0 if i % 2 == 0 else 10) + self.rng.randint(-3, 3))
                t += self.beat_len * 0.5
                i += 1
            return
        if pat == "waltz":
            for i, b in enumerate(beats):
                pos = self._pos_in_bar(b)
                if self.compound:
                    if pos % 3 != 0:
                        for p in pitches:
                            self._add(inst, p, b + 0.01, b + self.beat_len * 0.8, v - 10)
                elif pos != 0:
                    for p in pitches:
                        self._add(inst, p, b + 0.01, b + self.beat_len * 0.8, v - 6)
            return
        if pat == "march":
            for b in beats:
                pos = self._pos_in_bar(b)
                vel = v if pos % 2 == 1 else v - 14
                for p in pitches:
                    self._add(inst, p, b + (0.0 if pos % 2 == 1 else 0.01), b + self.beat_len * 0.6, vel)
            return
        if pat == "swing":
            for b in beats:
                pos = self._pos_in_bar(b)
                if pos % 2 == 1:
                    for p in pitches:
                        self._add(inst, p, b, b + self.beat_len * 0.5, v)
                else:
                    for p in pitches[:2]:
                        self._add(inst, p, b + self.beat_len * 0.66, b + self.beat_len * 0.95, v - 18)
            return
        if pat == "latin":
            # 3-2 style: hits on 1, 2.5, 4 in 4/4 (or 1, 2.5 in 2/4)
            for b in beats:
                pos = self._pos_in_bar(b)
                if pos == 0:
                    self._strum(inst, pitches, b, b + self.beat_len * 0.9, v)
                elif pos == 1:
                    self._strum(inst, pitches, b + self.beat_len * 0.5, b + self.beat_len * 1.4, v - 4)
                elif pos == 3 or (bpb == 2 and pos == 1):
                    self._strum(inst, pitches, b, b + self.beat_len * 0.7, v - 8)
            return
        # strum (folk): down on every beat, lighter on the off-beats, a small eighth before beats 2/4
        for b in beats:
            pos = self._pos_in_bar(b)
            strong = self.strong(pos)
            if self.compound and not strong and pos % 3 != 2:
                continue   # in 6/8: down on 1 and 4, light up-strum on 3 and 6
            self._strum(inst, pitches, b, b + self.beat_len * (0.95 if strong else 0.6), v if strong else v - 12, up=self.compound and not strong)
            if bpb == 4 and pos in (1, 3):
                self._strum(inst, pitches[-2:], b + self.beat_len * 0.5, b + self.beat_len * 0.9, v - 22, up=True)

    def _strum(self, inst, pitches, s, e, v, up=False):
        order = pitches[::-1] if up else pitches
        for i, p in enumerate(order):
            self._add(inst, p, s + i * 0.012, e, v - i * 2)

    def _pos_in_bar(self, t: float) -> int:
        rel = (t - self.bar1) / self.beat_len
        return int(round(rel)) % self.spec.beats_per_bar

    @property
    def compound(self) -> bool:
        """6/8, 9/8, 12/8 written with the eighth as the beat: pulses every 3 beats."""
        return self.spec.beat_unit == 8 and self.spec.beats_per_bar % 3 == 0 and self.spec.beats_per_bar >= 6

    def strong(self, pos: int) -> bool:
        bpb = self.spec.beats_per_bar
        if self.compound:
            return pos % 3 == 0
        return pos == 0 or (bpb == 4 and pos == 2)

    def offbeat(self, pos: int) -> bool:
        if self.compound:
            return pos % 3 != 0
        return not self.strong(pos)

    def _bass(self, inst, s, e, ev: ChordEvent):
        root, fifth = bass_pitches(ev)
        if root is None:
            return
        st = self.style
        v = st.bass_velocity
        beats = self._beats(s, e)
        bpb = self.spec.beats_per_bar
        if st.pattern in ("pad", "arp"):
            self._add(inst, root, s, e - 0.03, v)
            return
        for i, b in enumerate(beats):
            pos = self._pos_in_bar(b)
            nxt = min(e, b + self.beat_len)
            if st.pattern == "waltz":
                if pos == 0:
                    self._add(inst, root, b, b + self.beat_len * 1.8, v)
            elif st.pattern == "swing":
                # walking: root fifth root fifth with the last beat leading
                p = root if pos % 2 == 0 else fifth
                self._add(inst, p, b, nxt - 0.02, v - (0 if pos == 0 else 6))
            elif st.pattern == "latin":
                if pos == 0:
                    self._add(inst, root, b, b + self.beat_len * 1.4, v)
                elif pos == 1:
                    self._add(inst, fifth, b + self.beat_len * 0.5, b + self.beat_len * 1.5, v - 6)
                elif pos == 3:
                    self._add(inst, root, b, nxt - 0.02, v - 8)
            elif self.compound:
                if pos == 0:
                    self._add(inst, root, b, b + self.beat_len * 2.8, v)
                elif pos % 3 == 0:
                    self._add(inst, fifth if bpb == 6 else root, b, b + self.beat_len * 2.8, v - 6)
            else:  # strum / block / march: root on 1, fifth on 3 (or every other beat)
                if pos == 0:
                    self._add(inst, root, b, b + self.beat_len * (1.9 if bpb >= 4 else 0.9), v)
                elif pos == 2 and bpb >= 4:
                    self._add(inst, fifth, b, b + self.beat_len * 1.9, v - 6)
                elif bpb == 2 and pos == 1:
                    self._add(inst, fifth, b, nxt - 0.02, v - 6)

    def _drums(self, inst, timeline):
        kind = self.style.drums
        if kind == "none":
            return
        KICK, SNARE, HAT, RIDE, SHAKER, RIM, TAMB = 36, 38, 42, 51, 70, 37, 54
        t = self.bar1
        end = self.end - self.bar_len * self.spec.outro_bars
        bpb = self.spec.beats_per_bar
        while t < end - 1e-6:
            for pos in range(bpb):
                b = t + pos * self.beat_len
                if self.compound:
                    # 6/8 and 9/8: kick on the pulses, a light hat on every eighth
                    self._add(inst, HAT, b, b + 0.1, 40 if pos % 3 == 0 else 24)
                    if pos == 0:
                        self._add(inst, KICK, b, b + 0.1, 58)
                    elif pos % 3 == 0 and kind not in ("soft", "none"):
                        self._add(inst, SNARE if bpb == 6 else KICK, b, b + 0.1, 42)
                    continue
                if kind == "soft":
                    self._add(inst, SHAKER, b, b + 0.1, 40 if pos == 0 else 30)
                    self._add(inst, SHAKER, b + self.beat_len / 2, b + self.beat_len / 2 + 0.1, 24)
                    if pos in (1, 3):
                        self._add(inst, RIM, b, b + 0.1, 34)
                elif kind == "folk":
                    self._add(inst, HAT, b, b + 0.1, 48 if pos == 0 else 40)
                    self._add(inst, HAT, b + self.beat_len / 2, b + self.beat_len / 2 + 0.1, 28)
                    if pos in (0, 2) or (bpb == 2 and pos == 0):
                        self._add(inst, KICK, b, b + 0.1, 62)
                    if pos in (1, 3) or (bpb == 2 and pos == 1):
                        self._add(inst, SNARE, b, b + 0.1, 46)
                elif kind == "waltz":
                    if pos == 0:
                        self._add(inst, KICK, b, b + 0.1, 56)
                    else:
                        self._add(inst, HAT, b, b + 0.1, 36)
                elif kind == "march":
                    self._add(inst, KICK if pos % 2 == 0 else SNARE, b, b + 0.1, 64 if pos == 0 else 50)
                    self._add(inst, HAT, b + self.beat_len / 2, b + self.beat_len / 2 + 0.1, 30)
                elif kind == "swing":
                    self._add(inst, RIDE, b, b + 0.1, 48)
                    self._add(inst, RIDE, b + self.beat_len * 0.66, b + self.beat_len * 0.66 + 0.1, 30)
                    if pos in (1, 3):
                        self._add(inst, HAT, b, b + 0.1, 40)
                elif kind == "latin":
                    self._add(inst, SHAKER, b, b + 0.1, 42)
                    self._add(inst, SHAKER, b + self.beat_len / 2, b + self.beat_len / 2 + 0.1, 30)
                    if pos == 0:
                        self._add(inst, KICK, b, b + 0.1, 58)
                    if pos == 1:
                        self._add(inst, RIM, b + self.beat_len / 2, b + self.beat_len / 2 + 0.1, 44)
                    if pos == 3:
                        self._add(inst, KICK, b, b + 0.1, 48)
            t += self.bar_len

    # ---- guide melody -------------------------------------------------------
    def guide(self, program: int = VOICE_OOHS) -> pretty_midi.PrettyMIDI:
        pm = pretty_midi.PrettyMIDI(initial_tempo=self.spec.tempo)
        inst = pretty_midi.Instrument(program=program, name="guide")
        for (s, e, midi) in self.melody_times():
            if midi >= 0:
                self._add(inst, midi, s, e - 0.02, 84)
        pm.instruments.append(inst)
        return pm

    def melody_times(self) -> list[tuple[float, float, int]]:
        out = []
        for n in self.spec.melody:
            s = self.melody_start + n.beat * self.beat_len
            out.append((s, s + n.beats * self.beat_len, n.midi))
        return out

    def total_seconds(self) -> float:
        self.chord_timeline()
        return self.end
