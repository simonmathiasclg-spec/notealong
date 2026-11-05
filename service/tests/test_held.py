"""Held notes: fragments of one sustained sound are joined, real repeats are kept."""
from notealong.config import DETAIL_LEVELS
from notealong.pipeline.attach import attach_notes
from notealong.pipeline.held import consolidate_held, count_syllables
from notealong.pipeline.onsets import Articulation

P = DETAIL_LEVELS["balanced"]
HOP = 0.01


def art(duration=10.0, onsets=(), dips=()):
    """A flat vocal line with strong onsets at `onsets` and level dips over `dips` [(t0, t1)]."""
    n = int(duration / HOP)
    onset = [0.05] * n
    level = [-6.0] * n
    for t in onsets:
        for k in range(max(0, int(t / HOP) - 1), min(n, int(t / HOP) + 2)):
            onset[k] = 1.2
    for t0, t1 in dips:
        for k in range(int(t0 / HOP), min(n, int(t1 / HOP) + 1)):
            level[k] = -30.0
    return Articulation({"hop": HOP, "onset": onset, "level": level})


def note(i, start, end, midi, word=None):
    return {"id": f"n{i}", "start": start, "end": end, "midi": midi, "confidence": 0.8, "word": word}


def word(i, text, start, end):
    return {"id": f"w{i}", "text": text, "start": start, "end": end, "line": 0}


def midis(notes):
    return [n["midi"] for n in notes]


def test_syllable_counts():
    assert count_syllables("you", "en") == 1
    assert count_syllables("happy", "en") == 2
    assert count_syllables("birthday", "en") == 2
    assert count_syllables("make", "en") == 1
    assert count_syllables("little", "en") == 2
    assert count_syllables("träume", "de") == 2      # the final e is sung in German
    assert count_syllables("こんにちは") == 5
    assert count_syllables("नमस्ते") is None            # unknown: only the audio decides


def test_held_note_split_by_vibrato_becomes_one_note():
    words = [word(1, "you", 1.0, 4.0)]
    notes = [note(1, 1.0, 1.9, 67, "w1"), note(2, 1.95, 2.8, 67, "w1"), note(3, 2.86, 4.0, 67, "w1")]
    rep = consolidate_held(notes, words, P, art())
    assert len(notes) == 1 and notes[0]["start"] == 1.0 and notes[0]["end"] == 4.0
    assert rep["same_pitch"] == 2 and rep["before"] == 3 and rep["after"] == 1


def test_happy_birthday_repeats_are_kept():
    # "hap-py birth-day": the same pitch twice inside each word, soft consonants, no clear onset
    words = [word(1, "happy", 1.0, 2.0), word(2, "birthday", 2.0, 3.0)]
    notes = [note(1, 1.0, 1.48, 60, "w1"), note(2, 1.5, 2.0, 60, "w1"),
             note(3, 2.0, 2.48, 62, "w2"), note(4, 2.5, 3.0, 62, "w2")]
    consolidate_held(notes, words, P, art())
    assert midis(notes) == [60, 60, 62, 62]


def test_same_pitch_on_a_new_word_is_a_new_note():
    words = [word(1, "la", 1.0, 1.5), word(2, "la", 1.5, 2.0), word(3, "la", 2.0, 2.5)]
    notes = [note(1, 1.0, 1.5, 64, "w1"), note(2, 1.5, 2.0, 64, "w2"), note(3, 2.0, 2.5, 64, "w3")]
    consolidate_held(notes, words, P, art())
    assert len(notes) == 3


def test_accent_inside_one_syllable_is_still_one_note():
    # an accent or a change of vowel makes a strong onset, but the sound never breaks: one held note
    words = [word(1, "don't", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.9, 65, "w1"), note(2, 1.9, 3.0, 65, "w1")]
    consolidate_held(notes, words, P, art(onsets=[1.9]))
    assert len(notes) == 1


def test_onset_with_a_small_break_inside_a_word_keeps_the_repeat():
    words = [word(1, "oh", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.9, 65, "w1"), note(2, 2.0, 3.0, 65, "w1")]
    a = art(onsets=[2.0])
    a.level[190:201] = -6.0 - 0.5 * P.dip_min_db      # a shallow dip, not a full closure
    consolidate_held(notes, words, P, a)
    assert len(notes) == 2


