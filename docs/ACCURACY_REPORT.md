# Accuracy of uploaded songs: notes, timing, sustain

The goal of this run: an uploaded pop song has to sound right with "Hear it played" on. The test case is
the owner's upload of Despacito (audio from the official music video, with ocean sounds and shouting
before the song). Lyrics were already accurate; notes, timing and held notes were not.

Everything here is measured, one heavy job at a time. A change is kept only if it improves Despacito
without making the regression sets worse.

## The answer key

There was no `test-recordings/` folder with the owner's own sax recordings, so the answer key was built from
saxophone covers on YouTube, downloaded with `yt-dlp` for internal testing only into the gitignored
`test-recordings/youtube/` (never committed, never in the catalog, never used by the app):

| Cover | Key vs the song | Tempo ratio | Agreement with the anchor pair | Used |
|---|---|---|---|---|
| Facundo Pisoli (8wIZs2JwYMU) | same | 0.99 | 0.76 | yes (anchor) |
| Sandra Fernando, alto (K4hso2bVTMA) | same | 1.00 | 0.69 | yes (anchor) |
| Enzo Buonaurio (LUiviJfVaPI) | 2 semitones lower | 1.00 | 0.80 | yes |
| Zygi Sax (lhJ56L6nVKM) | same | 0.95 | 0.58 | yes |
| a sheet-music play-along (c6xhBbkOxjI) | 2 lower | 0.87 | 0.34 | no |
| Sergey Brazhnik, alto (rRO04Gmx2nI) | 1 higher | 1.00 | 0.43 | no |
| Daniele Vitale (wR6mU_H3GSk) | 1 lower | 0.77 | 0.39 | no |

How (`service/scripts/accuracy/prepare_covers.py`, `answer_key.py`):
1. Each cover is split with Demucs into four stems; the sax always landed in "other". Its pitch is tracked
   with CREPE (full model) every 10 ms.
2. Its key difference from the upload is the transposition whose chroma alignment costs least (all 12 tried).
3. It is aligned to the upload's timeline with dynamic time warping on chroma, with the path's slope held
   between half and double speed and a free start and end in the upload (the music video has an intro the
   covers lack). Every usable cover lines up from 21 to 30 s of the video with a tempo ratio of 0.95 to 1.00.
4. The sax pitch is cut into notes (a new stable semitone or a level dip), each note's pitch from its
   stable middle, then shifted into the singer's register.
5. The two covers that agree best are the anchor. Covers that agree with them on fewer than half the notes
   are left out. Notes that at least two of the four remaining covers play at the same moment (start
   within 200 ms, same note name) become the answer key: 613 notes, 72 played by all four.

The covers do not agree on octaves: in "quiero respirar" the singer sings F#3 and most sax players play
F#4. So pitch is judged by note name (pitch class) as well as strictly. The covers agree on start times to
within about 50 ms (median spread), which limits how finely timing can be judged against them.

How far to trust a key note: where all four covers agree, the singer's measured pitch matches 86 % of the
time; three of four, 75 %; two of four, 62 % (the singer is in tune: 2 cents median). So Despacito's pitch,
timing, duration and sustain are scored on the **strict key** (284 notes that at least three covers play),
and precision and F1 on the full key.

### Regression sets

* **11 Creative Commons recordings** with human word timings (JamendoLyrics), scored as in the first run:
  reference notes are cut from CREPE's pitch inside the human-timed words. The original mixes were fetched
  again from the JamendoLyrics repository into `test-recordings/regression-originals/`; each lines up with the
  catalog's stems to the sample.
* **Vocadito** (40 excerpts of solo singing with note annotations by two people, CC BY 4.0, Zenodo
  10.5281/zenodo.5578807, internal use only, in `test-recordings/datasets/`). Annotator 2 scored against
  annotator 1 gives the human ceiling: pitch 0.87, F1 0.76, onsets 1/63 ms, sustain 0.69.
