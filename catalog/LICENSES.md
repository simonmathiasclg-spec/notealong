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


## Soundfonts for the backing tracks of hand-authored songs

The backing tracks in `catalog/<song>/backing.mp3` are rendered by `service/notealong/catalog/` with
FluidSynth from two soundfonts. The soundfonts themselves are not shipped: they are downloaded to
`service/models/` on the first build. Only the rendered music is distributed.

| Soundfont | Used for | Licence / terms | Checked |
|---|---|---|---|
| GeneralUser GS 2.0.3, S. Christian Collins. <https://github.com/mrbumpy409/GeneralUser-GS> | guitars, banjo, mandolin, ukulele, basses, accordion, tonewheel and reed organ, harp, brass, choir, bells, mallets, koto, sitar, kalimba, all drum kits | "GeneralUser GS License v2.0": may be used "without restriction for your own music creation, private or commercial" | 4 Nov 2026, `documentation/LICENSE.txt` in the repository |
| MuseScore General (derived from FluidR3Mono and others), MuseScore BVBA and contributors. <https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/> | grand piano, strings, pizzicato, church organ, cello and double bass, timpani, the guide melody | MIT licence | 2 Nov 2026 |

Note on GeneralUser GS: its author states that some samples were collected from freely available
soundfonts and that he cannot be completely certain of the origin of every one, although none came
from commercial sample products and no complaint has been made since 2000. The licence explicitly
allows commercial music made with it, which is how it is used here. If that residual uncertainty is
not acceptable, set every `Sound("gu", …)` in `arrange.py` to an `"ms"` preset and rebuild: MuseScore
General covers all General MIDI programs under the MIT licence.

Reverb, EQ, compression and loudness normalisation are done in our own code (`render.py`) and with
FFmpeg; no third-party impulse responses or plug-ins are used.

### Considered and rejected for the backing tracks

| Source | Why not |
|---|---|
| SGM-V2.01, Timbres of Heaven, Arachno SoundFont | Not evaluated in this run. They are popular, but I did not have a licence text for them that clearly permits commercial use, so they were left out rather than assumed. |
| Sonatina Symphonic Orchestra | Creative Commons Sampling Plus 1.0 (advertising restriction). |
| Commercial sample libraries of any kind | Not free to redistribute renders from without a paid licence. |
