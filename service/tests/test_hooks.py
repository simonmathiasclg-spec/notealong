"""Instrumental hooks: where nobody sings, the lead line through the band, its notes and its lines."""
import numpy as np

from notealong.pipeline import hooks
from notealong.pipeline.attach import with_blocks
from notealong.pipeline.runner import add_hooks

FPS = 86.0


def activations(spans, seconds, chords=()):
    """Basic Pitch-like note activations: (frames, 88) with the given (start_s, end_s, midi, strength) notes."""
    act = np.zeros((int(seconds * FPS), 88), np.float32)
    for a, b, m, strength in list(spans) + list(chords):
        act[int(a * FPS):int(b * FPS), m - 21] = strength
    return act


def test_sections_without_singing_are_intro_solo_and_outro():
    voiced = np.zeros(6000, bool)                 # a minute of song
    voiced[1000:2500] = True                      # singing 10 s to 25 s, with a breath in it
    voiced[1800:1850] = False
    voiced[3600:5000] = True                      # and 36 s to 50 s
    voiced[3000:3020] = True                      # a blip of the band leaking into the vocal stem
    sections = hooks.quiet_sections(voiced, [], 60.0)
    assert [s["label"] for s in sections] == ["Intro", "Solo", "Outro"]
    assert sections[0]["start"] == 0.0 and abs(sections[0]["end"] - 9.75) < 0.01
    assert abs(sections[1]["start"] - 25.25) < 0.01 and abs(sections[1]["end"] - 35.75) < 0.01
    assert sections[2]["end"] == 60.0


def test_words_count_as_singing_and_a_song_without_singing_has_no_hooks():
    voiced = np.zeros(3000, bool)
    assert hooks.quiet_sections(voiced, [], 30.0) == []
    voiced[1000:1400] = True
    words = [{"start": 14.0, "end": 22.5}]
    sections = hooks.quiet_sections(voiced, words, 30.0)
    assert [s["label"] for s in sections] == ["Intro", "Outro"]
    assert abs(sections[1]["start"] - 22.75) < 0.01


def test_the_lead_is_the_top_voice_that_carries_on_not_the_chords_under_it():
    tune = [(0.5, 1.5, 72, 0.7), (1.5, 2.5, 74, 0.7), (2.5, 4.0, 76, 0.7), (5.0, 6.0, 72, 0.7)]
    chords = [(0.0, 7.0, 48, 0.9), (0.0, 7.0, 60, 0.8), (0.0, 7.0, 64, 0.8)]      # louder than the tune, and below it
    midi, strength = hooks.lead_path(activations(tune, 7.0, chords))
    at = lambda t: midi[int(t * FPS)]                                              # noqa: E731
    assert [at(1.0), at(2.0), at(3.0), at(5.5)] == [72, 74, 76, 72]
    assert abs(strength[int(1.0 * FPS)] - 0.7) < 1e-6


def test_no_lead_where_nothing_sounds():
    midi, _ = hooks.lead_path(activations([(1.0, 2.0, 70, 0.8)], 4.0))
    assert np.isnan(midi[int(3.0 * FPS)]) and midi[int(1.5 * FPS)] == 70


def curve(spans, seconds):
    n = int(seconds / hooks.HOP) + 1
    midi, strength = np.full(n, np.nan), np.zeros(n)
    for a, b, m, s in spans:
        midi[int(a / hooks.HOP):int(b / hooks.HOP)] = m
        strength[int(a / hooks.HOP):int(b / hooks.HOP)] = s
    return midi, strength


def test_hook_notes_are_held_notes_and_fast_runs_fold_away():
    spans = [(1.0, 2.0, 72, 0.7), (2.0, 2.06, 73, 0.7), (2.06, 3.0, 74, 0.7), (3.0, 4.5, 76, 0.7), (5.0, 6.0, 72, 0.7), (6.0, 7.0, 71, 0.7)]
    midi, strength = curve(spans, 10.0)
    info: dict = {}
    notes = hooks.hook_notes(midi, strength, [{"start": 0.0, "end": 9.0, "label": "Intro"}], info=info)
    assert [n["midi"] for n in notes] == [72, 74, 76, 72, 71]
    assert all(n["hook"] == "Intro" and n["word"] is None for n in notes)
    assert info["sections"][0]["notes"] == 5


