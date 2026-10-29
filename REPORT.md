# NoteAlong Phase 1 — test report

Date: 28 Oct 2026. Everything below was run on a 4-core Linux CPU box (no GPU); the service ran with
Whisper **base** through the `openai-whisper` backend because that was the only Whisper checkpoint
reachable from this build environment. On a Mac the default is faster-whisper **small**, which is
noticeably more accurate (see "Whisper size" below).

## Done criteria

| Criterion | Status |
|---|---|
| Upload an MP3 and see processing progress | ✅ Library → upload → live step progress with a time estimate (SSE), survives leaving the page |
| Open the player, pick alto sax | ✅ Alto sax preselected on first run; instrument picker grouped by family |
| Change the key | ✅ ±6 semitones; backing + guide vocal re-rendered with Rubber Band, notes shift with it |
| Play along with notes above the right words | ✅ Count-in, word + note highlight, line-by-line scroll, loop, speed, focus mode, shortcuts |
| Fix a wrong note | ✅ Edit mode: move up/down, delete, add; fix a word; undo/redo; saved to `song.json` |
| Export a PDF of the same view | ✅ Print sheet with the current instrument/key/notation (browser "Save as PDF"); MusicXML export opens in MuseScore |
| Synthesized melody test | ✅ `tests/test_pipeline_synth.py`: 14-note "Twinkle" tone → Basic Pitch → cleanup → attach recovers every note (pitch and onset within 60 ms) |
| Unit tests for transposition / range fitting | ✅ `web/src/lib/__tests__/notes.test.ts` (18 tests incl. lines and MusicXML) + 23 Python tests (cleanup, key, alignment, romanization, lines, API) |

Screenshots of the final screens are in `docs/screenshots/`.

## The three real songs

All three come from the JamendoLyrics dataset (Creative Commons), which ships hand-made word timings,
so word timing could be measured instead of eyeballed.

| | Feel (Stripped) — Cortéz | Bad Side — Rxbyn | Baila — Alfonso Lugo |
|---|---|---|---|
| Style | Acoustic pop ballad, clear male vocal, guitar | Fast R&B, runs and ad-libs, dense production | Spanish reggaeton/pop, male vocal, chant intro |
| Length | 4:00 | 3:36 | 3:30 |
| Processing time (CPU) | 3:00 (stems 130 s, notes 14 s, lyrics 37 s) | 2:55 | 2:45 |
| Detected key / tempo | E major (relative of C♯ minor), 103 bpm | G major, 144 bpm | E minor, 89 bpm |
| Notes after cleanup (balanced) | 326, median 0.26 s | 380 | 429 |
| Lyric lines / "no lyrics" blocks | 49 / 10 | 52 / 13 | 47 / 7 |
| Words transcribed vs. ground truth | 352 vs 355 | 384 vs 440 | 295 vs 282 |
| Words matching the real lyrics | 79 % | 65 % | 55 % |
| Word onset error (matched words) | median 0.15 s, 68 % within 0.3 s | median 0.08 s, 87 % within 0.3 s | median 0.12 s, 89 % within 0.3 s |

**Note accuracy** (no hand-made note annotations exist, so each cleaned note was checked against an
independent pitch tracker, pYIN on the vocals stem: "agrees" = the tracker's median pitch during the note
is within half a semitone of the note shown):

| | Feel (Stripped) | Bad Side | Baila |
|---|---|---|---|
| Notes agreeing with pYIN | 97 % | 85 % | 73 % |
| Octave errors | 0 % | 0 % | 9 % |
| Other disagreements | 3 % | 11 % | 14 % |
| Words that got at least one note | 68 % | 63 % | 63 % |

pYIN is itself unreliable on harmonies and chants (Baila's intro, Bad Side's stacked hooks), so the
"other" column is an upper bound on real errors, not a measurement of them. Words without a note are
mostly short function words sung within one held note, which the player shows under the previous word's note.

**How each turned out**

- **Feel (Stripped)** — the best case for notes: a single clear voice gives a clean vocals stem, and
  the melody reads as a sensible line (lots of repeated G♯/A♯ on the alto, which is how the song goes).
  Lyrics are mostly right; Whisper base mangles a few lines ("please don't stand over here" became
  "Don't be a threat toward our friends") and skipped the opening "yeah oh". Whisper's timings
  collapse when it mis-hears a phrase (several words stamped at the same second), which is where the
  1.5 s 90th-percentile error comes from. Pasting the real lyrics fixes the text and keeps the good
  timings.
- **Bad Side** — fast, with runs. The "balanced" level turns most runs into one or two landing notes,
  which is what a beginner wants; "detailed" keeps them. The vocals stem has backing-vocal stacks in
  the hook, and some of those end up as "no lyrics" blocks between lines. Word timing is excellent
  where Whisper got the words (median 80 ms) but it dropped ~15 % of the words in the dense sections.
- **Baila (Spanish)** — language auto-detected as Spanish, romanization not needed (Latin script).
  The chanted intro was transcribed as "abba abba…" (it is a non-lexical chant, so any text is a
  guess); verses are mostly right with the usual slang misses ("swipeaste" → "sube hacer").
  A 12-second stretch of real singing around 0:48–1:00 got no words at all from Whisper base, so its
  notes show as a "no lyrics" block rather than disappearing — the intended fallback.