* MIR-ST500 and MedleyDB were not used: MIR-ST500's audio has to be gathered from YouTube song by song, and
  MedleyDB needs an access request.

## Measures

`service/scripts/accuracy/evaluate.py` (all against the reference notes):

| Measure | Meaning |
|---|---|
| pitch | share of reference notes found within 100 ms of their start that have the right pitch (note name in brackets) |
| off>1 | share of those found notes off by more than one semitone |
| F1 | notes with the right pitch starting within 100 ms (precision and recall together) |
| onset | start error of same-pitch notes matched within 300 ms: median / 90th percentile, and the median signed error |
| dur | median relative duration error (0.30 = 30 % too long or short) |
| sustain | share of reference notes of 0.5 s or longer that one note of the right pitch covers for at least 80 % |
| frames | share of the reference notes' time where the shown note has the right pitch |

## Baseline (the pipeline at the start of this run)

| Set | pitch | off>1 | F1 | onset med / p90 | bias | dur | sustain | frames |
|---|---|---|---|---|---|---|---|---|
| Despacito (strict key) | 0.726 (0.754) | 20.0 % | 0.389 | 70 / 171 ms | +20 | 0.29 | 0.12 (8 notes) | 0.551 |
| Despacito (full key) | 0.682 (0.719) | 25.8 % | 0.389 | 65 / 190 ms | +20 | 0.32 | 0.06 (16 notes) | 0.483 |
| Regression, 11 songs | 0.804 (0.819) | 6.1 % | 0.610 | 25 / 108 ms | +2 | 0.23 | 0.59 | 0.647 |
| Vocadito, 40 excerpts | 0.793 | 1.5 % | 0.571 | 25 / 115 ms | +10 | 0.31 | 0.08 | 0.691 |

## Experiments

### 1. Global time offset: none

The original file, the separated vocals (lossless and MP3), the backing track and their sum line up to the
sample (cross-correlation in three 30-second windows across the song), and Chromium decodes both MP3 stems
exactly as ffmpeg does (no encoder-padding shift). The notes' median start error against the covers is
+20 ms on Despacito and +2 ms on the regression songs: there is no offset to remove.

### 2. Vocal separation: htdemucs stays

| Separation | Despacito pitch | Despacito F1 | frames | Regression F1 | Time for a 3-minute song |
|---|---|---|---|---|---|
| htdemucs (current) | 0.682 | 0.389 | 0.483 | 0.610 | 17 s |
| htdemucs_ft | 0.683 | 0.389 | 0.491 | 0.607 | 70 s |

No measurable gain for four times the time. BS-RoFormer and Mel-RoFormer were not tried: the code is MIT, but
the published vocal checkpoints are either unlicensed, labelled CC BY-NC-SA, or "for research"; none was
clearly usable in a paid product.

### 3. Pitch trackers (licences: FCPE MIT, CREPE MIT; RMVPE not used, its weights carry a research-only clause)

The raw pitch curve, frame by frame inside the strict key notes:

| Tracker | voiced | right note name, of voiced frames | time for Despacito (4:42) |
|---|---|---|---|
| FCPE | 93 % | 60 % | about 1 s |
| CREPE tiny | 65 % | 69 % | about 10 s |
| CREPE full | 74 % | 68 % | 261 s |

### 4. Notes straight from the pitch curve (own segmentation): not kept

Cutting FCPE's curve into notes ourselves (new semitone, onset or level re-attack, vibrato and scoops inside a
note): Despacito pitch 0.59, F1 0.34, frames 0.59 (the frames improve, the notes do not). It splits stray
breaths and bleed into notes and merges repeated syllables. Basic Pitch is better at where notes start.

### 5. Basic Pitch's notes refined with the pitch curve: kept

`notealong/pipeline/pitchnotes.py: refine_with_pitch`, after the words are attached:
* each note's pitch is re-read from the median of FCPE's curve over its middle 60 % (the scoop in and the fall
  out left aside), when at least half of it is pitched;
