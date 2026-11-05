# Overnight improvement run

Started 4 November 2026, late evening; finished about 09:30 on 5 November. This file was written as the
work went, part by part. Each part ended with the Python tests, the frontend tests and the production
build passing, then a commit and a push.

## Summary

| Part | Status | In one line |
|---|---|---|
| 1. Timing guide | done | Duration bar under every note, a line that sweeps through the words, a "get ready" outline one beat ahead, a 3-2-1 count after pauses longer than 2 s. On by default. |
| 2. Held notes | done | Fragments of one sustained sound are joined (same pitch, scoops, tails, vibrato flips); real repeats are protected by a syllable count. 16 tests. |
| 3. Hear it played | done | 11 sampled instruments from verified free recordings, played live in the browser at sounding pitch; every note within 16 ms of the backing track over whole songs at 1x and 0.5x. |
| 4. Backing tracks | done | 23 band styles, intros on every song, moving bass, drum fills, a real mix at -16 LUFS; all hand-authored songs re-rendered; 10 files to listen to. |
| 5. Catalog | done, one song short | 59 to 144 songs: +46 public domain (target 30), +39 Creative Commons recordings (target 40). Discover reworked for the larger catalog. |
| 6. Accuracy | done | Evaluation against an independent reference; tempo-aware thresholds; note F1 0.56 to 0.61, fast songs 0.52 to 0.59, no song worse. |

**Catalog, by source**

| Source | Before | After |
|---|---|---|
| Hand-authored public-domain songs | 48 | 94 |
| Creative Commons recordings, JamendoLyrics set (hand-timed words) | 11 | 11 |
| Creative Commons recordings, Internet Archive mirror of Jamendo (CC BY 3.0) | 0 | 39 |
| **Total** | **59** | **144** |

19 languages, 32 easy songs, 76 medium, 36 hard.

**Checks at the end:** 53 Python tests, 65 frontend tests, production build passing, lint unchanged from
before the run (11 old findings in the original player code). All 94 rendered backing tracks pass the
audio audit.

**Licences:** every instrument recording and soundfont, with the terms it is used under and the ones that
were rejected, is in `catalog/LICENSES.md`.

### What went wrong

- **About five hours were lost between roughly 01:20 and 08:10.** I ran three import processes and an
  evaluation job at once. Each holds several gigabytes of models; together they exhausted the machine's
  memory, swap grew to 49 GB and everything slowed to a crawl. I only saw it when a simple command took
  an hour to return. I stopped the jobs, let the machine recover and ran one import at a time after that
  (about a song a minute). The cost: 39 recordings instead of 40 or more, the first 11 recordings not
  re-imported, and less time for listening-sample variety. Nothing was corrupted: half-finished imports
  were deleted and every kept song was re-checked. The importer's documentation now says to run one at a time.
- **Your Mac may still feel slow** until the swap drains; a restart clears it.
- I restarted the local web and service processes during the night so they would run the new code. Both
  are running now on the usual ports.

### Things I could not do, or chose not to

- **Listen.** Everything about sound was verified by measurement. `docs/listening-samples/` is there so
  you can judge the sax tone, the band arrangements and the mix with your ears.
- **40 recordings.** 39. Archive.org started refusing requests at the end.
- **A person's check of the recordings' words and rights** (see Part 5).
- **Africa, India and the Arabic-speaking world** are barely represented among the new public-domain songs:
  the candidates lacked either a documented early origin or a score that could be checked.
- **A real baritone sax recording.** The baritone is the tenor played a fifth lower.
- **A hand-written answer key for accuracy.** The reference in Part 6 is built from human word timings and
  a second pitch tracker; it is good for before/after, less so for absolute numbers.
- No free tier, paywall, accounts or payments were built, as instructed.

### Top five things I would do next

1. **Have a musician write out the notes of three or four recordings.** That gives a real answer key, turns
   Part 6 from "better by our measure" into "right", and shows where the pipeline is actually wrong.
2. **Syllable-level word timing** (forced alignment of the lyrics to the voice). Most remaining held-note
   mistakes come from word boundaries falling in the middle of a held note; with syllables, the
   display could also put one letter per syllable reliably.
3. **A rights and words review of the 39 new recordings**, then a credits page listing every Creative
   Commons song with artist, licence and link. Needed before the app is sold.
4. **Listen to the ten samples and tune by ear**: the sax brightness, the level of each band member, the
   drum fills. The numbers to change are a handful of constants in `build_instruments.py` and `render.py`.
