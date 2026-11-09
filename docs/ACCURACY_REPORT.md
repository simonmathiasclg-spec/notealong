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