* a "note" whose span is less than a quarter pitched is dropped (breaths, shouts, effects);
* same-pitch notes less than 100 ms apart, in the same word, become one held note unless the singer
  re-attacks (an onset or a level dip at the junction);
* a note lasts while the voice stays within 0.6 semitones of its pitch, up to the next note.

| Set | pitch | off>1 | F1 | onset med / p90 | dur | sustain | frames |
|---|---|---|---|---|---|---|---|
| Despacito, before | 0.726 | 20.0 % | 0.389 | 70 / 171 | 0.29 | 0.12 | 0.551 |
| Despacito, after | **0.762** | **17.3 %** | **0.403** | 70 / 184 | 0.32 | 0.12 | **0.574** |
| Regression, before | 0.804 | 6.1 % | 0.610 | 25 / 108 | 0.23 | 0.59 | 0.647 |
| Regression, after | **0.811** | **4.4 %** | **0.616** | 25 / **104** | 0.23 | **0.68** | **0.670** |
| Vocadito, before | 0.793 | 1.5 % | 0.571 | 25 / 115 | 0.31 | 0.08 | 0.691 |
| Vocadito, after | **0.835** | **0.9 %** | **0.642** | **21 / 101** | **0.21** | **0.55** | **0.722** |

With CREPE full instead of FCPE: Despacito pitch the same (0.762), F1 0.413, but 4.5 minutes per song
against about a second. FCPE is used. The pitch curve is computed in the melody step and cached as
`pitch.npz` next to the stems; hand-edited notes are never changed.

Scored from here on only over the part that is sung (from the first real word): the covers also play the
music video's guitar intro, where nobody sings, which made every method look worse. On that span the
pipeline before this run scores F1 0.401 and the refinement 0.416.

### 6. Wider scoop absorption: not kept

