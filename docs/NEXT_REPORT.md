# NoteAlong: second overnight run

Brief: great uploads, famous legal songs, better backing tracks, better browsing.
Started 6 November 2026. Everything below was measured on this Mac (Apple silicon, 32 GB) with
the app running as a user would run it (`./start.sh`, Chromium driving http://localhost:3000).

Working rules kept throughout: one heavy job at a time (`service/scripts/heavy.sh` refuses to start a
second one and checks free memory first), thread counts capped at 6, commit and push after each part.

## Part 1: the upload path, end to end

### Six Creative Commons songs through the browser

Each file was dropped on My songs in Chromium, the processing screen was watched until "ready",
the player was opened with the timing guide and Hear it played on, and a screenshot was taken.
All six reached the player and were playing with timing bars; no page errors; no step ever stalled.
Times are wall-clock seconds on the first attempt (Demucs on the GPU via MPS, Whisper small on CPU).

| Song (style, language) | Length | Total | Stems | Notes | Lyrics | Words / notes | Words with a note | Word to note offset (median / 90th) | Leftover voice in backing |
|---|---|---|---|---|---|---|---|---|---|
| Giocol, The Fool (pop, en) | 3:10 | 36 s | 21.8 | 5.4 | 6.8 | 91 / 210 | 91 % | 60 / 220 ms | −50.5 dB |
| The Fourth Horseman, Lovers & Liars (rock, en) | 3:08 | 38 s | 18.0 | 4.4 | 13.5 | 211 / 392 | 98 % | 80 / 230 ms | −48.5 dB |
| David Crowe, Eternity (soul, en) | 2:11 | 32 s | 14.2 | 4.0 | 11.1 | 82 / 152 | 85 % | 80 / 200 ms | −40.0 dB |
| Gamssy Ghoulz, Poucet (chanson, fr) | 3:19 | 60 s | 25.1 | 5.7 | 26.1 | 272 / 378 | 81 % | 80 / 250 ms | −29.7 dB |
| marcello correa e castro, Trombadinha (latin, pt) | 3:18 | 54 s | 27.5 | 5.8 | 18.2 | 191 / 374 | 90 % | 70 / 240 ms | −41.8 dB |
| Melanie Ungar, What Is Love (country, en) | 3:32 | 66 s | 26.9 | 6.5 | 29.3 | 320 / 459 | 83 % | 80 / 320 ms | −37.2 dB |

Upload itself takes 0.1 to 0.3 s on localhost. Processing is 5 to 7 times faster than real time for a
song with lyrics in English; French and Portuguese spend longer in the lyrics step because Whisper
produces more, shorter tokens. The language was detected correctly for all six.

"Leftover voice" is how much of the separated vocal is still audible in the backing track, measured
relative to the vocal itself (more negative is cleaner). Below about −30 dB nothing is heard while
playing along; around −22 dB a faint ghost of the singer appears under loud phrases; above −15 dB it
is plainly audible. All six are clean; Poucet (dense choir-like backing vocals) is the closest to
noticeable. The measure is validated below.

What was heard and seen while playing: the timing guide and Hear it played lined up with the words on
all six. The only alignment problem found was in French: Whisper splits words around apostrophes and
hyphens ("Est -ce qu 'on respire"), which made some words fall on the wrong note and pushed the
word-with-note share down. Fixed (see below); the Poucet row above is after the fix.

### Faster separation: MPS versus CPU, htdemucs versus htdemucs_ft

Measured with `service/scripts/bench_separation.py` on Lovers & Liars (3:08), one job at a time:

| Model | Device | Time | Speed | Leftover voice in backing | Non-voice in the vocal stem |
|---|---|---|---|---|---|
| htdemucs | MPS (GPU) | 16.7 s | 11.3× real time | −55.4 dB | −35.4 dB |
| htdemucs | CPU | 47.5 s | 4.0× real time | −55.4 dB | |
| htdemucs_ft | MPS (GPU) | 69.8 s | 2.7× real time | −55.0 dB | −38.4 dB |

The app was already using MPS with a CPU fallback (`_pick_device` in `pipeline/stems.py`), so there was
no before/after to gain here; the table records the gain over CPU for the report: a 3 to 4 minute song
separates in 15 to 27 s instead of 45 to 75 s. The fine-tuned model is four times slower for a backing
track that is not measurably cleaner (its vocal stem has 3 dB less bleed from instruments, which the
note detector does not need). Decision: htdemucs stays the default; `NOTEALONG_DEMUCS_MODEL=htdemucs_ft`
selects the fine-tuned model for anyone who wants it. The model cache now holds both so switching does
not reload.

### Odd files, long files, short files

Each case was run through the real upload endpoint while the service was otherwise idle:

| File | What happened |
|---|---|
| 3 s clip | Refused before processing: "That recording is shorter than 5 seconds…" |
| 12 s WAV | Ready in 14 s (2 notes, no words; the player opens and plays) |
| Random bytes named .mp3 | Refused: "The audio in that file could not be read. It may be damaged or still downloading…" |
| .m4p (iTunes copy protection) | Refused: explains the file is copy-protected and cannot be opened by any app but the store's |
| MP4 with no sound | Refused: "That video has no sound in it." |
| 32 kHz MP3 with embedded cover | Ready in 46 s; the cover was extracted to `cover.jpg` |
| FLAC, Opus, AIFF, M4A | Ready in 36 to 38 s each |
| MP4, MOV, WEBM video | Ready; the soundtrack is extracted to `original.m4a` and the video deleted |
| 20 s of silence, then the song | Ready; first note at 30.8 s, lyrics shifted correctly |
| Long instrumental lead-in (6:18 total, singing from 3:19) | Ready in 66 s; first note at 3:19, no phantom words in the intro |
| 13 minute file (two songs back to back) | Ready in 191 s (stems 102, notes 20, lyrics 66); 820 words, 1451 notes, never stuck |
| 15 minute limit | Files longer than 15 minutes are refused with a message saying so |

### What was fixed

* **Processing runs in a child process.** Each step (separate, notes, lyrics, line up) now runs in its
  own process with a progress pipe. The service watches it: if a step sends no progress for longer than
  its expected time allows (at least 5 minutes, scaled by song length) it is killed and the job fails
  with a plain message instead of hanging forever. A **Stop** button on the processing screen kills the
  current step; Retry picks up from the last finished step. A "this is taking longer than expected"
  note appears when a job runs past two and a half times its first estimate.
* **Plain-language failures.** Stopped, timed out, out of GPU memory, copy-protected, damaged or
  partially downloaded, no sound in the video, too short, too long, unsupported type: each has its own
  sentence and the retry button where retrying can help.
* **Video and more audio types** are accepted (MP4, MOV, WEBM, MKV, M4V, FLAC, Opus, Ogg, AIFF, WMA,
  AAC) and probed with ffprobe before anything is stored. Embedded cover pictures are kept as the
  song's cover; `-vn` on every ffmpeg decode so a cover picture can no longer break a conversion.
* **French and other apostrophe or hyphen languages**: word fragments Whisper splits off ("qu", "'on",
  "-ce") are glued back onto their word before lining up with notes.
* **Leftover voice measured on every upload** and stored as `quality.leftover_vocal_db` on the song,
  so the player can say when a backing track still carries the singer (Part 3). The measure is
  cheap (a spectral correlation of the vocal and backing stems over the 200 Hz to 4 kHz band, during
  sung frames, about a second per song). It was checked against a full second Demucs pass on the six
  songs above (second pass −56 to −33 dB where the cheap measure says −51 to −30 dB; same ordering for
  the two leakiest) and against synthetic leaks: a backing with 10 % of the voice mixed in reads −22 to
  −26 dB, with 32 % reads −12 dB, and a clean one reads below −48 dB. "Noticeable" is set at −28 dB.
* **One heavy job at a time**: `service/scripts/heavy.sh <command>` runs a heavy job only when at least
  5 GB is free and no other heavy NoteAlong job is running, with thread counts capped.

### Not changed, and why

* Demucs on MPS was already in place; nothing to switch.
* Whisper stays on CPU (int8): on this machine the small model transcribes a 3 minute song in 7 to 30 s,
  and faster-whisper has no MPS path.

## Part 2: key change

### Key changes were broken

The first thing the verification found: every key change failed with a server error. The pitch shift
used ffmpeg's `rubberband` filter, and the current Homebrew ffmpeg is built without it. The Rubber Band
command line tool is installed (setup.sh installs it), so pitch shifting now runs through that tool,
with ffmpeg only decoding and encoding. Where the tool is missing the service falls back to ffmpeg's
own filter if the build has it, and otherwise to a resample-and-stretch chain that works on every ffmpeg
(lower quality on big shifts). `GET /api/health` reports which engine is in use (`pitch_shift`).

### Does the audio move by the right amount, and only the pitch?

`service/scripts/check_pitch_shift.py <song_id>` fetches each key from the running service (so the
real render-and-cache path is timed) and compares it with the original: the pitch move is read off
the harmonic part's constant-Q spectrum (3 bins per semitone) and, for the guide vocal, off pYIN
f0 as well; the tempo check compares length, onset alignment and the tempo estimate.

| Song | Key | Backing moved | Guide vocal moved (CQT / f0) | Length | Onsets | Tempo |
|---|---|---|---|---|---|---|
| The Fool (upload, 3:10) | −3 | −3.00 | −3.00 / −3.00 | +0 ms | 0 ms | 129.2 → 129.2 |
| | +2 | +2.00 | +2.00 / +2.00 | +0 ms | 0 ms | 129.2 → 129.2 |
| | +5 | +5.00 | +5.00 / +5.00 | +0 ms | 0 ms | 129.2 → 129.2 |
| Amazing Grace (catalog) | −3 | −3.00 | −3.00 / −3.00 | +0 ms | 0 ms | 80.7 → 80.7 |
| | +2 | +2.00 | +2.00 / +2.00 | +0 ms | 0 ms | 80.7 → 80.7 |
| | +5 | +5.00 | +5.00 / +5.00 | +0 ms | 0 ms | 80.7 → 80.7 |

Rubber Band keeps the length to the sample, so notes, lyrics and the timing guide need no adjustment.
In the player the note heights, the guide vocal and Hear it played are all derived from the key the
engine has actually loaded (not the key the user has asked for), so they always change in the same
instant as the backing. The guide vocal is shifted with formant preservation so a raised voice does
not turn into a chipmunk.

Automated: `service/tests/test_pitch_shift.py` renders a tone with clicks on every beat at −3, +2 and
+5 with the fast engine, the fine engine and the plain-ffmpeg fallback, and asserts the pitch moved by
the asked amount within a tenth of a semitone, the length is unchanged and every click is still within
30 ms of where it was.

### Quick switching

Rubber Band has two engines: R2 renders a 3 minute stem in about 2 s, R3 (better on dense mixes) in
about 9.5 s. The service uses both:

* A key asked for by the listener is rendered with R2, so the wait is short; the file is cached in
  the song folder (uploads) or `library/.cache/<id>/` (catalog songs) and re-rendered only when the
  stem it came from changes (a re-processed upload or a re-rendered catalog song).
* A single background worker then upgrades that key and its two neighbours to R3, one render at a
  time so the machine is never flooded; a `.fine` marker records which files are the good ones.
  Later plays of that key get the R3 file. The listener's own request never waits behind a background
  render (separate locks), and the newest request goes to the front of the queue.
* When a song opens, and after every key change, the player asks the service (`POST /prepare`) to
  render the keys one step up and one step down, fast renders first.

Timed in Chromium with `web/scripts/check-key-change.mjs` on the 3:10 upload, after the listener
had played for 20 s (so the neighbours were ready): one step up or down 0.4 to 0.7 s from the key
press to playing in the new key (350 ms of that is the debounce that lets several quick presses count
as one). A jump of two or more semitones to a key not rendered yet: 5 to 6 s, with "Preparing the new
key…" shown meanwhile and playback continuing from the same position. On the catalog song (1 minute)
an unrendered key takes about 1.5 s.

## Part 3: effortless uploads

What changed, all tried in Chromium against the running app:

* **The hero is the drop zone.** Discover and a first-run My songs open with "Drop in a song you
  love": one big target that takes a drop, a click (file picker, several files allowed) or a paste.
  Next to it, tonight's catalog pick as "Or start with this one"; the shelves below are headed "Or
  start with one of these", which becomes "…while it processes" while something is being added.
  The old whole-window drop overlay stays, so a file can be dropped anywhere on any page.
* **Paste.** A file pasted anywhere outside a text field (Finder, a file manager, a copied attachment)
  is added like a dropped one.
* **A queue that follows you.** Several files are uploaded one after another and then followed while
  the service processes them, in a small panel at the bottom right of every page (except the song's
  own page, where the progress screen already is). Each row shows the step and the time left, then
  "Ready to play" with a Play button, "Already in My songs", or the plain-language reason it could not
  be added. Browsing and playing carry on meanwhile. Checked with three files at once from Discover,
  then moving to My songs: the panel kept updating and both new songs were ready after 70 s.
* **Video.** MP4, MOV, WEBM and MKV (and a few others) are accepted; the soundtrack is extracted with
  ffmpeg and the video is not kept. Checked with an MP4 made from a CC recording.
* **Title, artist and cover.** Read from the file's tags when present (checked: an MP3 whose tags say
  "Tonight" by Josh Bonanno opens with that title and artist). The embedded picture becomes the
  cover; a song without one gets a generated cover in the same style as the catalog's. Settings has
  "Edit the details": title, artist, and a replace-the-cover button (JPEG or PNG, up to 10 MB) with a
  way back to the original. Covers of uploads are served privately from the user's own library and
  shown on My songs.
* **Duplicates.** Every upload is fingerprinted (Chromaprint through `fpcalc`, installed by setup.sh;
  without it a built-in chroma print is used) and compared with the songs already in the library at
  a few alignments. The same recording again, as another MP3 bitrate, M4A, FLAC or the soundtrack
  of a video, scores 0.96 to 1.00 while different songs score at most 0.59, so the threshold sits well
  between them. A duplicate is not processed again: the existing song opens, and the queue says
  "Already in My songs". `tests/test_fingerprint.py` covers both methods. (Songs added before this
  run get a fingerprint when the service starts.)
* **Unsupported and protected files** get a specific sentence (Part 1); the queue shows it.
* **Paste the correct words** already existed in Settings and re-aligns them with the singing; it
  was tried and left as it was.
* **Leftover voice.** When a backing track measures above −28 dB (Part 1's measure), the player says
  once, when playback starts, "A little of the singer is still in this backing track. That is the
  recording, not the guide voice", and the same line sits under the backing volume slider. One of the
  test uploads (Tonight, −26 dB) triggers it; the six from Part 1 do not.

Found on the way: a title with an ampersand produced an invalid SVG cover (the catalog's "Lovers &
Liars" had a broken image). Fixed by escaping, and that cover was rebuilt.
