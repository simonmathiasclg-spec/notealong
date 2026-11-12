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
- **Pipeline version 5 (now 6, see Part 4).** Existing uploads are re-processed in the background the first time the service
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

## Part 2: playback that sounds like a singer

"Hear it played" now phrases the sax-friendly melody legato (`web/src/lib/hear.ts`, `phrase(..., { legato })`):

- A note is held right up to the next one. Gaps under 0.14 s are not rests; longer gaps stay silent.
- Every new syllable gets a soft re-attack (a light tongue). When the pitch repeats, the note before stops
  0.03 s early, so the same pitch twice is heard as two notes, not one long one.
- A second pitch on the same syllable is slurred, with no new attack.
- Long notes sustain for their whole length. Vibrato only appears on notes longer than about 0.8 s and
  now grows in more slowly on longer notes.
- Songs set to Detailed keep the old phrasing.

Listening samples, alto sax alone, in `docs/listening-samples/melody-rethink/`:

| Excerpt | Before | After |
|---|---|---|
| Let It Be, chorus (0:37 to 0:52) | `let-it-be-chorus-alto-sax-before.mp3` | `let-it-be-chorus-alto-sax-after.mp3` |
| Just Give Me a Reason, chorus (0:50 to 1:08) | `just-give-me-a-reason-chorus-alto-sax-before.mp3` | `just-give-me-a-reason-chorus-alto-sax-after.mp3` |

"Before" is the old notes with the old phrasing; "after" is the new notes with legato phrasing. Measured on
the rendered audio: the Let It Be chorus went from 10 silences to 3 (49% → 31% of the excerpt quiet), and
the Just Give Me a Reason chorus from 14 silences to 3 (41% → 18%). These were checked by measurement, not
by ear; the owner should listen to them.

## Part 3: display

- **Lyric spacing.** A word is now as wide as the word itself (or as its note letters side by side, if
  they are wider, as on "I" or "it"). With the timing guide on, a word's notes share the word's width in
  proportion to how long each lasts, with the duration bar under each; they no longer push the words apart.
  Before, each note's cell was as wide as its length in time, so a long or busy word stretched the line.
- **Unsure dots.** The amber dot beside a line still means "worth a check": at least two notes, and 30%
  of the line, are unsure. It now uses the new method's confidence (steadiness, how well centred the
  pitch was, whether it was moved into the key, Whisper's confidence in the word). Measured against the
  human transcriptions, notes marked unsure are right 43% of the time and the others 70%, so the dot
  does point at the weaker lines, but less sharply than it should.
- **Detail setting, per song.** Settings → Detail is now "Sax-friendly" (default) or "Detailed". Detailed
  is the old literal transcription and brings back its own controls (Fewer / Balanced / Everything, and
  "hold a note across words"). Switching re-makes the notes in a few seconds and keeps hand edits.

## Part 4: instrumental hooks and solos

Where nobody sings (intro, solo, outro), the band's lead line is now written out as notes too. The lines
are labelled with a note icon and "Intro", "Solo" or "Outro" and have no lyrics; in the sheet music view
they are ordinary bars with the label under the first note.

Code: `service/notealong/pipeline/hooks.py`, `add_hooks` in `runner.py`. Tests: `service/tests/test_hooks.py`.
Measurement: `service/scripts/accuracy/hooks_eval.py`.

How it works:

1. **Where nobody sings.** Stretches of at least a few seconds with no sung pitch and no words. Before
   the first singing (or starting in the first 8 s) is "Intro", after the last singing (or ending in the
   last 8 s) is "Outro", anything between is "Solo".
2. **The lead line.** Basic Pitch runs on the backing track (everything but the vocals). In each frame
   the strongest upper voice is followed with a path search that prefers staying put over jumping, in
   two passes: the second pass only looks within an octave of the first pass's middle, which stops the
   line jumping to the bass or to overtones.
3. **Same simplification.** The line goes through the same sax-friendly step as the voice: held notes,
   no scoops, in the key, on the beat.
4. **Only when there is a lead.** A section is kept only if a line sounds for at least 30% of it, is
   clearly stronger than the accompaniment and gives at least 4 notes. A section of plain chords is left
   empty rather than filled with guesses.
5. **In the sung range.** Each hook is moved by whole octaves so it sits in the range of the sung
   melody, so it does not go off the top of the instrument.

**"Play the hooks yourself"** (Settings → Sound, on by default) plays a second version of the backing
track in which the lead line is turned down by 16 dB in those sections only, by lowering the line's own
harmonics in the spectrum. Outside those sections the track is the same. Hand edits are kept.

**Per-song setting** (Settings → Detail): "Vocals only" or "Vocals and hooks" (default; the full name
"Vocals and instrumental hooks" is in the hint and for screen readers, the short one fits the control).

### Decisions

- **No new model, no new licence.** Basic Pitch (Spotify, Apache-2.0) was already in the pipeline for
  the harmony. `catalog/LICENSES.md` is unchanged.
