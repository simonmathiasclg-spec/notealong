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