Most wrong notes left on Despacito are not tracking errors: the pitch curve agrees with the note shown. They
are the singer sliding up into a note from a tone below (E4 into F#4), which the sax players simplify to the
target. Absorbing scoops of up to two semitones, or longer ones, made every set worse:

| Setting | Despacito pitch | Despacito F1 | Regression pitch | Regression F1 |
|---|---|---|---|---|
| a semitone, at most 0.2 s, target 1.5x longer (kept) | 0.762 | 0.403 | 0.811 | 0.616 |
| up to two semitones | 0.760 | 0.401 | 0.805 | 0.610 |
| two semitones, target as long | 0.754 | 0.399 | 0.797 | 0.603 |
| two semitones, 0.3 s | 0.754 | 0.399 | 0.789 | 0.594 |

So these differences are the players' interpretation, not the pipeline's mistakes. The settings are now
parameters (`bend_semitones`, `bend_ratio`) for later tuning.

### 7. Beat grid: not kept

Beats from the backing track with Beat This! (CPJKU, MIT); note starts pulled onto the nearest sixteenth when
within 25 to 60 ms. Despacito's F1 fell (0.403 to 0.38-0.40), its 90th-percentile start error grew, and the
regression set got no better at any tolerance. The singer's own timing is closer to what players do than the
grid. (`notealong/pipeline/beats.py` stays for the evaluation; the app does not use it and `beat_this` is
not in requirements.txt.)

### 8. Starts moved to the singer's attack: not kept

Basic Pitch starts a note when the pitch settles, after the consonant. Moving starts back to the strongest
vocal onset in the 60-100 ms before improved Despacito's timing a little (median 70 to 62-67 ms) but made
both regression sets worse (regression pitch 0.811 to 0.77-0.79, Vocadito 0.835 to 0.79-0.81).

### 9. Held notes across word boundaries: not kept (available as an option)

Many held notes on Despacito still show as two touching notes on the same pitch where Whisper put a word
boundary inside one sung vowel (the onset strength at the junction is 0.01-0.4, the level dips 0-5 dB).
Joining those (only when the junction has essentially no onset and no dip) left Despacito's measures flat
(its strict key has only 8 held notes, too few to judge) and lowered the regression F1 slightly (0.616 to
0.605-0.611), so it is off by default (`RefineParams.across_words`).

### Non-singing sounds

The ocean and shouting before the song produce no notes (the vocal stem is quiet or unpitched there, and
the refinement drops "notes" that are less than a quarter pitched). The sung ad-libs at the start of the
song ("Oh no, oh no", "Diridiri, dirididi, Daddy") are real singing and keep their notes; Whisper had
spelled "diridiri" out as "D I W A R", which is now joined back into one word. For a video's intro or the
applause at the end there is now a trim control (below).

## Product additions

* **Confidence marks.** Each note's confidence is now the share of its length where the singer's pitch is
  on the note. On the test songs a note under 0.6 has the right pitch about half the time, a note over 0.8
  nine times in ten (Despacito: 0.20 / 0.60 / 0.84 / 0.81 by band; regression: 0.24 / 0.49 / 0.75 / 0.92).
  A line where at least 30 % of the notes (and at least two) are under 0.6 shows a small amber dot beside it
  ("The notes in this line were hard to hear: worth a check"). Uploads only.
* **Faster fixing in edit mode.** Selecting a note opens an editor with a timing strip: drag the start or
  end handle, or the note itself, in 10 ms steps, between its neighbours. Keys: ↑/↓ a semitone, ←/→ earlier
  or later by 50 ms (Shift: 10 ms), [ and ] move the whole line, S splits the note in two, J joins it with the
  next. A run of the same edit (a drag, a held key) is one undo step. A bug that predates this run is fixed:
  the first arrow key after selecting a note also moved the playback to the next line (or changed the key).
* **Trim the start or end** (Settings, uploads): type minutes:seconds or press "Here" at the current
  position. The audio files are cut and every note, word and line moves with them; nothing is processed
  again and fixes are kept.
* **Existing uploads re-processed.** The note pipeline has a version on each upload. When the service starts
  it brings older uploads up to date in the background, one at a time and only while nothing else is
  processing: spelled-out words are joined and the notes refined with the pitch curve. Hand-edited notes and
  words are never changed, and the old result stays until the new one is saved in one write. All 11 uploads
  on this machine were upgraded, Despacito included.
* **"Hold a note across words when the singer does"** (Settings, uploads, **on by default**): the
  across-word join of experiment 9. On Despacito it takes the held notes shown as one note from 11 to 17 of
  25 (with the strictest thresholds tried, 14; with looser ones, 19). It was first left off because the
  regression reference is cut at every word, so it cannot reward this and scores it 0.01 F1 lower
  (0.616 to 0.605). The owner chose to have it on by default, since sustain is the main complaint; a song
  can still have it switched off in Settings. Pipeline version 3 applied it to every existing upload
  (Despacito 619 to 585 notes, 17 of 25 held notes now one note). Switching it off rebuilds the notes from the detection, keeping hand-edited notes (the cleanup step
  now always keeps them, which also fixes the detail-level switch throwing fixes away).

## Final numbers

The pipeline at the start of this run against the pipeline as it now ships, both scored over the sung part:

| Set | | pitch (note name) | off>1 | F1 | onset med / p90 | bias | dur | sustain | frames |
|---|---|---|---|---|---|---|---|---|---|
| Despacito, strict key (282 notes) | before | 0.726 (0.754) | 20.0 % | 0.392 | 70 / 171 ms | +20 | 0.29 | 0.12 | 0.554 |
| | after | **0.762 (0.780)** | **17.3 %** | **0.406** | 70 / 184 ms | +15 | 0.32 | 0.12 | **0.578** |
| Despacito, full key (2 of 4 covers) | before | 0.684 (0.721) | 25.6 % | 0.392 | 65 / 190 ms | | 0.32 | 0.06 | 0.486 |
| | after | **0.710 (0.746)** | **21.5 %** | **0.406** | 63 / 184 ms | | 0.33 | 0.06 | **0.499** |
| Regression, 11 songs | before | 0.804 (0.819) | 6.1 % | 0.610 | 25 / 108 ms | +2 | 0.23 | 0.59 | 0.647 |
| | after | **0.811 (0.823)** | **4.4 %** | **0.616** | 25 / **104** ms | +2 | 0.23 | **0.68** | **0.670** |
| Vocadito, 40 excerpts | before | 0.793 | 1.5 % | 0.571 | 25 / 115 ms | +10 | 0.31 | 0.08 | 0.691 |
| | after | **0.835** | **0.9 %** | **0.642** | **21 / 101** ms | +10 | **0.21** | **0.55** | **0.722** |

Despacito's held notes, by note name (25 notes of 0.45 s or more in the key): shown as one note 9 before,
**17 now** (11 with "hold a note across words" switched off). With it on, the regression set's F1 is 0.605
instead of 0.616 above, for the reason given under Product additions.

Also: 615 notes shown on Despacito instead of 664 (49 unpitched or merged), and its lyrics read
"DIWAR" instead of "D I W A R".

## Listening samples

`docs/listening-samples/accuracy/`: the first chorus ("Despacito, quiero respirar tu cuello despacito…",
85-115 s of the music video) played by the app's alto sax samples, 30 seconds each, rendered offline the way
"Hear it played" plays notes (`service/scripts/accuracy/render_hear.py`):
* `despacito-chorus-alto-sax-before.mp3`: the notes as they were at the start of this run (91 notes)
* `despacito-chorus-alto-sax-after.mp3`: the notes now, held notes held across words (73 notes)
* `despacito-chorus-alto-sax-answer-key.mp3`: what at least three of the four sax covers play (53 notes),
  for reference

They are the sax line alone: the song's own recording is copyrighted and is not put in the repository. To hear
it against the band, open Despacito in the app with Hear it played on.

## Models and data, and their licences

| What | Used for | Licence | Shipped |
|---|---|---|---|
| FCPE (torchfcpe 0.0.4, weights in the package) | the singer's pitch curve in the pipeline | MIT | yes |
| Demucs htdemucs (already used) | vocal separation | MIT | yes |
| Basic Pitch (already used) | note detection | Apache 2.0 | yes |
| CREPE (torchcrepe) | pitch of the covers, the regression reference, a comparison tracker | MIT | no (evaluation only) |
| Beat This! (CPJKU) | beat grid experiment | MIT | no (not kept) |
| htdemucs_ft | separation comparison | MIT | no (not kept) |
| RMVPE | not used: its weights carry a research-only clause | | |
| BS-RoFormer, Mel-RoFormer vocal checkpoints | not used: unlicensed, non-commercial or research-only | | |
| YouTube sax covers (7) | the Despacito answer key | the uploaders' | no: internal, gitignored, never committed |
| JamendoLyrics (11 recordings, CC) | regression set | CC BY / BY-SA recordings | no (already in the catalog as stems) |
| Vocadito (40 excerpts) | regression set with human note labels | CC BY 4.0 | no: internal, gitignored |

## Top remaining problems

1. **Held notes split at word boundaries.** Whisper's word timings put boundaries inside sung vowels.
   "Hold a note across words" (now on by default) joins 17 of Despacito's 25 held notes; 8 still split,
   mostly where the voice dips or re-attacks a little at the boundary. A test set with human-marked held
   notes in a few pop songs would let the thresholds be tuned fairly.
2. **The answer key itself.** Four sax covers agree on 72 notes completely and on 613 by at least two. They
   disagree on octaves and on ornaments, and their timing spreads by about 50 ms, so Despacito's timing
   numbers (median 70 ms) are partly the key's own noise. The owner's own recording over the backing track
   (`test-recordings/despacito-sax.m4a`) would make a much better key.
3. **Slides into notes.** Most of Despacito's remaining "wrong" notes are the singer sliding in from a tone
   below; sax players play the target. Absorbing them hurts the other songs. A rule that looks at how the
   pitch moves (a smooth glide, not a held lower note) could separate the two.
4. **Timing.** No global offset exists and the beat grid did not help; the start error against the covers is
   70 ms median, 184 ms at the 90th percentile. Starting notes at the syllable's attack helped Despacito but
   not the others.
5. **Rap sections.** In Daddy Yankee's verse (about 100-140 and 180-220 s) pitch accuracy drops to 0.55-0.75:
   rapped words have no stable pitch, and the covers play their own line there. The confidence marks flag
   many of these lines.

---

# Round 2: a popular-song test set, three fixes tried, one kept

**In short:** the notes were measured on nine popular songs instead of Despacito alone. Of the three fixes asked
for, one is kept: a held note now stays one note while the singer's pitch never leaves it (held notes shown
whole: 65% → 68% across the set, Despacito 17 → 18 of 25). Absorbing slides and moving note starts to the
singer's attack both made the human-checked test sets worse, so they are not used. Pitch accuracy averaged over the
set went from 0.755 to 0.760.