def test_clear_onset_without_words_keeps_the_repeat():
    # nothing was transcribed here ("oh, oh"): the onset is all there is to go by
    notes = [note(1, 1.0, 1.9, 65), note(2, 1.9, 3.0, 65)]
    consolidate_held(notes, [], P, art(onsets=[1.9]))
    assert len(notes) == 2


def test_level_dip_keeps_the_repeat():
    words = [word(1, "ah", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.9, 65, "w1"), note(2, 2.0, 3.0, 65, "w1")]
    consolidate_held(notes, words, P, art(dips=[(1.9, 2.0)]))
    assert len(notes) == 2


def test_long_gap_keeps_the_repeat():
    words = [word(1, "you", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.5, 65, "w1"), note(2, 1.5 + P.held_gap + 0.05, 3.0, 65, "w1")]
    consolidate_held(notes, words, P, art())
    assert len(notes) == 2


def test_wide_vibrato_wobble_is_one_note():
    words = [word(1, "mir", 1.0, 3.5)]
    notes = [note(1, 1.0, 2.0, 69, "w1"), note(2, 2.0, 2.12, 70, "w1"), note(3, 2.12, 3.5, 69, "w1")]
    rep = consolidate_held(notes, words, P, art())
    assert midis(notes) == [69] and notes[0]["end"] == 3.5 and rep["wobbles"] == 1


def test_scoop_and_tail_bends_are_absorbed():
    words = [word(1, "hold", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.14, 65, "w1"), note(2, 1.14, 2.8, 66, "w1"), note(3, 2.8, 2.95, 65, "w1")]
    rep = consolidate_held(notes, words, P, art())
    assert midis(notes) == [66] and notes[0]["start"] == 1.0 and notes[0]["end"] == 2.95 and rep["bends"] == 2


def test_real_melody_steps_are_not_bends():
    # a real three-note run on one syllable: similar lengths, so nothing is a scoop or a tail
    words = [word(1, "glo", 1.0, 2.5)]
    notes = [note(1, 1.0, 1.5, 64, "w1"), note(2, 1.5, 2.0, 65, "w1"), note(3, 2.0, 2.5, 67, "w1")]
    consolidate_held(notes, words, P, art())
    assert midis(notes) == [64, 65, 67]
    # a short note that passes on to the next word's note is a passing note, not a sagging tail
    words = [word(1, "past", 1.0, 2.0), word(2, "me", 2.0, 3.0)]
    notes = [note(1, 1.0, 1.8, 60, "w1"), note(2, 1.8, 2.0, 61, "w1"), note(3, 2.0, 3.0, 62, "w2")]
    consolidate_held(notes, words, P, art())
    assert midis(notes) == [60, 61, 62]


def test_held_note_running_past_its_word_is_joined():
    # the word's timing ends early; the rest of the held note has no word of its own
    words = [word(1, "stay", 1.0, 1.8)]
    notes = [note(1, 1.0, 1.9, 62, "w1"), note(2, 1.93, 3.4, 62, None)]
    consolidate_held(notes, words, P, art())
    assert len(notes) == 1 and notes[0]["end"] == 3.4 and notes[0]["word"] == "w1"


def test_hand_fixed_notes_are_left_alone():
    words = [word(1, "you", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.9, 67, "w1"), dict(note(2, 1.95, 3.0, 67, "w1"), edited=True)]
    consolidate_held(notes, words, P, art())
    assert len(notes) == 2


def test_without_audio_evidence_only_touching_fragments_join():
    words = [word(1, "you", 1.0, 3.0)]
    notes = [note(1, 1.0, 1.5, 67, "w1"), note(2, 1.51, 2.0, 67, "w1"), note(3, 2.1, 3.0, 67, "w1")]
    consolidate_held(notes, words, P, None)
    assert len(notes) == 2


def test_attach_joins_held_notes_and_reports():
    words = [word(1, "hap-py", 1.0, 2.0), word(2, "you", 2.0, 5.0)]
    lines = [{"index": 0, "kind": "lyric", "start": 1.0, "end": 5.0}]
    notes = [{"id": "a", "start": 1.0, "end": 1.5, "midi": 60}, {"id": "b", "start": 1.5, "end": 2.0, "midi": 60},
             {"id": "c", "start": 2.0, "end": 3.4, "midi": 64}, {"id": "d", "start": 3.45, "end": 5.0, "midi": 64}]
    report = {}
    attach_notes(notes, words, lines, art=art(), params=P, language="en", report=report)
    assert [n["id"] for n in notes] == ["a", "b", "c"]
    assert notes[2]["end"] == 5.0 and report["same_pitch"] == 1
