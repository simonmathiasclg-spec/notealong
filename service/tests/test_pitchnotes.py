"""The pitch-curve refinement: right pitch from the stable middle, held notes kept whole, sustain, junk dropped."""
import numpy as np

from notealong.pipeline.pitchnotes import HOP, RefineParams, notes_from_pitch, refine_with_pitch


def curve(spans, n=400):
    """A pitch curve from (start_s, end_s, midi) spans; frames outside them are unvoiced."""
    midi = np.zeros(n, dtype=np.float32)
    conf = np.zeros(n, dtype=np.float32)
    db = np.full(n, -80.0, dtype=np.float32)
    for a, b, m in spans:
        i, j = int(a / HOP), int(b / HOP)
        midi[i:j] = m
        conf[i:j] = 1.0
        db[i:j] = -12.0
    return midi, conf, db


def test_pitch_comes_from_the_stable_middle():
    # a scoop from 60 up to 64, then 64 held: the note is 64, not the scoop
    midi, conf, db = curve([(0.5, 1.5, 64)])
    midi[50:58] = np.linspace(60, 64, 8)
    notes = refine_with_pitch([{"id": "n1", "start": 0.5, "end": 1.5, "midi": 61}], midi, conf, db)
    assert notes[0]["midi"] == 64


def test_a_chopped_held_note_becomes_one_note_and_lasts_as_long_as_the_voice():
    midi, conf, db = curve([(1.0, 3.0, 67)])
    chopped = [{"id": "a", "start": 1.0, "end": 1.6, "midi": 67}, {"id": "b", "start": 1.65, "end": 2.2, "midi": 66},
               {"id": "c", "start": 2.25, "end": 2.6, "midi": 67}]
    notes = refine_with_pitch(chopped, midi, conf, db)
    assert len(notes) == 1
    assert notes[0]["midi"] == 67 and notes[0]["start"] == 1.0 and abs(notes[0]["end"] - 3.0) < 0.02


def test_notes_without_any_pitch_are_dropped_and_edits_are_kept():
    midi, conf, db = curve([(0.5, 1.0, 60)])
    notes = refine_with_pitch([{"id": "a", "start": 0.5, "end": 1.0, "midi": 60}, {"id": "b", "start": 2.0, "end": 2.5, "midi": 72},
                               {"id": "c", "start": 3.0, "end": 3.5, "midi": 50, "edited": True}], midi, conf, db)
    assert [n["id"] for n in notes] == ["a", "c"]


def test_repeated_syllables_stay_apart_when_re_attacked():
    class Art:
        def rearticulated(self, prev_end, next_start, onset_min, dip_min):
            return True
    midi, conf, db = curve([(0.5, 0.9, 62), (0.95, 1.4, 62)])
    notes = refine_with_pitch([{"id": "a", "start": 0.5, "end": 0.9, "midi": 62}, {"id": "b", "start": 0.95, "end": 1.4, "midi": 62}],
                              midi, conf, db, art=Art(), p=RefineParams())
    assert len(notes) == 2


def test_notes_from_pitch_rides_through_vibrato():
    t = np.arange(200) * HOP
    midi = (69 + 0.4 * np.sin(2 * np.pi * 5.5 * t)).astype(np.float32)        # A4 with a wide vibrato for 2 s
    conf = np.ones(200, dtype=np.float32)
    db = np.full(200, -10.0, dtype=np.float32)
    notes = notes_from_pitch(midi, conf, db)
    assert len(notes) == 1 and notes[0]["midi"] == 69 and notes[0]["end"] - notes[0]["start"] > 1.9
