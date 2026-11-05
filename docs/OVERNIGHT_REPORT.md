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