## The popular-song set

Built the same way as Despacito's key (`prepare_covers.py`, `answer_key.py`): the original recording through the
upload pipeline (into a separate test library, never into My songs), six YouTube covers per song, split with
Demucs, pitch-tracked with CREPE (tiny model, for time), aligned to the original with chroma DTW after undoing any
key change, and a note kept when at least half of the covers that agree with the two most similar ones play it.
Everything is in the gitignored `test-recordings/popular/` and `test-recordings/library/`; nothing is committed
or shipped.

| Song | Style, language | Covers used | Key notes (strict) | Held notes in the key |
|---|---|---|---|---|
| Despacito | Latin pop, Spanish (round 1 key) | 4 | 282 | 25 |
| Someone Like You | ballad, English | 5 of 6 | 122 | 51 |
| Perfect | ballad, English | 5 of 6 | 55 | 21 |
| Halo | R&B ballad with runs, English | 2 of 6 | 139 | 55 |
| Shape of You | upbeat pop, English | 6 | 154 | 2 |
| Blinding Lights | upbeat pop / synth, English | 6 | 76 | 25 |
| Vivir Mi Vida | Latin (salsa), Spanish | 5 of 6 | 109 | 30 |
| Tum Hi Ho | Bollywood ballad, Hindi | 3 of 6 | 103 | 29 |
| Dynamite | K-pop, English | 5 of 6 | 29 | 1 |
| ~~Wonderwall~~ | rock, English | 1 of 6 | 0 | – |

