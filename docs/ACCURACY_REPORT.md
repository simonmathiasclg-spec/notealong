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
* **"Hold a note across words when the singer does"** (Settings, uploads, off by default): the across-word
  join of experiment 9 as the owner's choice. On Despacito it takes the held notes shown as one note from 11
  to 17 of 25 (with the strictest thresholds tried, 14; with looser ones, 19). It stays off by default
  because the regression reference is cut at every word, so it cannot reward this and scores it 0.01 F1
  lower. Switching it off rebuilds the notes from the detection, keeping hand-edited notes (the cleanup step
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

Despacito's held notes, by note name (25 notes of 0.45 s or more in the key): shown as one note 9 before, 11
now, 17 with "hold a note across words" on.

Also: 615 notes shown on Despacito instead of 664 (49 unpitched or merged), and its lyrics read
"DIWAR" instead of "D I W A R".

## Listening samples

`docs/listening-samples/accuracy/`: the first chorus ("Despacito, quiero respirar tu cuello despacito…",
85-115 s of the music video) played by the app's alto sax samples, 30 seconds each, rendered offline the way
"Hear it played" plays notes (`service/scripts/accuracy/render_hear.py`):
* `despacito-chorus-alto-sax-before.mp3`: the notes as they were at the start of this run (91 notes)
* `despacito-chorus-alto-sax-after.mp3`: the notes now (80 notes)
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

1. **Held notes split at word boundaries.** Whisper's word timings put boundaries inside sung vowels, and
   the notes follow them. "Hold a note across words" fixes most of this on Despacito but is off by default;
   a better test set (human-marked held notes in a few pop songs) would let it be judged fairly and probably
   switched on.
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
