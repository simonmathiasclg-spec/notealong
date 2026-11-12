# Melody rethink: "sing it like a sax player"

November 2026. The upload pipeline used to transcribe the singer literally and then simplify. It now aims
for what a person writing letter notes would write: one clean note per syllable, held until the next one,
in the right key, on the beat. The old pipeline is still there as the "Detailed" mode.

## What changed, in one paragraph

Words still come from Whisper (or pasted lyrics). Each word is split into syllables, the syllables are
lined up against the singer's pitch curve, and each syllable gets the pitch the singer settles on, not
the slides into and out of it. Notes last until the next syllable starts. The key is found from the whole
song and used to judge doubtful notes. The result for the owner's Let It Be upload went from 387 notes to
299, and from E minor (wrong) to C major.

## How it is measured

Human letter-note transcriptions are the target format, so they are the answer key. For each test song a
human transcription was collected from the web and stored in the gitignored `test-recordings/` folder
(never committed, never shipped). `service/scripts/accuracy/syllable_eval.py` converts them to concert
pitch, finds and undoes any transposition or octave shift, lines them up with the recording by syllable,
and reports:

- **Syllables right**: share of sung syllables whose first note is the right pitch. The main number.
- **Words exact**: share of words where every note matches.
- **Notes per human note**: 1.00 means as many notes as the person wrote. Above 1 is too busy.
- **Key**: the detected key against the known one.
- **Onset error**: median distance between our note start and the answer key's, where the key has timing.

The baseline was recorded with the old pipeline before any change
(`test-recordings/results/melody-rethink/baseline.json`).

## Before and after

| Song | Syllables right | Words exact | Notes per human note | Key before | Key now |
|---|---|---|---|---|---|
| Let It Be | 42% → **72%** | 22% → 66% | 1.03 → 0.96 | E minor (wrong) | C major |
| Just Give Me a Reason | 53% → **68%** | 30% → 58% | 0.81 → 0.95 | G major | G major |
| Despacito | 41% → **60%** | 20% → 43% | 0.53 → 1.03 | D major (wrong) | B minor |
| Someone Like You | 47% → **57%** | 30% → 50% | 1.01 → 0.99 | F# minor (wrong) | A major |
| Perfect | 50% → **64%** | 31% → 62% | 1.15 → 0.88 | Ab major | Ab major |
| Halo | 45% → **57%** | 35% → 49% | 0.71 → 0.89 | A major | A major |
| Shape of You | 41% → **72%** | 34% → 73% | 0.85 → 1.08 | C# minor | C# minor |
| Blinding Lights | 69% → **74%** | 40% → 70% | 0.77 → 0.95 | Bb major (wrong) | F minor |
| Wonderwall | 54% → **74%** | 46% → 71% | 0.80 → 0.95 | A major (wrong) | F# minor |
| Dynamite | 47% → **72%** | 40% → 45% | 0.72 → 1.04 | E major | C# minor (the relative minor, same notes) |

Vivir Mi Vida went from Eb major to C minor (right) and Tum Hi Ho stays in F# minor.

Against the targets in the brief:

- "Let it be" is 3 notes: **met**.
- The right pitches on "let it be": **met in the chorus, one note off in the first verse** (see below).
- 85% of syllables right on Let It Be: **not met, 72%**. See "Remaining problems".
- Clear improvement on Just Give Me a Reason and the popular set: **met** (every song improved, by 5 to
  31 points).
- Right key on every test song: **met**, counting Dynamite's relative minor as right, since it has the
  same notes.

One number got worse: the onset error rose on several songs (Perfect 63 → 92 ms, Halo 52 → 90 ms,
Someone Like You 45 → 55 ms, Blinding Lights 45 → 60 ms). Notes now start where the syllable starts and
are nudged to the beat grid, which is what a written transcription does, but it is further from the
singer's exact timing on songs sung behind the beat.

## The "Let it be" line

Alto sax letters, our own output.

First verse:

