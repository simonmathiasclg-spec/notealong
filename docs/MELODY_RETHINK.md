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

- Let It Be: see Round 2 below (92% of syllables right after the fix round; five notes still wrong).
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

## Round 2: missing notes and flow

The owner listened to Let It Be on alto sax and heard three things: it holds notes too long and skips
real ones (the note between the two C sharps of "speaking words of wisdom", alto fingering), and the
rhythm does not feel like the song. This round measured every line against the human letter-note key,
classified each miss, and fixed the biggest causes.

### What was wrong

The four suspected causes were checked one by one against the per-line diff.

| Suspected cause | Finding |
|---|---|
| Syllable counting from text | Not the problem on Let It Be: every word in the key gets the right number of syllables. It costs 2 to 4 notes on other songs (see the table of causes). |
| Melisma rule too strict | Partly. The half-second hold was dropping the short higher note a syllable lands on before it falls ("be" sung D then C). Loosening the hold in general added wrong notes on every other song, so only that one shape is now let through. |
| Beat snapping | Stored note starts were moved up to 60 ms onto the grid. Removed. |
| Merging | No case found: same-pitch neighbours in different syllables were already two notes. |
| **Lyric word timing (not on the list)** | The main cause, 12 of the 21 errors. The lyric timing often starts a word where the word before it ends, long before it is sung. The aligner trusted that start, so a word after a held note was put on the tail of that note, and its own short note was swallowed by a neighbour. That is exactly the lost note in "speaking words of wisdom". |

### What changed

1. **A word's lyric timing is a span, not a moment.** A word may start anywhere in its lyric span (up to
   a quarter of a syllable before its end) at almost no cost; the voice decides where.
2. **It does not wait past a fresh attack.** Inside that span, each clear attack of the voice let go by
   after the lyric start costs.
3. **No syllable is held across a silence into the next entry of the voice.**
4. **A real two-note syllable costs a flat fee** in the alignment instead of a miss per frame, so a
   word's last syllable sung on two held notes is no longer pushed onto its neighbours.
5. **The landing note is kept**: a higher note a syllable lands on before falling to its main note
   counts when held about a quarter of a beat (at least 0.2 s). A scoop from below is still ignored.
6. **A short blip on its own**, six semitones or more from the singing around it, is dropped (a breath
   the tracker gave a pitch).
7. **Sung timing is kept.** Stored notes are no longer moved onto the beat, so "Hear it played" and the
   Letters view follow the singer. Only the sheet music view puts notes on the grid, as it always did
   when writing rhythms.
8. **Rests come back sooner.** A note used to be held through silences up to half a beat (0.43 s on Let
   It Be); now a silence of about a third of a beat (0.16 to 0.28 s) is a rest. On Let It Be 13 notes
   were being held through 0.2 s or more of silence.

Tried and dropped because they made other songs worse: a shorter melisma hold for every second note,
counting only "settled" frames, and making the whole word span free.

### Let It Be, line by line

Lines are the 16 lines of the human key (first verse, second verse, two choruses). Notes right out of
the key's notes; the full side-by-side diff with every note is in the gitignored
`test-recordings/results/melody-fix-2/` (`before-let-it-be.txt`, `after-let-it-be.txt`).

| Line | Before | After | What is still wrong, and why |
|---|---|---|---|
| 1 | 5/5 | 5/5 | |
| 2 | 5/5 | 5/5 | |
| 3 | 5/7 | 5/7 | first word: both syllables wrong (C, D for E, E). The word starts on a slide up and the aligner cuts it too early (timing, pitch choice) |
| 4 "speaking words of wisdom" | 5/6 | 6/6 | |
| 5 | 2/4 | 2/4 | the pickup is a 0.1 s E the app hears as D (pitch); the D before the last C is missing (timing) |
| 6 | 4/6 | 6/6 | |
| 7 | 3/4 | 3/4 | one syllable a step low (timing) |
| 8 | 4/5 | 4/5 | last word gets a low A from the phrase's tail instead of C (timing) |
| 9 "speaking words of wisdom" | 3/6 | 6/6 | the missing note the owner named is back |
| 10 | 2/4 | 4/4 | |
| 11 | 3/3 | 3/3 | |
| 12 | 2/3 | 3/3 | |
| 13 | 1/3 | 3/3 | |
| 14 | 2/3 | 3/3 | |
| 15 "whisper words of wisdom" | 4/6 | 6/6 | |
| 16 | 3/4 | 4/4 | |
| **All** | **53/74** | **68/74** | missed 3 to 1, extra 0, wrong 18 to 5 |

