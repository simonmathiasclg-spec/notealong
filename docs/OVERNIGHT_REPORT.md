# Overnight improvement run

Started 4 November 2026, late evening. This file is written as the work goes, part by part.
Each part ends with the Python tests, the frontend tests and the production build passing, then a commit and a push.

Baseline before the run: 31 Python tests, 27 frontend tests, production build passing, 59 catalog songs
(48 hand-authored public domain, 11 Creative Commons recordings).

## Part 1: timing guide

**What it does.** A new "Timing guide" (on by default, switch in Settings) answers "when do I start this
note and how long do I hold it?":

- Every note has a slim bar under its letter. A note's cell is as wide as the time until the next note, so a
  held note is visibly longer than a quick one. The bar covers only the sounding part: a gap after the bar
  is a silence.
- A thin line sweeps through the current lyric line in real time. It reaches the left edge of each bar
  exactly when that note starts, and the bar fills with the accent colour behind it.
- One beat before a note starts its box takes an accent outline that grows over that beat ("get ready").
- After any rest longer than 2 seconds the next note shows a 3, 2, 1 count on the song's beat, in a ring
  directly above the note. The line that was just played steps further back while the count runs.
- Reduced motion: no sweeping line and no growing outline. The current bar is simply lit, played bars are
  dimmed, the count changes without animation.

**How it is built.**

- `web/src/lib/timing.ts`: pure functions for the beat length, the cue and countdown, the cell layout and
  the position of the sweeping line. 16 new unit tests in `web/src/lib/__tests__/timing.test.ts`.
- `web/src/lib/clock.ts`: `SmoothClock`. Browsers refresh the media clock only every few milliseconds
  (some every 20 to 40 ms), which would make the line stutter. The clock runs at the playback rate between
  refreshes and keeps steering back to the media clock, so it cannot drift; a seek or loop jump re-anchors
  it at once. Tested for 60 s at half speed with a media clock that only updates every 40 ms: worst error
  under 25 ms, never runs backwards.
- `web/src/components/player/useSweep.ts`: moves the line and fills the bars once per frame straight in
  the DOM, with no React re-render.
- Everything is derived from the song position, so it follows speed changes, loops, seeking and key
  changes without special cases. It works in focus mode and in edit mode.

**Decisions.**

- Words are left-aligned under their first note while the guide is on (they were centred). The left edge
  of a note is its start, so the letter, the bar and the syllable now begin at the same place.
- Tempos are counted in a comfortable range: above 150 bpm the count runs in half time, below 57 bpm in
  double time.
- An upcoming line now takes the stage 0.4 s after the previous line ends (it was 1.0 s) and up to three
  beats early, so the countdown and the approaching line are always visible on the big line.
- Quick notes all get the same minimum width (the width of the note box). Making very short notes narrower
  than their letter would have made the letters unreadable from a distance. The sweep speed shows the
  difference instead: the line crosses quick notes faster.

**Critique passes (screenshots in `docs/screenshots/overnight/`).**

1. First pass: bars invisible. The dev server was serving a stale stylesheet; restarted it.
2. Second pass: the sweeping line ran into the bottom of the highlighted note box. It now hangs from the
   bar down into the space above the word and is 4 px wide, so it is visible from a distance but does not
   touch the letters.
3. Third pass: checked dark, light, tablet width, focus mode, edit mode, reduced motion and the guide
   switched off (old centred layout, unchanged).

**Also fixed.** Keyboard focus squared off the round play button (a global focus style set a 4 px corner
radius on whatever had focus). The focus ring now follows each control's own shape.

**Noticed, not changed.** Two built-in songs on this machine have a loop saved over most of the song
(Amazing Grace 0:00 to 0:29, Bella Ciao 0:00 to 0:53). Dragging along the progress line creates a loop, so
these were probably made by accident while trying to scrub. Worth a look: see "next steps".

## Part 2: held notes shown as repeated notes

**The problem in the data.** The pitch tracker splits one sustained sound in three ways. Measured on the
11 recordings and the 2 uploads before any change:

- the same pitch twice with a short gap or none (vibrato, a swell, an accent),
- a short note one semitone away at the very start (the voice scooping up into the note) or at the very
  end (the pitch sagging as the note is let go),
- a wide vibrato that flips to the neighbouring semitone and back.

**The fix** (`service/notealong/pipeline/held.py`, run when notes are matched to words). Fragments are
joined into one held note unless the singer really starts again:

- **A new syllable starts.** Notes on different words are never joined. Inside a word, joining stops when
  the word would be left with fewer notes than it has syllables ("hap-py" keeps two notes). Syllables are
  counted from the spelling, on the high side, and per language (the final e is sung in German and
  French, silent in English).
- **The sound breaks.** `service/notealong/pipeline/onsets.py` measures two curves on the vocals stem once
  per song: onset strength (spectral flux) and level. A dip of 6 dB at the junction (a closure such as p,
  t, k, or a breath) keeps the notes apart. Where no words are known, a clear onset alone does too.