- Before: Let **B**, it **A#**, be **B A G# A# A** (7 notes, two of them out of key)
- After: Let **B**, it **B**, be **A** (3 notes; the first should be C#, so one of the three is wrong)

End of the chorus:

- Before: let **C**, it **A**, be **B A**
- After: let **C#**, it **B**, be **A** (right: concert E D C)

## How the sax-friendly melody works

Code: `service/notealong/pipeline/saxmelody.py`, `songkey.py`, `syllables.py`. Tests:
`service/tests/test_saxmelody.py`.

1. **Syllables drive the notes.** Each Whisper word is split into syllables with a small rule-based
   counter per language (English, Spanish and the other Latin-script languages, Korean by character, and
   a vowel-group fallback). No new dependency.
2. **Lining syllables up with the singing.** The pitch curve (FCPE on the vocal stem) is cut into held
   runs: stretches where the pitch stays within about a semitone. A dynamic-programming pass assigns
   every frame of a phrase to a syllable, anchored on Whisper's word times but free to move where the
   singing says otherwise.
3. **One note per syllable.** The note is the pitch of the syllable's longest steady stretch. Scoops at
   the start, falls at the end and vibrato are averaged out.
4. **A second note only for real melisma.** The singer has to move to a new pitch and hold it for about
   0.6 of a beat (never less than 0.18 s, never required to be more than 0.5 s). Fast runs collapse into
   the main note.
5. **Legato.** Each note lasts until the next one starts unless there is a real gap in the singing.
6. **Key from the whole song.** Chroma of the full mix, the chords, and the vocal pitches weighted by
   how long they are held, over the whole song. An out-of-key pitch survives only if it is long (0.45 s
   or more), steady and well centred; otherwise it moves to the nearest in-key neighbour and is marked
   unsure. Genuine blue notes and chromatic notes stay.
7. **Rhythm.** Beats come from the existing beat tracker. A note start within reach of a beat
   subdivision is nudged onto it; others are left alone.
8. **Octave sanity.** A single note an octave away from both neighbours is folded back.
9. **Singing without words** ("ooh", humming) gets the same one-held-note treatment and shows up as
   no-lyric lines, as before.
10. **Hand edits are kept.** Notes the owner fixed by hand stay exactly as they are when a song is
    re-processed.
11. **Confidence.** The amber "unsure" dot is now based on how steady the pitch was, how well it was
    centred on a note, whether it was moved into the key, and how sure Whisper was of the word.

### Decisions

- **Lead vocal only (item 8).** No lead/backing vocal separation model with a clearly commercial licence
  was found. The well-known "karaoke" separation models are community-trained on unlicensed data or have
  no stated licence, so none was added and `catalog/LICENSES.md` is unchanged. Instead the pitch tracker
  follows the predominant voice in the Demucs vocal stem. One alternative was tried: keeping only the
  centre of the stereo vocal stem, on the idea that the lead is centred and the harmonies are panned. It
  helped Just Give Me a Reason (68 → 70%) and Wonderwall (+3) but hurt Let It Be, Someone Like You,
  Despacito and Dynamite (−1 to −3.5), so it was not adopted.
- **Chromatic notes need 0.45 s, not 0.7 s.** The longer threshold scored a little higher on the test
  set but would force more genuine chromatic notes into the key, which the brief rules out.
- **Detailed mode is the old pipeline unchanged.** The setting is stored per song (`settings.melody`).
- **Pipeline version 5.** Existing uploads are re-processed in the background the first time the service
  starts; all 13 songs in the local library have been.

## Remaining problems

- **Let It Be is at 72%, not 85%.** The misses are mostly where Whisper puts a word early or late by a
  syllable, so the right pitch lands on the neighbouring word, and where the human transcription writes
  the tune as it is usually sung rather than as it is sung on this recording.
- **Duets and harmonies.** Just Give Me a Reason is better (53 → 68%) but where both voices sing at the
  same loudness the tracker still sometimes follows the harmony.
- **Onset timing** is slightly worse on songs sung behind the beat (see above).
- **Keys of the Creative Commons library songs changed** on four songs (What Is Love F → Bb major,
  Trombadinha B → E major, Poucet G minor → C minor, Eternity A minor → F# minor). These share most of
  their notes with the old answer and look plausible, but there is no answer key for them, so they are
  unverified.