5. **Stop accidental loops.** Dragging on the progress line creates a loop; two songs on this machine
   have one saved over most of their length. A drag should scrub, and looping should need a deliberate
   gesture (Shift-drag, or a "Loop" mode button).

Also worth doing: re-import the first 11 recordings for matched loudness; more soul, R&B and upbeat pop
(they may need a different source than Jamendo's CC BY catalog); a "Simple" default for fast songs if the
extra short notes from Part 6 feel like too much.

---

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


Added after the first write-up: the same browser check on a full-length recording (Mère nature, 3:45,
339 notes): at 1x mean -1.7 ms, spread 4.2 ms, worst 12.4 ms; at 0.5x mean -2.3 ms, spread 4.7 ms, worst
15.5 ms. The notes at the end of the song land within 1 ms of where the notes at the start do, at both
speeds. (A first run at 1x measured only 261 of the 339 notes because the machine was busy with another
analysis job at the time; the repeat measured all of them.)

## Part 4: much better backing tracks

**What changed.** The arranger (`service/notealong/catalog/arrange.py`) and the renderer
(`service/notealong/catalog/render.py`) were rewritten. Every hand-authored song now has a small band
chosen for the kind of song, and all 48 were re-rendered.

**Arrangements.** 23 styles, each a band of 3 to 6 players. The full table is in
`catalog/songs/README.md`. The ones the brief named:

| Style | Band |
|---|---|
| folk | strummed steel-string guitar, a second guitar finger-picking, upright bass, brushes and shaker |
| gospel | piano, tonewheel organ, electric bass with walk-ups, drums with tambourine |
| carol | strings, harp, soft choir, tubular bells, double bass, sleigh bells (bright carols) or triangle (slow ones) |
| swing | walking bass, brushes, piano comping, horn stabs where the melody rests or holds |
| waltz | oom-pah-pah piano, strings, upright bass, brushes |
| latin | nylon guitar in a rumba strum, a second guitar, bass, maracas, claves, congas |
| lullaby | soft piano arpeggios, a warm pad, music box, bass |

Others: country, ballad, march, hymn, celtic, shanty, klezmer, polka, italian, asian, african, indian,
arabic, andean, children, orchestral. Each of the 48 songs was given a style in its `.song` file
(for example Danny Boy: celtic; Hava Nagila: klezmer; Sakura: asian; Oh Susanna: country; Ode to Joy:
orchestral). The band never plays the melody.

**Intro.** Every song now starts with an instrumental intro: two bars, one bar when a bar is longer than
about 3 seconds, four when bars are very short. The first melody note falls between 2.1 and 6.0 s
(median 3.75 s). The last intro bar ends with a drum fill, and in gospel the intro starts on hi-hat alone
so the count is obvious. Together with Part 1 this means every song opens with a groove, then a
3-2-1 count on screen, then the first note.

**Played, not programmed.**

- Voicings move by the smallest step from chord to chord and sit below the melody (checked by a test).
- Bass lines move: root and fifth with a leading note into each new chord, a true walking line for swing,
  anticipations for latin, alternating root and fifth for oom-pah styles.
- Drum fills on the last bar of the intro, every eighth bar and the last bar of the song, with a crash on
  the next downbeat where the kit has one. A clear final hit and a held last chord.
- Every note is nudged in time (about 9 ms standard deviation, never more than 22 ms) and in loudness.
  The random numbers are seeded per song, so a rebuild gives the same track.
- Guitars are strummed string by string, down and up. Swing eighths are swung.

**Sounds.** Two soundfonts, each instrument taken from the one where it is stronger: GeneralUser GS 2.0.3
(guitars, basses, accordion, harp, brass, choir, bells, all drum kits including brushes) and MuseScore
General (piano, strings, church organ, timpani). Licences verified and recorded in `catalog/LICENSES.md`,
including one caveat about GeneralUser GS that you should read.

**Mix and master** (all in our own code plus FFmpeg):

- Each instrument is rendered on its own, then levelled by measured loudness for its role (main chord
  instrument, second chord instrument, bass, percussion, pad, colour), panned, and sent to a shared room
  reverb (room, club, hall or chapel depending on the style).
- EQ: everything except bass and kick is high-passed; chord instruments and pads are cut by 2 to 3.5 dB
  around 1.7 kHz, where a sax or voice speaks most clearly. Measured on the demo mixes: the backing has
  3 to 7 % of its energy between 800 Hz and 3 kHz, and the added instrument takes that band up to 10 to
  32 %. A small high shelf adds air.
- Gentle bus compression, then loudness normalised in two passes to -16 LUFS, with a limiter. The encoded
  file is decoded again and checked; if lossy encoding pushed a sample to full scale, the ceiling is
  lowered and the file encoded again (this happened on one song).
- 128 kbps stereo. The 48 backing tracks total 45 MB.

**Verified by analysis** (`python -m notealong.catalog.audit`), all 48 tracks: loudness -16.9 to -16.3
LUFS, highest true peak -0.9 dB, no clipped samples, no silent stretch anywhere inside a song, no track
with a problem flagged. By style:

| Style | Songs | LUFS | Highest true peak | Bass and sub | Low-mid | Presence | Air | First melody note |
|---|---|---|---|---|---|---|---|---|
| asian | 3 | -16.4 | -3.4 dB | 34 % | 42 % | 23 % | 1 % | 3.6 to 6.0 s |
| ballad | 3 | -16.5 | -2.5 dB | 47 % | 45 % | 6 % | 2 % | 5.5 to 5.7 s |
| carol | 8 | -16.4 | -3.3 dB | 39 % | 49 % | 9 % | 3 % | 2.2 to 5.7 s |
| celtic | 7 | -16.4 | -3.1 dB | 51 % | 45 % | 3 % | 1 % | 2.3 to 5.2 s |
| children | 4 | -16.5 | -2.8 dB | 49 % | 42 % | 4 % | 5 % | 4.0 to 5.0 s |
| country | 3 | -16.4 | -3.0 dB | 59 % | 25 % | 11 % | 5 % | 2.8 to 3.3 s |
| folk | 2 | -16.7 | -0.9 dB | 59 % | 28 % | 6 % | 7 % | 3.0 to 4.6 s |
| gospel | 5 | -16.4 | -2.6 dB | 53 % | 42 % | 3 % | 2 % | 3.6 to 6.0 s |
| italian | 3 | -16.4 | -3.3 dB | 37 % | 49 % | 7 % | 7 % | 3.4 to 4.6 s |
| klezmer | 2 | -16.6 | -3.3 dB | 35 % | 37 % | 17 % | 10 % | 3.2 to 4.0 s |
| latin | 1 | -16.4 | -2.9 dB | 51 % | 43 % | 4 % | 1 % | 2.1 s |
| lullaby | 2 | -16.4 | -3.2 dB | 32 % | 66 % | 2 % | 0 % | 3.8 to 4.4 s |
| march | 1 | -16.4 | -3.3 dB | 47 % | 33 % | 19 % | 1 % | 4.3 s |
| orchestral | 1 | -16.4 | -4.2 dB | 37 % | 56 % | 6 % | 0 % | 4.8 s |
| polka | 1 | -16.5 | -3.3 dB | 39 % | 44 % | 14 % | 2 % | 3.0 s |
| swing | 1 | -16.5 | -1.7 dB | 58 % | 29 % | 7 % | 7 % | 2.4 s |
| waltz | 1 | -16.5 | -3.0 dB | 48 % | 44 % | 7 % | 2 % | 2.8 s |

Three tuning rounds were driven by these numbers: the bass was moved up a third and levelled without
the loudness weighting (the lowest notes had been far too loud: up to 29 % of a track's energy sat below
60 Hz), accompaniment voicings were moved down out of the melody's register, and tambourine, sleigh bells
and woodblock were turned down (one klezmer track had 20 % of its energy above 3 kHz).

**For your ears.** `docs/listening-samples/` has the six tracks the brief asked for (waltz, 6/8 carol,
swing, gospel, folk, latin) and four "Hear it played" demos mixed over the new tracks, with a short
note on what to listen for.

**Tests.** The arranger tests were rewritten: every one of the 23 styles gives a full band that stays
inside the track; the intro precedes the melody; the accompaniment stays under the top of the tune; the
bass walks; timing is loose but never more than 30 ms off; the same seed gives the same track; fills and
crashes mark the sections; 3/4 and 6/8 work. Python total: 52.

**Limits and honest notes.**

- These are still sampled instruments played by rules. They are a clear step up from one piano, with real
  band textures, but they will not be mistaken for a studio recording. The real recordings (Part 5) are
  the ones that sound like records.
- Levels were set by loudness measurement per role, not by ear. If something sits wrong, the role levels
  are six numbers at the top of `render.py`.
- Lullabies and children's songs are deliberately mellow (little energy above 800 Hz).
- The intro always uses the song's first chord unless a song sets `intro_chords`.
- All note timings in the 48 songs moved because the intros got longer. Settings saved on this machine
  for built-in songs (position, loop) refer to the old timings; a saved loop may now sit a bar early.

## Part 5: grow the catalog

### Public-domain songs: 46 added (48 before, 94 now)

Four agents each took a part of the world or a kind of song. The rules they worked to: both melody and
words public domain everywhere (authors dead by 1955, or published before 1929, or anonymous with a
documented origin before 1900); every melody checked note by note against a notated source fetched during
the work (the source is in each file's `source_url`); anything uncertain skipped. I spot-checked four
well-known tunes myself (Drunken Sailor, O Come All Ye Faithful, Simple Gifts, Aloha ʻOe) and they are
right. All 46 pass the format checker, are rendered with the new arrangements and pass the audio audit.

| Group | Added |
|---|---|
| Hymns | Abide with Me, Be Thou My Vision, What a Friend We Have in Jesus, Simple Gifts, Maʻoz Tzur, Yigdal, Nkosi Sikelel' iAfrika |
| Spirituals | Go Down Moses, He's Got the Whole World in His Hands, Joshua Fit the Battle of Jericho, Nobody Knows the Trouble I've Seen |
| Sea shanties | Drunken Sailor, Blow the Man Down, Haul Away Joe |
| Christmas | O Come All Ye Faithful, Hark! The Herald Angels Sing, Angels We Have Heard on High, We Three Kings, Go Tell It on the Mountain, Shchedryk (the Ukrainian original of "Carol of the Bells") |
| Celebration | Las Mañanitas, Hevenu Shalom Aleichem |
| Latin America, Spain | De colores, La Paloma, La Golondrina, A la nanita nana, Los pollitos dicen, Arroz con leche, Ciranda cirandinha, ¿Dónde vas, Alfonso XII? |
| Africa | Nkosi Sikelel' iAfrika, Sarie Marais |
| Middle East | Üsküdar'a Gider İken, Hatikvah, Hevenu Shalom Aleichem, Maʻoz Tzur, Yigdal |
| South Asia | Ekla Chalo Re (Tagore) |
| Eastern and Northern Europe | Korobeiniki, Ochi Chyornye, Shchedryk, Die Gedanken sind frei, Muss i denn, Vem kan segla förutan vind, Du gamla, du fria |
| East Asia and the Pacific | Kōjō no Tsuki, Furusato, Tōryanse, Song Bie, Aloha ʻOe, Hine e Hine |

**Skipped, and why.** This list matters as much as the one above.

| Song | Reason |
|---|---|
| Wellerman | Not public domain. The chorus and the "Wellerman" verse were added in 1966 and it was first published in 1972/73. |
| Take Me Out to the Ball Game | Jack Norworth died in 1959. |
| Shosholoza, Tue Tue, Obwisana, Thula Baba | No documented origin before 1900 and no notated source that could be checked. |
| La Llorona, La Bamba, Los peces en el río, Peixe vivo | Earliest documentation is 20th century, or no fixed traditional melody, or no source. |
| Sto lat, Hej sokoły, Tavaszi szél, Doraji Taryeong | Origin unknown, or collected or reworked in the 20th century. |
| Raghupati Raghava Raja Ram, Vaishnava Jana To, Om Jai Jagdish Hare, Jana Gana Mana | No staff notation with words that could be checked; for one, the tune may come from a 1970 film. |
| Lamma Bada Yatathanna | It is in 10/8, which the song format cannot write. |
| Pōkarekare Ana | The verse is in 2/4 and the refrain in 3/4; one song file has one metre. |
| Bahay Kubo | Public domain, but the only score sat behind a "verify you are human" page, which was not clicked through. |
| Bridal Chorus, Wade in the Water, Leron Leron Sinta, Rasa Sayang, Shalom Chaverim, Dayenu, and others | No public-domain singable words, no reliable notation, or unclear origin. |

The brief asked for a wider spread including Africa, India and the Middle East. Honest result: Europe,
Latin America, East Asia and the hymn, spiritual and shanty repertoire grew well; **Africa (2), India (1)
and the Arabic-speaking world (0) are thin**, because songs from those traditions rarely have both a
documented early origin and a checkable score. That needs a person with the right songbooks.

**Doubts the authors flagged** (all in the files' `attribution` lines; worth a listen):

- *Korobeiniki* is the tune as printed in Russian vocal scores, which differs in three places from the
  "Tetris" version most people know.
- *Nkosi Sikelel' iAfrika* uses Sontonga's original first stanza, not the wording of the national anthem,
  whose later changes could not be traced to an author.
- *He's Got the Whole World in His Hands*: the 1927 first print was not seen; the tune is the common one.
- *La Golondrina*, *Ochi Chyornye*, *Joshua*, *Go Tell It on the Mountain*: sources disagree in a bar or
  two; the choice made is noted in each file.
- *Ekla Chalo Re* is the refrain only, read from a hand-written scan and cross-checked against sargam.
- Some death years were given from the agents' memory rather than a fetched page (listed in their notes:
  Dybeck, Motoori, Ordway, Li Shutong, Howie, Toerien, Matmon-Cohen). They are all well before 1955.

### Creative Commons recordings

**39 added (11 before, 50 now).** One short of the 40 the brief asked for; the reason is in "What went
wrong" at the top of this report.

**Where they come from.** Jamendo's own site cannot be searched or licence-checked without an account,
and ccMixter and the Free Music Archive still refuse scripted downloads. The Internet Archive holds a
mirror of Jamendo albums (collection `jamendo-albums`), and each album record there carries its licence
URL. `service/scripts/import_ia_jamendo.py` works from that:

1. Only albums whose record has a CC BY or CC BY-SA licence URL (about 27,000 of 294,000 albums). The
   licence is read a second time from the album's own metadata before anything is downloaded.
2. Tags must suggest a song with singing (pop, rock, folk, soul, blues, reggae, latin, country, chanson,
   and so on) and none of 60 tags that suggest otherwise (instrumental, ambient, techno, rap, metal...).
3. One track per album, 2:10 to 4:50 long, not a remix, live take, demo or cover by its title.
4. Two 20-second excerpts are separated; albums without a clear voice are dropped.
5. Full import: stems, notes, review of every note against pYIN, held notes joined, words by Whisper with
   automatic language detection. Stems are loudness-matched to the built-in tracks (128 kbps backing,
   64 kbps mono guide vocal, so each song costs about 5 MB in the repository).
6. Automatic judgement: dropped if there is too little singing, if it is spoken or rapped, if the melody
   barely moves, if the second pitch tracker rejects more than 22 % of the notes, or if the language is unclear.
7. One song per artist, capped per style so no style dominates.
8. **I read the opening words of every imported song.** That caught two covers of famous songs that carried
   a CC licence their uploaders had no right to give: "Peter Pan" (the words of Disney's "You Can Fly!")
   and "My Way". Both were removed and blocked, with six more removed for unusable words or unsuitable
   content. The MTG-Jamendo research dataset would have been a quicker way to find tracks, but its terms
   forbid commercial use of the dataset, so it was not used.

**The numbers.** 84 albums were tried: 39 kept, 10 had no clear vocals, 10 had no track of a usable length
or title, 8 failed to download, 8 were removed by hand, 7 failed the automatic judgement, and 2 were
second songs by an artist already in.

| Style | Songs | | Language | Songs |
|---|---|---|---|---|
| Folk | 6 | | English | 24 |
| Indie | 5 | | Russian | 6 |
| Acoustic | 5 | | French | 5 |
| Chanson | 4 | | Portuguese | 2 |
| Country | 4 | | Italian | 1 |
| World | 3 | | German | 1 |
| Blues | 3 | | | |
| Latin, Pop, Reggae, Rock | 2 each | | | |
| Soul & R&B | 1 | | | |

All 39 are CC BY 3.0. The brief asked for R&B, soul and upbeat pop in particular: those are the thinnest
(3 songs between them). Jamendo's CC BY catalog leans to rock, folk and singer-songwriters.

| Artist | Song | Style | Language | Notes | Words |
|---|---|---|---|---|---|
| A Jovian Night | Fool In Modern Times | Indie | en | 322 | 197 |
| Abrids | take a seat | Indie | en | 277 | 223 |
| Adragante | le manoir | Chanson | fr | 192 | 176 |
| AGORA-OU-NUNCA | ASK GOD | Latin | pt | 403 | 330 |
| Al Ryden | Quiet haven | World | ru | 368 | 148 |
| Alobi | alobi e menestrello | World | it | 220 | 133 |
| Anastasia Glam | Зая, еду к тебе... | Pop | ru | 418 | 232 |
| Berkley Mallin | Caught on the Wire | Folk | en | 271 | 198 |
| BETP5 | Tool and Die | Folk | en | 314 | 274 |
| Billie | Oh My Love | Acoustic | en | 206 | 118 |
| Black_Angel | Не подходи ко мне | Blues | ru | 206 | 169 |
| Dan Falvey | When diamonds turn to dust | Folk | en | 230 | 136 |
| David Crowe | Eternity | Soul & R&B | en | 153 | 82 |
| Devon Elizabeth | Outta Here | Country | en | 345 | 137 |
| Dirty Dukes | Don't Forget To Breathe | Blues | en | 234 | 226 |
| Ellis band | Just Be | Folk | ru | 428 | 209 |
| Evergreen Machine | Heartless | Country | en | 475 | 288 |
| Gamssy Ghoulz | Poucet | Chanson | fr | 382 | 272 |
| Giocol | The fool with a thousand ridiculous faces | Pop | en | 209 | 91 |
| Heiko Sunfyah | Die Geburt | Reggae | de | 157 | 80 |
| jacky.daniel | Tu m'oublies | Chanson | fr | 244 | 223 |
| Jeff-J | Yes i love you | Reggae | en | 445 | 312 |
| Josh Bonanno | Tonight | Acoustic | en | 238 | 138 |
| Josh Woodward | California Lullabye | Folk | en | 423 | 308 |
| Leo Walden | En toute sécurité | Chanson | fr | 545 | 460 |
| Lepellec dominique | les brumes reverb | World | fr | 131 | 103 |
| marcello correa e castro | TROMBADINHA | Latin | pt | 371 | 193 |
| Melanie Ungar | What Is Love | Country | en | 454 | 317 |
| Ocean Jet | In Red | Indie | en | 281 | 157 |
| Prey For Penguins | The First One | Folk | en | 183 | 155 |
| Rasmus Söderberg | Favorite Shade Of Blue | Acoustic | en | 312 | 223 |
| Rinzo & The Hey Hey Panthers | Run run Superman | Indie | en | 236 | 115 |
| Seth Power | Messes | Acoustic | en | 320 | 105 |
| SHOR | Я у себя есть. | Rock | ru | 463 | 201 |
| The Dream Pop Project | Wishing well | Indie | en | 169 | 110 |
| The Fourth Horseman | Lovers & Liars | Rock | en | 384 | 210 |
| The woods | An Angel In Fly | Country | en | 207 | 102 |
| VITNE | Masquerade | Acoustic | en | 335 | 238 |
| YUKON | Its So Cold Without You | Blues | ru | 220 | 157 |

**What you should know before selling these.**

- **The words are Whisper's, not checked by a person.** Several songs have long stretches where no words
  were heard (Devon Elizabeth, Seth Power, SHOR, Rinzo, Dan Falvey: a quarter to a third of their notes
  have no word under them). The notes there are still shown, as "no words" blocks. Settings now say this
  plainly, and edit mode works on built-in songs.
- **A CC licence on Jamendo is the uploader's claim.** I removed the two covers I could recognise from
  the words. I cannot rule out a less famous cover, a sample, or words taken from a poem. "le manoir" by
  Adragante reads like a set poem; I could not identify it. Before charging for the app, someone should
  look through this list of 39 once.
- **CC BY needs credit.** Artist, title, licence and source are stored for every song and shown in the
  song's settings and on the print sheet. A credits page listing all of them would be the safe addition.
- **Lyrics were not screened for strong language.**
- **The first 11 recordings were not re-imported**, so they still play at their original loudness (from
  -11 to -21 LUFS) and are 192 kbps. The 39 new ones are matched to the built-in tracks. The originals
  are still on this machine; re-importing them is a 15-minute job.
- Their notes were re-derived with the Part 6 settings, like every other recording.

To add more, run `cd service && .venv/bin/python scripts/import_ia_jamendo.py --want 80 --max-tries 60`.
Run one at a time (see below), and read the words of what it adds.

### Discover for a large catalog

- **Jump back in**: the songs you played last (the catalog API now reports when you last used each one).
- **New this week**: songs that joined in the last seven days (the 46 new public-domain songs today).
- Rows are capped at 18 tiles with **See all** opening the full list; at most five style rows.
- A **Browse** index replaces a row per country: styles, parts of the world (eight regions) and languages,
  each with its song count. The filter panel shows the same, with counts, and hides one-song entries.
- **Sorting** everywhere: A to Z, newest, easiest first, shortest first, most played. "Most played" reads a
  `popularity` number on each song (0 for now), then featured, then title, so it is ready for real play
  counts without any change to the app.
- The full list shows 24 songs with a "Show all" button instead of a hundred tiles.
- First version critique: the home page was 26,000 pixels tall with a row for every region and language.
  The Browse index cut it by more than half.
- Settings now say plainly how a song's words and notes were made (written by hand, timed by hand, or
  worked out automatically). The previous "checked by hand" line was not true for recordings.

## Part 6: fast song accuracy

**The evaluation** (`python -m notealong.catalog.evaluate`, `--tune` for the comparison).

There is no hand-written answer key for these songs: I said in the first round that the notes of the
recordings were "hand-checked", and that was loose wording. They were checked by a second pitch tracker,
not by a person. So the reference had to be built, from two sources that are independent of the detector:

- word timings made by people (the JamendoLyrics annotations of the first 11 recordings), and
- the pitch of the voice measured with CREPE, a different tracker from Basic Pitch (which finds our
  notes) and pYIN (which reviews them).

Inside each human-timed word the CREPE pitch is cut into notes wherever it settles on a new semitone.
A detected note counts as right when it starts within 100 ms of a reference note and has the same pitch.
Same-pitch repeats inside one word are merged on both sides first, because a word-level reference cannot
say how many syllables were sung on one pitch. Treat the absolute numbers with care (the reference has
errors of its own); the before/after differences are what matter.

**Baseline and result, per song** ("balanced" level):

| Song | Tempo | F1 before | F1 after | Precision | Recall before | Recall after | Onset error | Sung time right, before | after |
|---|---|---|---|---|---|---|---|---|---|
| Feel (Stripped) | 103 | 0.68 | 0.71 | 0.86 | 0.56 | 0.61 | 32 ms | 74% | 75% |
| Freifliegen | 118 | 0.51 | 0.54 | 0.61 | 0.43 | 0.48 | 26 ms | 63% | 64% |
| l'abandon | 103 | 0.50 | 0.56 | 0.74 | 0.38 | 0.45 | 24 ms | 54% | 56% |
| CHRISTMAS AVEC TOI | 144 | 0.46 | 0.50 | 0.56 | 0.38 | 0.46 | 35 ms | 51% | 52% |
| Le musée d'air contemporain | 112 | 0.51 | 0.61 | 0.72 | 0.41 | 0.52 | 28 ms | 51% | 55% |
| Les files d'attente | 123 | 0.47 | 0.55 | 0.62 | 0.38 | 0.49 | 29 ms | 54% | 57% |
| Mère nature | 112 | 0.55 | 0.61 | 0.78 | 0.43 | 0.50 | 30 ms | 59% | 61% |
| Fantasma | 112 | 0.68 | 0.68 | 0.77 | 0.60 | 0.61 | 32 ms | 75% | 75% |
| Is It Right? | 136 | 0.56 | 0.64 | 0.74 | 0.46 | 0.56 | 27 ms | 61% | 63% |
| Esencia | 99 | 0.68 | 0.71 | 0.89 | 0.55 | 0.59 | 26 ms | 69% | 70% |
| Bad Side | 144 | 0.58 | 0.65 | 0.65 | 0.54 | 0.65 | 30 ms | 69% | 71% |
| **Mean** | | **0.56** | **0.61** | **0.72** | **0.46** | **0.54** | **29 ms** | **62%** | **64%** |

No song got worse. The four fast songs (120 bpm and above) went from F1 0.52 to 0.59.

**What was changed.**

1. **Tempo-aware thresholds** (`cleanup.tempo_scaled`). The time thresholds (minimum note length, merge
   gap, held-note gap, vibrato and bend lengths) were chosen for about 100 bpm. For faster songs they now
   shrink in proportion to the tempo, never below 60 % of their normal value because detected tempos are
   sometimes double the felt tempo. Slow songs are unchanged. On its own: F1 0.562 to 0.588, fast songs
   0.517 to 0.570.
2. **"Balanced" keeps notes from 0.10 s** (was 0.12 s). With the tempo scaling: F1 0.614. Precision did
   not move (0.72), so the extra notes are as often right as the ones already shown.

**Everything that was tried** (mean over the 11 songs):

| Setting | F1 | Precision | Recall | Onset recall | Onset error | Sung time right | F1, 4 fast songs | Notes shown |
|---|---|---|---|---|---|---|---|---|
| fixed thresholds (before) | 0.562 | 0.717 | 0.465 | 0.546 | 31 ms | 61.6% | 0.517 | 3273 |
| tempo-aware thresholds | 0.588 | 0.722 | 0.501 | 0.578 | 30 ms | 62.5% | 0.570 | 3536 |
| **tempo-aware, minimum 0.10 s (adopted)** | **0.614** | **0.721** | **0.539** | **0.616** | **29 ms** | **63.5%** | **0.585** | **3829** |
| tempo-aware, minimum 0.14 s | 0.559 | 0.713 | 0.465 | 0.544 | 31 ms | 61.4% | 0.553 | 3271 |
| tempo-aware, minimum 0.09 s | 0.623 | 0.720 | 0.553 | 0.630 | 28 ms | 63.8% | 0.589 | 3951 |
| tempo-aware, minimum 0.08 s | 0.633 | 0.720 | 0.568 | 0.645 | 28 ms | 64.1% | 0.597 | 4069 |
| minimum 0.10 s without tempo scaling | 0.593 | 0.722 | 0.506 | 0.585 | 30 ms | 62.7% | 0.557 | 3556 |
| quieter notes kept (confidence 0.30) | 0.588 | 0.701 | 0.512 | 0.605 | 31 ms | 64.3% | 0.563 | 3770 |
| quieter notes dropped (confidence 0.40) | 0.579 | 0.741 | 0.480 | 0.544 | 29 ms | 60.2% | 0.562 | 3280 |
| stickier lead line (continuity 0.30) | 0.584 | 0.717 | 0.498 | 0.576 | 30 ms | 62.3% | 0.570 | 3542 |
| freer lead line (continuity 0.12) | 0.591 | 0.725 | 0.504 | 0.580 | 30 ms | 62.6% | 0.571 | 3539 |
| weaker notes kept (relative 0.22) | 0.588 | 0.722 | 0.501 | 0.578 | 30 ms | 62.5% | 0.570 | 3536 |
| held notes joined across longer gaps (0.22 s) | 0.588 | 0.722 | 0.501 | 0.578 | 30 ms | 62.5% | 0.570 | 3533 |
| held notes joined only when touching (0.06 s) | 0.588 | 0.722 | 0.501 | 0.578 | 30 ms | 62.5% | 0.570 | 3564 |
| scoops and tails kept (bend 0) | 0.595 | 0.723 | 0.511 | 0.586 | 30 ms | 62.8% | 0.575 | 3596 |
| minimum 0.10 s + confidence 0.30 | 0.615 | 0.698 | 0.554 | 0.646 | 29 ms | 65.5% | 0.577 | 4101 |
| minimum 0.10 s + confidence 0.32 + continuity 0.15 | 0.619 | 0.710 | 0.552 | 0.639 | 29 ms | 65.1% | 0.588 | 4009 |
| minimum 0.10 s + merge gap 0.06, leap penalty 0.01, or octave bias 0.6 | 0.614 | 0.721 | 0.539 | 0.616 | 29 ms | 63.5% | 0.585 | 3830 |

**Decisions, and where I stopped short of the maximum.**

- The score keeps rising as the minimum note length falls (0.08 s scores 0.633). I adopted 0.10 s, not
  0.08 s. Below 0.10 s the gain comes from grace notes and quick turns that a learner cannot play, the
  screen gets 24 % busier than before instead of 17 %, and "balanced" would become almost the same as
  "detailed" (0.07 s). This is a judgement call: the number is one line in `config.py`.
- Keeping scoops and tails scores slightly higher (0.595 against 0.588), because the reference counts a
  scoop as a note. Part 2 asked for them to be absorbed, so they still are.
- The held-note thresholds make no measurable difference on this reference (it merges repeats inside a
  word before scoring), so Part 2's values stand.
- Lower confidence thresholds raise recall but lose precision by the same amount: not adopted.

**Read this before trusting the numbers.** Recall of 0.54 means the reference contains many short notes
we do not show. Some of those are real ornaments, some are CREPE reacting to slides. Precision of 0.72 at
a 100 ms window with exact pitch is the more useful figure: about seven of ten notes on screen start at
the right moment on the right pitch by an independent measure, and "sung time right" says the displayed
pitch matches the voice for 64 % of the sung time. A proper answer key (a musician writing out three or
four songs) would make all of this far more trustworthy, and is the first thing I would do next.