- **The gap is long.** More than 0.15 s of silence is always a new note.
- A held note that runs past the end of its word (word timings often end early) is joined to the word's
  last note.
- Notes fixed by hand in edit mode are never touched.

All five thresholds are in `config.py` per detail level (`held_gap`, `onset_min`, `dip_min_db`,
`wobble_len`, `bend_len`). "Detailed" keeps scoops and tails.

**Decision: an accent is not a new note.** The brief says a clear onset should keep notes apart, and also
that accents and swells should not create notes. Those conflict: an accent, a swell and even a change of
vowel ("I'm", "go") all produce a strong onset. When the words say "one syllable" I trust the words:
inside a word, an onset only counts together with at least a small dip in level. Without words the onset
alone decides.

**Decision: the notes are worked out again once the words are known.** On a fresh upload the notes are
found before the lyrics. The service now re-runs cleanup from the stored raw detection when the words
arrive or change (language, pasted lyrics), unless notes were fixed by hand.

**Before and after, 11 Creative Commons recordings** (`python -m notealong.catalog.recheck`):

| Song | Old result | Raw pieces | Joined as held notes | New result |
|---|---|---|---|---|
| Feel (Stripped) | 318 | 443 | 134 (131 same pitch, 0 vibrato, 3 scoops and tails) | 309 |
| Freifliegen | 207 | 339 | 131 (120 same pitch, 1 vibrato, 9 scoops and tails) | 208 |
| l'abandon | 296 | 330 | 18 (15 same pitch, 0 vibrato, 3 scoops and tails) | 312 |
| CHRISTMAS AVEC TOI | 359 | 410 | 44 (40 same pitch, 0 vibrato, 4 scoops and tails) | 366 |
| Le musée d'air contemporain | 252 | 289 | 26 (24 same pitch, 0 vibrato, 2 scoops and tails) | 263 |
| Les files d'attente | 319 | 365 | 51 (44 same pitch, 1 vibrato, 5 scoops and tails) | 314 |
| Mère nature | 341 | 395 | 56 (49 same pitch, 0 vibrato, 7 scoops and tails) | 339 |
| Fantasma | 162 | 264 | 84 (84 same pitch, 0 vibrato, 0 scoops and tails) | 180 |
| Is It Right? | 226 | 273 | 34 (33 same pitch, 0 vibrato, 1 scoops and tails) | 239 |
| Esencia | 349 | 426 | 32 (32 same pitch, 0 vibrato, 0 scoops and tails) | 394 |
| Bad Side | 355 | 438 | 89 (89 same pitch, 0 vibrato, 0 scoops and tails) | 349 |
| **Total** | **3184** | **3972** | **699** | **3273** |

The total went up by 2.8 %, not down. The old rule joined any two touching same-pitch notes inside a
word, which also swallowed real repeats in long words. The new rule joins more held notes and gives
those repeats back.

**Spot checks** (old notes, then new notes, concert pitch):

| Kind | Word | Old | New |
|---|---|---|---|
| Held note joined | "be" (Feel) | C#3 C#3 | C#3 |
| Held note joined | "pain" (Feel) | C#3 C#3 | C#3 |
| Scoop absorbed | "hält" (Freifliegen) | F4 F#4 | F#4 |
| Tail absorbed | "klein" (Freifliegen) | B3 D4 | B3 |
| Vibrato flip joined | "will" (Freifliegen) | G4 F#4 G4 F#4 | G4 F#4 |
| Real repeat kept | "unprepared" (Feel) | B2 B2 B2 | B2 B2 |
| Real repeat restored | "geschworen" (Freifliegen) | E4 | E4 E4 E4 |
| Real repeat restored | "alimenta" (Fantasma) | F#4 D4 | F#4 F#4 D4 D4 |
| Real repeat restored | "anocheciendo" (Esencia) | E4 F4 D4 | E4 E4 F4 D4 D4 |

**Uploads on this machine:** "Bad Side" 414 to 389 notes, "Feel (Stripped)" 356 to 341.

**Tests:** 16 new tests in `service/tests/test_held.py` (vibrato split, "hap-py birth-day" repeats, a new
word on the same pitch, level dip, long gap, accent inside one syllable, wobble, scoop and tail, passing
notes, held note running past its word, hand-fixed notes, no audio evidence). Python total: 47.

**Limits.**

- Most same-pitch repeats in these pop songs are real: three out of four sit exactly on a word start
  ("I know you" on one pitch). They are kept, as the brief asks.
- If the word timing puts the start of a word in the middle of a held note, the two halves stay two
  notes. Fixing that needs syllable-level alignment, not just word times.
- The raw detection for the 11 catalog recordings is now stored (`catalog/<id>/notes_raw.json`, 1.1 MB in
  all) so the notes can be re-derived in seconds. It was re-detected from the 192 kbps vocals stem, which
  changed a handful of individual notes compared with the first import.

## Part 3: "Hear it played" (virtual instrument)

