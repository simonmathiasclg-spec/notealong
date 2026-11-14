"""The sax-friendly melody: one held note per syllable, in the key, legato; plus syllable counts and the key."""
import numpy as np

from notealong.pipeline.saxmelody import HOP, sax_notes
from notealong.pipeline.songkey import detect_song_key
from notealong.pipeline.syllables import count_syllables

C_MAJOR = {"tonic": 0, "mode": "major"}


def curve(spans, seconds=8.0):
    """A pitch curve from (start_s, end_s, midi) spans; frames outside them are unvoiced."""
    n = int(seconds / HOP)
    midi = np.zeros(n, dtype=np.float32)
    conf = np.zeros(n, dtype=np.float32)
    db = np.full(n, -80.0, dtype=np.float32)
    for a, b, m in spans:
        i, j = int(round(a / HOP)), int(round(b / HOP))
        midi[i:j] = m
        conf[i:j] = 1.0
        db[i:j] = -12.0
    return midi, conf, db


def words(*items):
    return [{"id": f"w{i}", "text": t, "start": a, "end": b, "confidence": 1.0} for i, (t, a, b) in enumerate(items)]


def test_syllable_counts():
    assert [count_syllables(w) for w in ("let", "trouble", "wisdom", "times", "loved", "wanted", "everything")] == [1, 2, 2, 1, 1, 2, 3]
    assert count_syllables("despacito", "es") == 4
    assert count_syllables("quiero", "es") == 2
    assert count_syllables("사랑해", "ko") == 3


