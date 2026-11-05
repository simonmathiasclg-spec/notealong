# Sound sources and their licences

Everything NoteAlong ships or renders with, and the terms it is used under. Only sources that allow use
in a paid product are used. The songs themselves (public domain melodies and Creative Commons
recordings) carry their own attribution in `catalog/<song>/catalog.json`.

## Instrument recordings for "Hear it played"

The files in `web/public/instruments/` are cut from single-note recordings by
`service/scripts/build_instruments.py` (trimmed, tuned, looped, levelled, re-encoded as FLAC).
`service/scripts/fetch_instrument_sources.py` downloads the originals.

| Instrument in the app | Source | Licence / terms | Checked |
|---|---|---|---|
| Alto sax, soprano sax, clarinet, flute, oboe, trumpet, French horn | University of Iowa Electronic Music Studios, Musical Instrument Samples, recorded by Lawrence Fritts. <https://theremin.music.uiowa.edu/MIS.html> | No formal licence. The page states the recordings "may be downloaded and used for any projects, without restrictions". | 4 Nov 2026, read on the source page |
| Tenor sax, recorder (baroque soprano), piano (Steinway B) | Versilian Community Sample Library (VCSL), Versilian Studios. <https://github.com/sgossner/VCSL> | CC0 1.0 Universal (public domain dedication), `LICENSE` in the repository | 4 Nov 2026 |
| Violin (solo, with vibrato) | VSCO 2 Community Edition, Versilian Studios. <https://github.com/sgossner/VSCO-2-CE> | CC0 1.0 Universal, `LICENSE` in the repository | 4 Nov 2026 |
| Baritone sax | The tenor sax recordings above, played a fifth lower | as tenor sax | |
| Voice | The piano recordings above | as piano | |

Attribution is not required by any of these, but credit is given here and in the README.

### Considered and rejected

| Source | Why not |
|---|---|
| Philharmonia Orchestra sound samples | Free for commercial music, but the terms say the samples must not be made available "as samples or as a sampler instrument". A play-along instrument is exactly that. |
| tonejs-instruments (nbrosowsky) | Samples offered as CC BY 3.0 but gathered from "a variety of public domain sources"; the origin of each instrument could not be confirmed, and some appear to come from the Philharmonia set. |
| Sonatina Symphonic Orchestra | Creative Commons Sampling Plus 1.0, which restricts advertising use. Not clearly compatible with a paid app. |
| General MIDI soundfont renderings (for example midi-js-soundfonts) | Licence is fine for some (FluidR3 is MIT), but the brief asks for better than General MIDI instrument sounds. |