def test_a_section_with_no_clear_lead_gives_no_notes():
    weak = [(1.0 + i, 1.8 + i, 60 + (i * 5) % 7, 0.32) for i in range(8)]           # faint: chords, not a lead
    sparse = [(1.0, 1.5, 72, 0.8), (7.0, 7.5, 74, 0.8)]                              # two stabs in twenty seconds
    for spans in (weak, sparse):
        midi, strength = curve(spans, 21.0)
        assert hooks.hook_notes(midi, strength, [{"start": 0.0, "end": 20.0, "label": "Solo"}]) == []


def test_a_faint_note_is_less_sure_than_a_clear_one():
    spans = [(1.0, 2.0, 72, 0.9), (2.0, 3.0, 74, 0.9), (3.0, 4.0, 76, 0.33), (4.0, 5.0, 77, 0.9), (5.0, 6.0, 79, 0.9)]
    midi, strength = curve(spans, 8.0)
    notes = hooks.hook_notes(midi, strength, [{"start": 0.0, "end": 7.0, "label": "Solo"}])
    by_pitch = {n["midi"]: n["confidence"] for n in notes}
    assert by_pitch[76] < by_pitch[72]


def test_hook_lines_are_labelled_and_cut_to_a_readable_length():
    sung = [{"id": "n0", "start": 20.0, "end": 21.0, "midi": 60, "word": "w0", "line": 0}]
    hook = [{"id": f"h{i}", "start": float(i), "end": i + 1.0, "midi": 70, "word": None, "line": -1, "hook": "Intro"} for i in range(15)]
    ooh = [{"id": "n1", "start": 30.0, "end": 31.0, "midi": 62, "word": None, "line": -1}]
    words = [{"id": "w0", "start": 20.0, "end": 21.0, "line": 0}]
    lines = with_blocks(sung + hook + ooh, words, [{"index": 0, "start": 20.0, "end": 21.0}])
    assert [(l["kind"], l["label"]) for l in lines] == [("instrumental", "Intro"), ("instrumental", "Intro"), ("lyric", None), ("instrumental", None)]
    assert hook[0]["line"] == 0 and hook[14]["line"] == 1 and sung[0]["line"] == 2 and ooh[0]["line"] == 3


def test_adding_hooks_keeps_hand_fixed_notes_and_never_overlaps():
    old = [{"id": "h1", "start": 2.0, "end": 3.0, "midi": 65, "word": None, "edited": True, "hook": "Intro"}]
    notes = [dict(old[0], hook=None),                                                    # the hand-fixed hook note, as it comes back
             {"id": "n0", "start": 4.2, "end": 4.4, "midi": 50, "word": None, "edited": False},   # a stray "sung" note inside the hook
             {"id": "n1", "start": 12.0, "end": 13.0, "midi": 60, "word": "w0", "edited": False}]
    fresh = [{"start": float(i), "end": i + 1.0, "midi": 70 + i, "confidence": 0.9, "word": None, "edited": False, "hook": "Intro"} for i in range(1, 6)]
    out = add_hooks(notes, {"notes": fresh, "used": [{"start": 0.0, "end": 8.0, "label": "Intro"}]}, old)
    assert [(n["midi"], n.get("hook")) for n in out] == [(59, "Intro"), (65, "Intro"), (61, "Intro"), (62, "Intro"), (63, "Intro"), (60, None)]   # an octave down, where the tune is sung
    assert len({n["id"] for n in out}) == len(out)


def test_turning_the_lead_down_leaves_the_rest_alone():
    sr = 22050
    t = np.arange(4 * sr) / sr
    lead = sum(np.sin(2 * np.pi * 440 * k * t) / k for k in (1, 2, 3)).astype(np.float32)
    bass = np.sin(2 * np.pi * 98 * t).astype(np.float32)
    midi = np.full(401, 69.0)
    cut = hooks.reduce_lead(np.stack([lead, bass]), sr, midi)
    db = lambda x: 20 * np.log10(np.sqrt(np.mean(x[sr:-sr] ** 2)))                 # noqa: E731
    assert db(cut[0]) - db(lead) < -12
    assert abs(db(cut[1]) - db(bass)) < 0.5