The non-Latin-script path (Hindi, Korean, Japanese, Chinese, Cyrillic…) could not be exercised on a real
song here because no such song was reachable; romanization is covered by unit tests
(`नमस्ते → namaste`, `안녕 → an…`, `привет → privet`, `こんにちは → kon…`) and the script toggle appears
automatically when most words are non-Latin.

## What works well

- **Stem separation** (Demucs htdemucs) is the strongest link: vocals stems were clean on all three,
  and the backing track is good enough to play along to. It is also 75 % of the processing time.
- **Note cleanup.** Two additions on top of the specified rules made the biggest difference:
  1. a *level gate*: Basic Pitch is insensitive to loudness, so instrument bleed in near-silent parts of
     the vocals stem produced 30 confident "notes" in the guitar intro of *Feel*. They sit 60 dB below
     the sung notes; dropping notes more than 32 dB under the stem's loud parts removes all of them.
  2. the *frame-by-frame lead tracker* (continuity bonus + leap penalty + octave-harmonic bias), which
     keeps a sustained note unbroken when a louder harmony blip overlaps it.
- **Attach step**: same-pitch re-onsets inside one word are joined, repeated notes across words are kept,
  and notes with no word become "no lyrics" blocks instead of vanishing.
- **Player**: readable from a music stand (current line auto-fits the width, 60 px type at 1280 px),
  instant instrument/key/octave/notation changes, count-in at the song's tempo, loop by dragging on the
  bar, remembers everything per song.

## Where transcription is weakest

1. **Whisper size.** Base misses whole phrases on dense mixes and hallucinates over chants/ad-libs; its
   word timestamps collapse when the words are wrong. Use `small` (default on Mac) or `medium`; the
   pipeline is unchanged. The "paste the correct lyrics" path exists precisely because word *text* will
   never be fully right; timing (which is what the player needs) is already good.
2. **Backing vocals and harmonies.** Demucs puts all voices in one stem. Where harmonies are as loud as
   the lead (hooks), the tracker sometimes follows a harmony for a beat. Octave errors are rare thanks
   to the harmonic bias; thirds are the usual mistake. The edit mode is the practical fix today.
3. **Runs and slides.** Basic Pitch segments a run into many 50–120 ms notes; the absorb rule keeps the
   landing note, which is right for beginners but loses ornaments. "Detailed" keeps more of them.
4. **Key detection** is only as good as the melody; confidence is low (0.35–0.5) on songs that sit on a
   few notes. It mainly drives the solfège/sargam tonic and the key name; the display does not depend on it.
5. **Non-lexical vocals** (chants, "oh-oh") get invented words. A "mark as no lyrics" edit would help.

## Which cleanup thresholds to tune first (all in `service/notealong/config.py`)

1. `min_level_db` (−28 / −32 / −38 dB by level). Decides what counts as bleed. If quiet, breathy phrase
   endings disappear, raise toward −40; if guitar/synth ghosts appear in intros, lower toward −25.
2. `min_note_len` (0.18 / 0.12 / 0.07 s). The main "how many notes" knob; 120 ms suits pop at ~100 bpm,
   fast rap/R&B may want 90 ms even at "balanced".
3. `continuity_bonus` and `leap_penalty` in the lead tracker. Raise the bonus if sustained notes break
   up; raise the penalty if the line jumps to harmonies.
4. `min_relative_amp` (0.4 / 0.3 / 0.2). Drops notes much quieter than their neighbours — the second
   defence against harmonies and reverb tails.
5. `octave_bias` (0.6 / 0.5 / 0.4). Prefers the lower of two simultaneous notes an octave apart.
6. `WORD_MIN_LEVEL_DB` (−40 dB): hallucinated words over silence. Together with `vad_filter` in
   faster-whisper this should remove most of them.
7. `ATTACH_TOLERANCE` (0.15 s) and `INSTRUMENTAL_BLOCK_GAP` (1.0 s): how notes snap to words.

## Known gaps and next steps

- Key changes take ~20 s to render the first time (ffmpeg + Rubber Band on a 4-minute song, CPU);
  the player shows "Preparing the new key…" and the neighbouring keys are pre-rendered in the
  background so stepping ±1 afterwards is instant. A browser-side shifter for instant preview is the
  obvious Phase 2 improvement.
- The faster-whisper backend (Mac default) is implemented but was not runnable in this build
  environment (Hugging Face is blocked here), so it was tested only by code review; the openai-whisper
  backend ran the real songs. Both produce the same word structure and share all downstream code.
- Pasted-lyrics alignment uses the transcription's word timings as anchors (fuzzy sequence alignment +
  interpolation). It needs no extra model and inherits Whisper's timing accuracy; a CTC forced aligner
  (torchaudio MMS_FA) would be the upgrade if timing needs to be tighter than ~100 ms.
- PDF export uses the browser's print dialog on a dedicated print page; a server-side PDF would be
  needed for Phase 2 sharing.