Causes of the errors, before to after: timing 12 to 4, pitch choice 7 to 1, pitch 2 to 1.

### The whole test set

Syllables right / missed notes / extra notes / wrong notes / notes per key note / median onset error.
"Before" is the end of Part 4.

| Song | Before | After |
|---|---|---|
| Let It Be | 72% / 3 / 0 / 18 / 0.96 / n.a. | **92%** / 1 / 0 / 5 / 0.99 / n.a. |
| Just Give Me a Reason | 68% / 0 / 4 / 15 / 0.95 / n.a. | 68% / 0 / 4 / 16 / 0.96 / n.a. |
| Despacito | 60% / 3 / 5 / 23 / 1.03 / 60 ms | 60% / 3 / 5 / 23 / 1.03 / 60 ms |
| Someone Like You | 57% / 8 / 7 / 21 / 0.99 / 55 ms | 66% / 8 / 8 / 13 / 1.00 / 55 ms |
| Perfect | 64% / 19 / 2 / 33 / 0.88 / 92 ms | 72% / 17 / 4 / 22 / 0.91 / 90 ms |
| Halo | 57% / 26 / 6 / 52 / 0.89 / 90 ms | 60% / 24 / 8 / 49 / 0.91 / 70 ms |
| Shape of You | 72% / 8 / 25 / 37 / 1.08 / 50 ms | 74% / 5 / 22 / 36 / 1.08 / 45 ms |
| Blinding Lights | 74% / 0 / 0 / 3 / 0.95 / 60 ms | 74% / 0 / 0 / 3 / 0.94 / 60 ms |
| Wonderwall | 74% / 9 / 2 / 28 / 0.95 / n.a. | 78% / 8 / 2 / 23 / 0.96 / n.a. |
| Dynamite | 72% / 1 / 3 / 8 / 1.04 / 61 ms | 71% / 1 / 4 / 8 / 1.06 / 70 ms |
| Mean over the 12 songs with a key | 55.9% | 59.6% |

Not everything held or improved:

- **Dynamite is one note worse** (72% to 71%, one extra note): the song's first word now gets its notes
  in a different order. Both versions disagree with the key there. Its onset error also rose from 61 to
  70 ms, the price of no longer moving starts onto the beat on a song sung tightly on the grid.
- **Just Give Me a Reason has one more wrong note** (15 to 16); syllables right is unchanged.
- **Someone Like You, Perfect and Halo each have one or two more extra notes**, against 8, 11 and 3
  fewer wrong ones.
- Missed notes stay high on Perfect (17) and Halo (24), mostly real melismas shorter than the hold.

### Listening samples

`docs/listening-samples/melody-fix-2/`: Let It Be on alto sax, verse (0:12 to 0:37) and chorus (0:37 to
0:51), before and after. They were checked by measurement only, not by ear.

### What is left

- Let It Be: five wrong notes and one missing one, on lines 3, 5, 7 and 8 above. The 0.1 s pickup note
  of line 5 is below what the pitch curve resolves.
- Sung syllables are still counted from the text and placed on the audio. Detecting them from the audio
  alone was not needed for Let It Be; it would help the 2 to 4 syllable-count errors on Despacito,
  Dynamite, Wonderwall and Just Give Me a Reason.
- Short real melismas (Perfect, Halo, Someone Like You) are still dropped unless they are a landing
  note from above.
- Shape of You still has 22 extra notes (fast, half-spoken lines).
- The owner's uploads and the built-in songs were re-processed with these rules (pipeline version 7,
  hand edits kept). Nothing was deployed.