- **Turning the lead down: no separation model.** No model that separates "the lead instrument" from a
  band with a clearly commercial licence was found. The open separation models split fixed stems
  (vocals, drums, bass, other, some also guitar and piano), not "whichever instrument has the tune", and
  a saxophone lands in "other" with everything else. So the brief's fallback is used: the followed line
  is lowered in the non-vocal stem. It reduces the lead; it does not remove it.
- **Pipeline version 6.** All 13 songs in the local library were re-processed.
- **Online (cloud) mode** stores the turned-down backing track with the song's other files and serves it
  in the song's own key; after a key change it falls back to the normal backing track. This path is
  written but untested: nothing was deployed.

### Measured

There is no answer key for real solos, so the finder was measured by mixing a known sax-like line into
real Creative Commons backing tracks at three loudness levels and checking what comes back:

| Backing (30 s) | Lead at band level | Lead 6 dB quieter | Lead 10 dB quieter |
|---|---|---|---|
| What Is Love: frames right / notes found | 90% / 91% | 83% / 81% | 49% / 47% |
| Lovers and Liars | 91% / 97% | 89% / 97% | 78% / 84% |
| Eternity | 90% / 97% | 90% / 97% | 87% / 91% |
| Lead turned down by (the three songs) | 10.7 to 11.1 dB | 8.4 to 10.5 dB | 3.5 to 9.8 dB |
| Rest of the band changed by | 0.1 to 0.7 dB | | |

So a lead that is as loud as the band is found about 9 times in 10 and turned down by about 11 dB; a
lead buried 10 dB under a busy band is found only about half the time.

### On the songs

| Song | Hooks found |
|---|---|
| Let It Be (owner's upload) | Intro 0:00 to 0:12 (12 notes); Solo 1:43 to 2:15 (38); Solo 2:18 to 2:24 (7); outro left empty |
| Just Give Me a Reason (owner's upload) | Intro 0:00 to 0:10 (12); Outro 3:46 to 4:02 (11) |
| Despacito (owner's upload) | Intro 0:00 to 0:28 (30) |
| Poucet (CC BY 3.0, has an instrumental solo) | Solo 2:13 to 2:23 (9); Solo 2:28 to 2:35 (8) |
| Tonight (CC) | Intro (22); Solo 1:01 to 1:13 (19); Solo 2:07 to 2:19 (18) |
| Trombadinha (CC) | Intro 0:00 to 0:17 (36) |
| Eternity (CC) | Intro 0:03 to 0:16 (19) |
| Feel (CC) | Intro 0:00 to 0:19 (16) |
| Run Run Superman (CC) | Solo 1:41 to 1:51 (11) |
| Lovers and Liars (CC) | Solo 2:26 to 2:34 (8); Outro 2:56 to 3:08 (7) |
| The Fool (CC) | Intro (5); two short solos (5 each); three more sections left empty |
| What Is Love, Bad Side (CC) | none: no stretch without singing, or no clear lead |

Listening sample (Poucet by Gamssy Ghoulz, CC BY 3.0, 2:10 to 2:37, backing track only):
`docs/listening-samples/melody-rethink/poucet-solo-backing-before.mp3` and
`poucet-solo-backing-hooks-turned-down.mp3`.

## Summary for the owner

- **Numbers per song, the "Let it be" line and the detected keys**: see "Before and after" and "The
  'Let it be' line" above.
- **Listening samples**: `docs/listening-samples/melody-rethink/` (two alto sax before/after pairs, one
  backing-track pair for the hooks switch). None of them has been judged by ear; they were checked by
  measurement only.
- **Licences for new models**: none. No model was added in any of the four parts. Syllable counting is
  our own rules; the hooks reuse Basic Pitch (Apache-2.0), already listed.

## Remaining problems, all parts

- Let It Be is at 72% of syllables right, not the 85% asked for, and the first "let it be" has one wrong
  note of three.
- Duets: the tracker still sometimes follows the harmony voice.
- Onset timing is a little worse on songs sung behind the beat.
- The unsure dot is only weakly calibrated (43% right when marked, 70% when not).
- Key changes on four Creative Commons library songs are unverified.
- **Hooks on dense mixes.** When the "lead" is a piano or guitar playing chords, the finder follows the
  top chord notes. Let It Be's intro and its guitar solo come out as plausible but rough lines; they
  have not been checked against a transcription. None of the owner's three uploads has a sax hook, so
  the "Careless Whisper" case itself is untested on a real recording.
- **Every middle section is called "Solo"**, including short breaks between verses.
- **The hooks switch turns the lead down, it does not remove it** (about 11 dB at best, 3.5 dB when the
  lead is buried), and breathy or noisy parts of the tone stay.
- **Online mode**: the hooks path is untested (nothing was deployed), and after a key change the
  turned-down backing track is not used.