Wonderwall is left out: its covers (mostly guitar arrangements) never agreed with each other, so there is no key,
and the set has no rock song. Halo's key rests on only two covers, and they play much of the song an octave away
from the singer, so its pitch score (0.43) is mostly octaves (by note name it is 0.77). The two scores are
reported side by side below for that reason.

## Baseline: the pipeline as shipped after round 1

| Song | Pitch | Off by >1 semitone | F1 | Start error (median / p90) | Held as one |
|---|---|---|---|---|---|
| Despacito | 0.764 | 17% | 0.405 | 70 / 179 ms | 0.68 (17 of 25) |
| Blinding Lights | 0.945 | 4% | 0.536 | 45 / 178 ms | 0.80 |
| Dynamite | 0.900 | 10% | 0.508 | 53 / 132 ms | – (1 held note) |
| Halo | 0.432 (0.765 by name) | 54% | 0.129 | 55 / 173 ms | 0.58 |
| Perfect | 0.795 | 18% | 0.246 | 50 / 202 ms | 0.71 |
| Shape of You | 0.708 | 27% | 0.354 | 37 / 151 ms | – (2 held notes) |
| Someone Like You | 0.810 | 14% | 0.363 | 45 / 152 ms | 0.78 |
| Tum Hi Ho | 0.604 | 38% | 0.192 | 75 / 205 ms | 0.59 |
| Vivir Mi Vida | 0.840 | 16% | 0.307 | 52 / 166 ms | 0.73 |
| **Average (9 songs)** | **0.755** (0.829 by name) | **22.0%** | **0.338** | **53 / 171 ms** | **0.65** |