**What it does.** A "Hear it played" button sits in the transport bar (the instrument's own icon plus the
label; `H` on the keyboard). When it is on, a sampled instrument plays the melody along with the backing
track. Settings has the same switch and a volume slider for it. It follows the selected instrument and
works on built-in songs and uploads, together with the guide vocal if that is on too.

**The sound.** Real recordings of single held notes, not General MIDI:

| Instrument in the app | Recordings | Notes sampled | Download |
|---|---|---|---|
| Alto sax | University of Iowa, non-vibrato | 9 | 0.6 MB |
| Soprano sax | University of Iowa | 9 | 0.7 MB |
| Tenor sax | VCSL (CC0) | 12 | 1.0 MB |
| Baritone sax | the tenor recordings, a fifth lower | | shared |
| Clarinet | University of Iowa | 14 | 0.9 MB |
| Flute | University of Iowa | 14 | 1.0 MB |
| Oboe | University of Iowa | 13 | 0.6 MB |
| Recorder | VCSL baroque soprano recorder (CC0) | 13 | 0.9 MB |
| Trumpet | University of Iowa | 10 | 0.7 MB |
| French horn | University of Iowa | 14 | 0.8 MB |
| Violin | VSCO 2 CE solo violin with vibrato (CC0) | 15 | 1.3 MB |
| Keyboard, and Voice | VCSL Steinway B (CC0) | 16 | 1.4 MB |

Licences are verified and recorded in `catalog/LICENSES.md`, with the libraries that were rejected and why
(the Philharmonia set forbids use "as a sampler instrument"). An instrument is downloaded only when it is
first selected with the feature on; nothing loads for people who never use it.

**How the notes are made to sound played** (`service/scripts/build_instruments.py`, then
`web/src/lib/sampler.ts`):

- Each recording is trimmed to its attack, and its real pitch is measured. Several source notes are well
  out of tune (up to 44 cents on the flute, 38 on the soprano sax); the player corrects each one, so the
  instrument is in tune with the backing track.
- A loop is found in the steady part of each tone (a whole number of periods, cross-faded, level evened
  out), so a note can be held for any length. Checked by simulation: no clicks at the loop joins on any of
  the 123 looped notes.
- Long notes bloom slightly after the attack, ease off towards the end, and get a vibrato that fades in
  after about half a second. Short notes get none of that. Every note differs by a few cents and a
  little in loudness, and a soft room reverb is added.
- The piano keeps its natural decay instead of a loop.

**Pitch.** The instrument sounds at concert pitch, moved with the key and the octave: exactly what the
player's own instrument will sound. The written transposition is only used for the letters on screen. It
uses the key of the audio that is actually loaded, so it stays in tune while a new key is being prepared.

**Timing** (`web/src/lib/hear.ts`). The notes are rendered live in the browser from the note data. Every
25 ms the scheduler reads the song position and books the notes of the next 0.22 s at their exact place
on the audio clock, allowing for the output delay of the device. Each note is placed from the song
position at that moment, so errors cannot add up. A seek, a loop wrapping round, a speed change, an edit,
a key or octave change drops what was booked and books again from the new position. The loop itself now
wraps on a timer set for the exact moment instead of being noticed up to 0.1 s late.

**Tests.**

- 12 unit tests (`hear.test.ts`): booking, speed scaling, no double booking, joining a note half-way,
  and a simulated 4-minute song at 1x and 0.5x with a coarse media clock and an uneven scheduler: every
  note within 15 ms of where the song really is.
- Real browser, whole songs (`web/scripts/check-hear-sync.mjs`, headless Chromium). For every note it
  records where the song was, by the media clock itself, at the instant the note sounded:

| Song | Speed | Notes measured | Mean error | Spread | Worst | Start to end |
|---|---|---|---|---|---|---|
| Frère Jacques (39 s) | 1x | 64 of 64 | 0.0 ms | 1.7 ms | 4.4 ms | no trend |
| Frère Jacques | 0.5x | 64 of 64 | -0.3 ms | 3.5 ms | 8.6 ms | no trend |

- The real sampler rendered offline for all 12 instruments (`web/scripts/render-hear-demo.mjs`) and
  measured: tuning within 5 cents on average for every instrument (the pitch tracker's own step is 10
  cents), level -18 to -21 LUFS at the default volume (the backing tracks are at -16), no clipping.
- Keyboard toggle, key change while playing and switching off were exercised in the browser.

**Limits and honest notes.**

- I cannot hear the result. Tuning, levels, loop joins and timing are measured; whether the sax sounds
  *good* needs your ears. The Iowa notes were recorded at full volume, so the tone is on the bright side;
  a gentle low-pass takes the edge off. If it sounds harsh, lower `tone` for that instrument in
  `build_instruments.py`.
- The baritone is the tenor played a fifth lower, which is close to how the real instruments relate, but
  it is not a recording of a baritone. No free baritone recordings with a clear licence were found.
- "Voice" plays a piano, as a reference pitch for singers.
- If the browser tab is in the background, browsers slow timers down and notes may be skipped until the
  tab is visible again.
- The first note after a loop wraps can be up to about 25 ms late.