def test_three_syllables_are_three_held_notes_without_the_scoops():
    # "let it be": E D C, each scooped into from below, the last one with vibrato
    midi, conf, db = curve([(1.0, 1.5, 64), (1.5, 2.0, 62), (2.0, 3.2, 60)])
    midi[100:108] = np.linspace(61.5, 64, 8)                       # scoop into the first note
    midi[150:155] = np.linspace(63.6, 62, 5)                       # slide between notes
    t = np.arange(120)
    midi[200:320] = 60 + 0.35 * np.sin(2 * np.pi * t * HOP * 5.5)  # vibrato
    notes = sax_notes(midi, conf, db, words(("let", 0.95, 1.45), ("it", 1.5, 1.9), ("be", 2.0, 3.1)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [64, 62, 60]
    assert [n["word"] for n in notes] == ["w0", "w1", "w2"]
    # legato: each note lasts until the next one starts
    assert notes[0]["end"] == notes[1]["start"] and notes[1]["end"] == notes[2]["start"]
    assert notes[2]["end"] > 3.0


def test_the_same_pitch_twice_is_two_notes_one_per_syllable():
    midi, conf, db = curve([(1.0, 2.0, 67)])
    notes = sax_notes(midi, conf, db, words(("la", 1.0, 1.5), ("la", 1.5, 2.0)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [67, 67]
    assert abs(notes[1]["start"] - 1.5) < 0.12


def test_a_fast_turn_is_not_a_note_but_a_held_second_pitch_is():
    midi, conf, db = curve([(1.0, 1.6, 64), (1.6, 1.7, 65), (1.7, 2.3, 64), (3.0, 3.8, 67), (3.8, 4.8, 64)])
    notes = sax_notes(midi, conf, db, words(("oh", 1.0, 2.3), ("yeah", 3.0, 4.8)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [64, 67, 64]
    assert [n["word"] for n in notes] == ["w0", "w1", "w1"]


def test_a_short_out_of_key_pitch_moves_into_the_key_but_a_long_centred_one_stays():
    # a quick, flat F# (65.7) in C major is an F or a G sung badly; a long, well-tuned Bb is a real blue note
    spans = [(1.0, 1.6, 64), (1.6, 1.8, 65.7), (1.8, 2.4, 67), (3.0, 4.2, 70), (4.2, 5.0, 67)]
    spans += [(5.4 + 0.4 * i, 5.8 + 0.4 * i, m) for i, m in enumerate((60, 62, 64, 65, 67, 69))]
    midi, conf, db = curve(spans, seconds=9.0)
    ws = words(("a", 1.0, 1.6), ("b", 1.6, 1.8), ("c", 1.8, 2.4), ("d", 3.0, 4.2), ("e", 4.2, 5.0),
               *[(f"x{i}", 5.4 + 0.4 * i, 5.8 + 0.4 * i) for i in range(6)])
    notes = sax_notes(midi, conf, db, ws, key=C_MAJOR)
    by_word = {n["word"]: n for n in notes}
    assert by_word["w1"]["midi"] in (65, 67)
    assert by_word["w3"]["midi"] == 70
    assert by_word["w1"]["confidence"] < by_word["w0"]["confidence"]


def test_singing_without_words_still_gets_held_notes():
    midi, conf, db = curve([(1.0, 2.0, 60), (2.0, 3.0, 64)])
    notes = sax_notes(midi, conf, db, [], key=C_MAJOR)
    assert [n["midi"] for n in notes] == [60, 64]
    assert all(n["word"] is None for n in notes)


def test_hand_fixed_notes_stay():
    midi, conf, db = curve([(1.0, 1.5, 64), (1.5, 2.0, 62)])
    fixed = {"id": "mine", "start": 1.0, "end": 1.5, "midi": 65, "confidence": 1.0, "word": "w0", "line": 0, "edited": True}
    notes = sax_notes(midi, conf, db, words(("let", 1.0, 1.5), ("it", 1.5, 2.0)), key=C_MAJOR, keep=[fixed])
    assert [(n["midi"], n["edited"]) for n in notes] == [(65, True), (62, False)]


def test_key_from_the_whole_song():
    # the singer stays on C major's notes; the chords are C, F, G and A minor
    vocal = np.zeros(12)
    vocal[[0, 2, 4, 5, 7, 9, 11]] = [30, 14, 26, 8, 22, 10, 4]
    chords = [{"start": 4.0 * i, "end": 4.0 * i + 4.0, "root": r, "quality": q} for i, (r, q) in
              enumerate([(0, ""), (7, ""), (9, "m"), (5, ""), (0, ""), (7, ""), (5, ""), (0, "")] * 3)]
    key = detect_song_key(None, None, vocal, chords)
    assert (key["tonic"], key["mode"]) == (0, "major")


def test_a_word_waits_for_its_own_note_when_the_lyric_timing_starts_it_early():
    # the lyric timing puts the second word at the end of the first, long before it is sung: the quick F
    # between the two Es is that word's note and must not be lost
    midi, conf, db = curve([(1.0, 2.5, 64), (2.5, 2.85, 65), (2.85, 3.3, 64), (3.3, 4.0, 62)])
    w = words(("speak", 1.0, 2.0), ("words", 2.0, 2.85), ("of", 2.85, 3.3), ("it", 3.3, 4.0))
    notes = sax_notes(midi, conf, db, w, key=C_MAJOR)
    assert [n["midi"] for n in notes] == [64, 65, 64, 62]
    assert abs(notes[1]["start"] - 2.5) < 0.08


def test_a_syllable_is_not_held_across_a_silence_into_the_next_entry():
    midi, conf, db = curve([(1.0, 1.6, 64), (2.4, 2.9, 62), (2.9, 3.6, 60)])
    notes = sax_notes(midi, conf, db, words(("let", 1.0, 1.5), ("it", 1.5, 2.9), ("be", 2.9, 3.6)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [64, 62, 60]
    assert abs(notes[1]["start"] - 2.4) < 0.08
    assert notes[0]["end"] < 1.8                                   # a real rest, not a note held through it


def test_a_pitch_held_for_a_moment_is_a_note_but_a_slide_through_it_is_not():
    # Melody Lab: on 49 songs the old rule (a second pitch must be held up to half a second) swallowed real
    # notes. A pitch the voice sits on for 0.15 s is a note; one it only passes through (0.06 s) is not.
    midi, conf, db = curve([(1.0, 1.15, 67), (1.15, 2.3, 64), (4.0, 4.06, 62), (4.06, 5.3, 64)])
    notes = sax_notes(midi, conf, db, words(("be", 1.0, 2.3), ("be", 4.0, 5.3)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [67, 64, 64]


def test_a_note_after_a_silence_is_long_enough_to_be_heard():
    # "Let it be": the first note was 0.1 s long and could not be heard. It starts earlier, into the silence.
    midi, conf, db = curve([(2.0, 2.1, 64), (2.1, 2.5, 62), (2.5, 3.5, 60)])
    notes = sax_notes(midi, conf, db, words(("let", 1.9, 2.1), ("it", 2.1, 2.5), ("be", 2.5, 3.5)), key=C_MAJOR)
    assert [n["midi"] for n in notes] == [64, 62, 60]
    assert notes[1]["start"] - notes[0]["start"] >= 0.19 and notes[0]["end"] == notes[1]["start"]


def test_notes_keep_the_sung_timing_and_are_not_moved_onto_the_beat():
    midi, conf, db = curve([(1.04, 1.53, 64), (1.53, 2.04, 62), (2.04, 3.0, 60)])
    beats = [i * 0.5 for i in range(16)]
    notes = sax_notes(midi, conf, db, words(("let", 1.0, 1.5), ("it", 1.5, 2.0), ("be", 2.0, 3.0)), key=C_MAJOR, beats=beats)
    assert [n["midi"] for n in notes] == [64, 62, 60]
    assert abs(notes[0]["start"] - 1.04) < 0.015 and abs(notes[1]["start"] - 1.53) < 0.025
