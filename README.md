# NoteAlong (Phase 1 prototype)

Turn any song into a play-along screen for melody instruments. Upload an MP3, WAV or M4A; NoteAlong
separates the vocals, finds the notes of the vocal melody, reads the lyrics with word timing, and shows
plain note names (C, D♯, G…) above each word while the backing track plays. No sheet music needed.

```
notealong/
├── service/     Python processing service (FastAPI): Demucs → Basic Pitch → cleanup → Whisper → alignment
│   └── notealong/catalog/   tools that build and import the built-in songs
├── web/         Next.js app (Discover, My songs, processing view, player, edit mode, print/export)
├── catalog/     Built-in songs that ship with the app (public domain + Creative Commons), see below
│   └── songs/   hand-authored melodies in a small text format (*.song)
├── library/     Your own songs: library/<song-id>/{original.mp3, vocals.mp3, backing.mp3, song.json, …}
├── docs/        Screenshots (before/after), design principles and the three design directions
└── REPORT.md    Results on three real songs, what works, where transcription is weakest, thresholds to tune first
```

## Setup on a Mac

Requirements: macOS 13+, Homebrew, Python 3.11, Node 20+.

**Quick way:** `./setup.sh` once (installs everything below and downloads the models), then `./start.sh`
whenever you want to use the app. It starts both servers and prints the link (http://localhost:3000);
Ctrl-C stops them. Logs go to `logs/`.

**By hand:**

```bash
# 1. System tools (ffmpeg is built with Rubber Band, which handles key changes)
brew install ffmpeg python@3.11 node

# 2. Processing service
cd service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt          # first time: ~5 minutes, downloads PyTorch etc.
./run.sh                                 # http://localhost:8000

# 3. Web app (in a second terminal)
cd web
npm install
npm run dev                              # http://localhost:3000
```

The first song you process downloads the ML models (Demucs `htdemucs` ≈ 80 MB from Meta,
Whisper `small` ≈ 460 MB from Hugging Face). They are cached afterwards.

On Apple Silicon the whole pipeline runs on the CPU/MPS; a 4-minute song takes roughly
3–6 minutes (Demucs is most of it). The progress screen shows a live estimate.

### Optional settings (environment variables for the service)

| Variable | Default | Meaning |
|---|---|---|
| `NOTEALONG_LIBRARY` | `../library` | Where songs are stored |
| `NOTEALONG_WHISPER_BACKEND` | `faster-whisper` | `faster-whisper` or `openai-whisper` |
| `NOTEALONG_WHISPER_MODEL` | `small` | `base` is faster, `medium` is more accurate (slower, 1.5 GB) |
| `NOTEALONG_WHISPER_MODEL_PATH` | – | Local `.pt` checkpoint for the `openai-whisper` backend |
| `NOTEALONG_DEMUCS_SHIFTS` | `0` | Extra averaging passes for Demucs (1 = better stems, 2× slower) |
| `NOTEALONG_MODELS` | `service/models` | Folder with local model weights (optional, for offline use) |

The web app reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## Using it

1. Pick your instrument (alto sax is preselected). You can change it any time from the player.
2. **Discover** lists the built-in songs: tap one and it plays straight away. Browse by difficulty, genre or
   culture, or search. **My songs** holds what you add yourself.
3. Add a song (button or drag a file anywhere). Processing continues even if you leave the page, so you can
   play something from Discover while you wait.
4. Open the song: press play (or space). After a short count-in the backing track plays and the current
   word and note light up. Notes above words are what you finger on your instrument.
5. Side panel (⚙︎): key (higher/lower), octave, speed, loop, backing volume, quiet guide vocal, note
   names (C♯ / D♭ / Do Re Mi / Sa Re Ga), detail level, lyric language and script, paste the correct lyrics,
   export (PDF sheet, MusicXML).
6. Edit mode (✎ or `E`): click a note to move it up or down a semitone or delete it; click a word to fix
   its text or add a note. Undo/redo. Edits are saved to `song.json`.
7. Focus mode (`F`) hides everything except play/pause. `?` shows all shortcuts.

Octave markers: ▲ after a note means the higher version of that note on your instrument, ▼ the lower
one. A dashed red note is outside your instrument's range; use the octave control or a different key.

## The built-in catalog (Discover)

`catalog/catalog.json` is the index; every song lives in `catalog/<id>/` with `song.json` (the same format
the pipeline produces), `backing.mp3`, `vocals.mp3` (the guide melody or the separated singer), `cover.svg`
(generated abstract art) and `catalog.json` (title, artist, origin, genre, difficulty, duration, key, tempo,
licence, attribution, tags). Only songs that are legal to ship are included: public-domain melodies and
words, or recordings under CC0, CC BY or CC BY-SA (never NonCommercial or NoDerivatives).

Two kinds of song:

- **Hand-authored public-domain classics** in `catalog/songs/*.song`, a small text format: header, chords
  per bar, then lyric lines with one note per syllable (see `catalog/songs/README.md`). The build turns each
  file into exact note data, renders a backing track (chords, bass, light percussion) and a guide melody with
  FluidSynth and the MIT-licensed MuseScore General soundfont, generates cover art and rates the difficulty
  from the note range, number of different notes, speed and jumps.
- **Creative Commons recordings** imported with `import_cc`: the recording goes through the normal pipeline
  (Demucs, Basic Pitch, cleanup), then every note is checked against a second pitch tracker (pYIN) and clear
  mistakes are fixed or dropped, exactly as a careful edit-mode pass would do. Hand-made word timings can be
  supplied instead of Whisper. Artist, source and licence are stored and shown on the song page.

Built-in songs are read-only: your settings and any note fixes for them are kept in `library/.catalog/`, and
key-shifted renders in `library/.cache/`. "Delete" on a built-in song only resets those.

### Adding a song to the catalog

```bash
cd service && source .venv/bin/activate
brew install fluid-synth                      # once; the soundfont (~40 MB) downloads on first build

# A public-domain song: write catalog/songs/<id>.song, then
python -m notealong.catalog.build --check      # parse every file, report problems
python -m notealong.catalog.build              # build what changed (audio, song.json, cover, index)

# A Creative Commons recording (CC0 / CC BY / CC BY-SA only)
python -m notealong.catalog.import_cc --audio ~/Downloads/song.mp3 --id artist-song \
    --title "Song" --artist "Artist" --source-url https://www.jamendo.com/track/123 \
    --licence "CC BY 4.0" --licence-url https://creativecommons.org/licenses/by/4.0/ \
    --genre Pop --language en [--lyrics lyrics.txt --words words.csv]
python -m notealong.catalog.build --rerate     # optional: recompute difficulty ratings and the index
```

The web app reads the index from `GET /api/catalog`; a catalog song opens through the same
`/api/songs/{id}` endpoints as an upload, so every player feature works on it.

### Plans and limits (not built yet, designed for)

`service/notealong/entitlements.py` is the one place that knows what the current user may do. There are no
accounts, so everyone is on the "local" plan with no limits; `GET /api/me` reports the plan and upload
counts, and the upload endpoint asks `check_upload_allowed()` first. The planned paywall (3 free uploads,
unlimited for subscribers, catalog always free) only needs that module to read a signed-in user's plan.
Set `NOTEALONG_FREE_UPLOADS=3` to try the limit today.

## How it works

**Pipeline** (`service/notealong/pipeline/`), each step re-runnable on its own via
`POST /api/songs/{id}/steps/{stems|melody|cleanup|lyrics|attach|all|retry}`:

1. `stems.py` – Demucs `htdemucs` splits the song; `vocals` is kept and the other stems are summed into `backing`.
2. `melody.py` – Spotify Basic Pitch on the vocals stem with permissive thresholds → `notes_raw.json`
   (concert-pitch MIDI, start/end, confidence) plus a per-note *level* (how loud the vocals stem is during
   the note relative to its loud parts). Also estimates the tempo for the count-in.
3. `cleanup.py` – the important part. Drops out-of-range, low-confidence and near-silent (instrument
   bleed) notes; reduces overlapping notes to one lead line with a frame-by-frame tracker (continuity
   bonus, leap penalty, bias against octave harmonics); joins fragments of the same pitch; absorbs short
   slides and ornaments into their neighbour; drops isolated blips. Three presets (simple / balanced /
   detailed) live in `config.py`. `keydetect.py` then runs a Krumhansl key profile on the result.
4. `lyrics.py` – Whisper (faster-whisper by default) on the vocals stem with word timestamps; language
   auto-detected or overridden. Words over near-silent audio are dropped (hallucinations).
   `romanize.py` adds a romanized form for non-Latin scripts (Indic scripts, Korean, Japanese, Chinese,
   Unidecode fallback for the rest). `lines.py` groups words into karaoke lines.
5. `align.py` – pasted lyrics are aligned to the transcribed words (fuzzy sequence alignment) and take
   their timings; unmatched words are interpolated between anchors. Line breaks in the paste become lines.
6. `attach.py` – each note is attached to the word sung at that moment (largest overlap, with a small
   tolerance); notes outside any word form "no lyrics" blocks. Same-pitch re-onsets inside one word are joined.
7. `song.json` – everything the player needs (see `schemas.py`). The layout is flat so it can move to
   Supabase tables (songs, words, notes, sessions) later.

**Frontend** (`web/src/`): all transposition happens in `lib/notes.ts`:
`written = concert + keyShift + instrument.transpose + 12 × octaveShift`. Instruments are in one table,
`lib/instruments.ts`. Range fitting picks the whole-octave shift that keeps the most notes inside the
instrument's written range. Playback (`lib/audio.ts`) uses two `<audio>` elements (backing + guide vocal)
with `preservesPitch` for speed changes; key changes swap in pitch-shifted renders made by the service
with Rubber Band (`GET /api/songs/{id}/audio/backing?shift=-2`), cached per song, neighbours pre-rendered.

## Tests

```bash
cd service && source .venv/bin/activate && pytest           # cleanup, key detection, alignment, romanization, API,
                                                              # and an end-to-end synthesized melody through Basic Pitch
cd web && npm test                                            # transposition, range fitting, note naming, lines, MusicXML
```

## Phase 2 notes (designed for, not built)

- **MP4 karaoke export**: `components/player/LyricStage.tsx` renders purely from `(lines, time, settings)`,
  so it can be driven frame by frame by Remotion or captured headlessly.
- **Accounts / cloud**: `song.json` maps onto tables one-to-one; `library.py` is the only module that touches
  the filesystem. The service has no state outside the library folder, so it can run on Modal/Replicate as is.
- **Fingering diagrams** for saxophone can hang off the written MIDI number in `NoteChip`.
