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