F1 is low everywhere because covers ornament and simplify differently from the singer; pitch accuracy and the
start error, measured on the notes both have, are the fairer numbers.

## The fixes, measured on all three sets

Regression references (11 Creative Commons songs) cut a note at every word, so they penalise joining held notes
by design; Vocadito (40 excerpts with human-marked notes) is the most trustworthy check.

| Change | Popular pitch | off >1 | F1 | start med / p90 | held | Regression pitch / F1 | Vocadito pitch / F1 | Kept |
|---|---|---|---|---|---|---|---|---|
| baseline | 0.755 | 22.0% | 0.338 | 53 / 171 | 0.65 | 0.808 / 0.605 | 0.835 / 0.642 | |
| hold while the pitch never leaves | 0.760 | 21.5% | 0.339 | 53 / 171 | **0.68** | 0.804 / 0.592 | 0.834 / 0.641 | **yes** |
| absorb slides | 0.763 | 21.4% | 0.332 | 55 / 174 | 0.64 | 0.794 / 0.581 | **0.806 / 0.584** | no |
| both | 0.767 | 20.9% | 0.333 | 55 / 176 | 0.67 | 0.790 / 0.568 | 0.806 / 0.583 | no |
| starts moved to the attack (±80 ms) | 0.779 | 19.5% | 0.340 | 55 / 174 | 0.66 | **0.769** / 0.586 | 0.803 / 0.635 | no |
| starts moved to the attack (±50 ms) | 0.773 | 20.1% | 0.340 | 54 / 175 | 0.66 | 0.789 / 0.596 | 0.818 / 0.634 | no |
| join same-pitch notes only within 50 ms (cleanup) | 0.751 | 21.9% | 0.336 | 55 / 173 | 0.65 | 0.809 / 0.606 | 0.835 / 0.644 | no |

### 1. Slides into notes: not kept

`wrong_notes.py` sorts every wrong note by what the singer's pitch curve does there. A **slide** is a note the voice
only passes through (never steady for 60 ms); a **sung** note is one the singer really holds, where the covers
play something else. On Despacito 6 of 35 wrong notes are slides; across the popular set 25 of 114. Slides are
the minority: most "wrong" notes are interpretation differences between singer and covers.

The fix (`RefineParams.slides`): a short note within a word that the voice glides through, within 4 semitones of
its neighbour, becomes part of the neighbour (a scoop starts the target note where the glide starts; a fall
lengthens the note before). It raised the popular pitch score a little but cost real notes everywhere: Despacito
lost 3 to 5 right notes for at most one fewer slide at any setting tried, and Vocadito's human-marked notes fell
from 0.835 to 0.806 (F1 0.642 to 0.584). Fast passing notes and slides look too much alike in the pitch curve.
The code stays in, switched off.

### 2. Held notes split at word boundaries: kept (continuous hold)

Round 1 joined a held note across a word boundary only when there was no onset and no dip. The new rule
(`RefineParams.continuous_hold`) uses the pitch curve: if the voice never stops and never leaves the note's pitch
(within 0.6 semitone) across the junction, it is one note, unless there is a strong new attack (onset ≥ 0.6). It
applies across words only while "Hold a note across words" is on, so that switch still cuts notes at words.

