from notealong.pipeline.align import align_words, timed_words_from_pasted, tokenize_pasted
from notealong.pipeline.attach import attach_notes
from notealong.pipeline.lines import build_lines, lines_from_words
from notealong.pipeline.romanize import is_latin_script, romanize_word, romanize_words


def tw(text, start, end, i):
    return {"id": f"w{i}", "text": text, "start": start, "end": end, "confidence": 1.0}


def test_align_exact_and_fuzzy():
    transcribed = [tw(t, i, i + 0.8, i) for i, t in enumerate(["hello", "wrld", "its", "me"])]
    mapping = align_words(["Hello", "world,", "it's", "me"], transcribed)
    assert mapping == [0, 1, None, 3] or mapping == [0, 1, 2, 3]


def test_pasted_lyrics_interpolate_missing():
    transcribed = [tw("one", 0, 0.5, 1), tw("three", 2.0, 2.5, 2)]
    words, breaks = timed_words_from_pasted("One two\nthree", transcribed, 10.0)
    assert [w["text"] for w in words] == ["One", "two", "three"]
    assert words[0]["start"] == 0 and words[2]["start"] == 2.0
    assert 0.5 <= words[1]["start"] < 2.0
    assert breaks == {1, 2}


def test_tokenize_pasted_breaks():
    words, breaks = tokenize_pasted("a b c\n\nd e\n")
    assert words == ["a", "b", "c", "d", "e"] and breaks == {2, 4}


def test_lines_break_on_gap():
    words = [{"text": "a", "start": 0, "end": 0.3}, {"text": "b", "start": 0.4, "end": 0.6},
             {"text": "c", "start": 2.0, "end": 2.3}]
    build_lines(words)
    assert [w["line"] for w in words] == [0, 0, 1]
    assert len(lines_from_words(words)) == 2


def test_attach_notes_and_instrumental_blocks():
    words = [{"id": "w1", "text": "la", "start": 1.0, "end": 1.5, "line": 0},
             {"id": "w2", "text": "la", "start": 1.5, "end": 2.0, "line": 0}]
    lines = lines_from_words(words)
    notes = [{"id": "n1", "start": 0.0, "end": 0.4, "midi": 60},    # before lyrics -> instrumental
             {"id": "n2", "start": 1.0, "end": 1.4, "midi": 62},
             {"id": "n3", "start": 1.45, "end": 1.9, "midi": 64},   # mostly on w2
             {"id": "n4", "start": 5.0, "end": 5.5, "midi": 60}]    # later instrumental block
    all_lines = attach_notes(notes, words, lines)
    assert [n["word"] for n in notes] == [None, "w1", "w2", None]
    assert [l["kind"] for l in all_lines] == ["instrumental", "lyric", "instrumental"]
    assert words[0]["line"] == 1 and notes[0]["line"] == 0 and notes[3]["line"] == 2


def test_romanize():
    assert is_latin_script("hello") and not is_latin_script("नमस्ते")
    assert romanize_word("नमस्ते", "hi").lower().startswith("nama")
    assert romanize_word("안녕", "ko").lower().startswith("an")
    assert romanize_word("привет", "ru").lower().startswith("privet")
    words = [{"text": "hello"}, {"text": "こんにちは"}]
    romanize_words(words, "ja")
    assert words[0]["roman"] is None and words[1]["roman"].startswith("kon")


def test_split_fragments_are_glued_back_to_their_word():
    from notealong.pipeline.lyrics import postprocess_words
    raw = [{"text": "Est", "start": 0.0, "end": 0.2}, {"text": "-ce", "start": 0.2, "end": 0.3}, {"text": "qu", "start": 0.3, "end": 0.4},
           {"text": "'on", "start": 0.4, "end": 0.5}, {"text": "respire", "start": 0.5, "end": 0.9}, {"text": "?", "start": 0.9, "end": 1.0},
           {"text": "it", "start": 2.0, "end": 2.2}, {"text": "'s", "start": 2.2, "end": 2.3}, {"text": "fine", "start": 2.3, "end": 2.6}]
    words = postprocess_words(raw)
    assert [w["text"] for w in words] == ["Est-ce", "qu'on", "respire?", "it's", "fine"]
    assert words[0]["end"] == 0.3 and words[1]["start"] == 0.3
    assert postprocess_words([{"text": "?", "start": 0, "end": 0.1}]) == []


def test_spelled_out_letters_are_joined_into_one_word():
    from notealong.pipeline.lyrics import postprocess_words
    words = [{"text": t, "start": 1 + i * 0.1, "end": 1.08 + i * 0.1} for i, t in enumerate(["D", "I", "W", "A", "R"])]
    words += [{"text": "Sabes", "start": 3.0, "end": 3.4}, {"text": "I", "start": 3.5, "end": 3.6}, {"text": "know", "start": 3.7, "end": 3.9}]
    assert [w["text"] for w in postprocess_words(words)] == ["DIWAR", "Sabes", "I", "know"]
