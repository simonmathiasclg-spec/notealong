# Hand-authored songs (`catalog/songs/*.song`)

Each file is one public-domain song. `python -m notealong.catalog.build` (run from `service/`
with the venv active) turns it into `catalog/<id>/song.json`, a backing track, a guide melody
and cover art, and rewrites `catalog/catalog.json`. The file name is the song id.

```
title: Happy Birthday to You
artist: Traditional            # or the composer
origin: United States          # country / region
culture: American              # shown in "browse by culture"
genre: Celebration             # Children's, Celebration, Christmas, Hymn, Spiritual, Folk, Classical, Latin, Lullaby …
language: en                   # ISO code of the lyrics
key: F major                   # tonic + major/minor, e.g. "Bb major", "F# minor"
tempo: 112                     # beats per minute
meter: 3/4
pickup: 1                      # beats of anacrusis before bar 1 (0 if the melody starts on the downbeat)
intro: 1                       # bars of backing before the melody (default 1)
outro: 1                       # bars of backing after the last note (default 1)
style: waltz                   # folk | ballad | waltz | march | swing | latin | lullaby | hymn | pad | lively | accordion
guide: ooh                     # ooh | flute | clarinet  (the quiet guide melody)
year: 1893
attribution: one sentence on where the melody and the words come from, and why they are public domain
featured: yes                  # optional
beginner: yes                  # optional (Easy songs are "great for beginners" anyway)
tags: celebration, birthday    # optional, comma separated
difficulty: medium             # optional override of the automatic rating

chords:
| F | C7 | C7 | F |            # one bar between each pair of bars; several chords in a bar split it evenly
| F / / C7 | F |               # "/" repeats the previous chord for one slot (beat-level changes)
| % |                          # "%" repeats the previous bar; "NC" = no chord; slash chords like C/E work

melody:
Hap-py birth-day to you        # lyric line: syllables separated by "-", words by spaces
C4. C4/ D4 C4 F4 E4(2)         # one note per syllable, in order
```

Notes: `C4` is middle C (MIDI 60), concert pitch. Durations in beats: `C4` = 1, `C4(2)` = 2,
`C4.` = 1½, `C4/` = ½, `C4//` = ¼, `C4/.` = ¾, `C4(0.5)`. Rests: `r`, `r(2)`, `r/`. A note that
continues the previous syllable (a slur or melisma) is written with `~`: `G4 ~A4`. Blank lines and
`# comments` are ignored. Chords start at bar 1 (after the pickup); if there are fewer chord bars than
melody bars the chord list repeats, so a verse–verse song needs the chords written once.

The build checks that every lyric line has exactly one note per syllable, that the melody is a whole
number of bars, and warns about notes outside the key (ornaments and modal tunes may legitimately
have them). Rule for including a song: both the melody and the words must be public domain
everywhere we sell the app. When in doubt, leave it out.
