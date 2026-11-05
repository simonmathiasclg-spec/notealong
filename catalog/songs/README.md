# Hand-authored songs (`catalog/songs/*.song`)

Each file is one public-domain song. `python -m notealong.catalog.build` (run from `service/`
with the venv active) turns it into `catalog/<id>/song.json`, a backing track, a guide melody
and cover art, and rewrites `catalog/catalog.json`. The file name is the song id.
Useful flags: `--only <id>` (repeatable), `--force`, `--jobs 8` (render several songs at once),
`--check` (parse only). `python -m notealong.catalog.audit` measures the rendered tracks
(loudness, peaks, frequency balance, silences, intro length).

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
intro: 2                       # ignored unless intro_exact is set: every song gets a 1, 2 or 4 bar intro (see below)
outro: 1                       # bars of backing after the last note (default 1)
style: waltz                   # the backing band, see the list below
guide: ooh                     # ooh | flute | clarinet  (the quiet guide melody)
year: 1893
attribution: one sentence on where the melody and the words come from, and why they are public domain
source_url: https://…          # the notated source the melody was checked against
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

## Styles (the backing band)

`style:` picks a small band suited to the song. The arranger (`service/notealong/catalog/arrange.py`)
never plays the melody; it gives the player a groove, a bass line that moves and the harmony.

| style | band |
|---|---|
| folk | steel-string guitar strumming, a second guitar finger-picking, upright bass, brushes and shaker |
| country | boom-chick guitar, banjo rolls, upright bass, a brushed "train" beat |
| ballad | piano (rolling left hand), strings, upright bass, soft brushes |
| waltz | oom-pah-pah piano, strings, upright bass, brushes |
| march | brass off-beats, horns, tuba, snare drum with rolls, bass drum and cymbal |
| swing | walking bass, brushes, jazz piano comping, horn stabs where the melody rests |
| latin | nylon guitar (rumba strum), a second guitar, bass, maracas, claves and congas |
| lullaby | soft piano arpeggios, a warm pad, music box, bass |
| hymn | church organ, strings, bass pedal |
| gospel | piano, tonewheel organ, electric bass with walk-ups, drums with tambourine |
| carol | strings, harp, soft choir, tubular bells, double bass, sleigh bells or triangle |
| celtic | harp, finger-picked guitar, a string drone, bass, frame drum |
| shanty | concertina, strummed guitar, bass, stomps and claps |
| klezmer | accordion off-beats, mandolin, bass, tambourine |
| polka | accordion, boom-chick guitar, tuba, polka drums |
| italian | guitar, mandolin tremolo, accordion, bass, tambourine |
| asian | koto, harp, strings in open fifths, bass, woodblock |
| african | marimba ostinato, kalimba, bass, hand drums with a bell |
| indian | tanpura drone, harmonium, bass, tabla-like hand drums |
| arabic | oud-like plucked strings, strings in open fifths, bass, darbuka rhythm (maqsum) |
| andean | charango-like small guitar, nylon guitar, bass, bombo drum |
| children | ukulele, glockenspiel, pizzicato strings, bass, woodblock and triangle |
| orchestral | strings, pizzicato, horns, double basses, timpani |

Older names still work: `pad` (ballad), `lively` (folk), `accordion` (polka).

## Intro and ending

Every song gets an instrumental intro so the groove and tempo are heard before the first note: two
bars, or one when a bar is longer than about 3 seconds, or four when bars are very short. The last
intro bar ends with a drum fill (or an arpeggio in bands without drums). To force a length write
`intro_exact: yes` together with `intro: N`. `intro_chords: | C | G7 |` sets the intro harmony (it must be
exactly as many bars as the intro); otherwise the first chord of the song is used. The song ends on
the home chord, held, with a final hit.

The build checks that every lyric line has exactly one note per syllable, that the melody is a whole
number of bars, and warns about notes outside the key (ornaments and modal tunes may legitimately
have them). Rule for including a song: both the melody and the words must be public domain
everywhere we sell the app. When in doubt, leave it out.