Held notes shown whole: 65% → 68% across the set (Despacito 17 → 18 of 25, Tum Hi Ho 0.59 → 0.69, Vivir Mi Vida
0.73 → 0.77, Someone Like You 0.78 → 0.82, Blinding Lights 0.80 → 0.84), pitch 0.755 → 0.760, Vocadito unchanged,
regression F1 0.605 → 0.592 (expected: that reference splits every word). Despacito's remaining split held notes
are mostly real re-attacks: the singer starts a new syllable on the same pitch with an onset of 0.5 to 1.4 and a
6-10 dB dip, which the covers play as one note.

### 3. Timing: no systematic cause that a fix could remove

On Despacito the start error grows through the pipeline (median / p90 against the strict key): Basic Pitch's raw
notes 49 / 153 ms, after cleanup 64 / 160, after attaching to words 70 / 171, after refinement 70 / 179. The big
errors come from joining notes (a joined note keeps the earlier start) and from the covers' own phrasing; the
starts are not consistently late (bias +4 ms over the set, +15 ms on Despacito). Starting notes at the vowel
would make them later still, so it was not pursued. Moving starts onto the nearest strong attack fixed the
average bias and raised the popular pitch score (by changing which notes match), but made the human-marked sets
worse on both pitch and timing (regression start median 25 → 30 ms, Vocadito pitch 0.835 → 0.803). Not kept.
Start error stays at **53 ms median, 171 ms at the 90th percentile** across the popular set (Despacito 70 / 181).

A smaller merge gap in cleanup (0.05 s) improved Despacito alone (pitch 0.764 → 0.776) but not the set
(0.755 → 0.751): kept out, as an example of what tuning to one song would have done.

## Before and after (popular set, 9 songs)

| | Pitch | By note name | Off by >1 | F1 | Start median / p90 | Held as one |
|---|---|---|---|---|---|---|
| Before (round 1 as shipped) | 0.755 | 0.829 | 22.0% | 0.338 | 53 / 171 ms | 0.65 |
| After | **0.760** | 0.834 | **21.5%** | 0.339 | 53 / 171 ms | **0.68** |
| Despacito before | 0.764 | 0.782 | 17.0% | 0.405 | 70 / 179 ms | 17 of 25 |
| Despacito after | 0.764 | 0.783 | 16.8% | 0.400 | 70 / 181 ms | 18 of 25 |

All 11 uploads were re-processed with the new pipeline (version 4) by the background upgrader; notes fixed by hand
were kept (Tonight's 4 edited notes are still there). Despacito went from 585 to 562 notes as held notes joined.

## Listening samples

`docs/listening-samples/accuracy-2/`: Despacito's first chorus (85-115 s) on the alto sax samples, rendered the
way "Hear it played" plays notes:
* `despacito-chorus-alto-sax-before.mp3`: the notes as shipped after round 1 (73 notes)
* `despacito-chorus-alto-sax-after.mp3`: the notes now (71 notes: two held notes no longer split)

## Top remaining problems (after round 2)

1. **Singer versus covers.** 89 of the 114 wrong notes across the set are notes the singer really sings and the
   covers don't play (runs, blue notes, a different line in rap or ad-libs). Covers are an imperfect key; the
   owner's own recordings over a few backing tracks would measure what matters directly.
2. **Octaves in the key.** Covers move phrases up or down an octave (Halo, Shape of You, Someone Like You), which
   costs 7 points of pitch accuracy that are not the app's fault (0.760 exact against 0.834 by note name).
3. **Re-attacked held notes.** A new syllable on the same pitch is a new note to the singer and one note to a sax
   player. Which one the app should show is a design choice; a per-song "sax phrasing" option could join them.
4. **Timing tail.** 10% of note starts are off by more than 170 ms, mostly joined notes and phrasing; the median
   (53 ms) is close to the covers' own spread.
5. **No rock song in the set.** Wonderwall's covers didn't agree; another rock song with sax or instrumental
   covers would close the gap.
