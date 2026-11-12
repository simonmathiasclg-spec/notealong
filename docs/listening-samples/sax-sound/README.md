# Alto sax sound: four versions of the same two tunes

The melody alone, no backing track, so the instrument is easy to judge. Each tune is the same 27 seconds
played four ways. All files are set to the same loudness.

| File | What it is |
|---|---|
| `la-cucaracha-1-old-sound.mp3`, `despacito-1-old-sound.mp3` | What the app played before: 9 recorded notes (University of Iowa), one loudness, every note started the same way. |
| `…-2-new-recordings-plain.mp3` | The new recordings with nothing added: every semitone recorded soft and loud, two takes of each (Weresax, CC0), each note keeping more than a second of the player's own sound. |
| `…-3-new-recordings-phrased-SHIPPED.mp3` | **What the app plays now.** The new recordings plus phrasing: notes that run together are lightly tongued or slurred, phrases start with a clear attack and sometimes a small scoop up to the note, long notes grow a vibrato, there is a little breath on attacks, a little room, and loudness follows the singer (Despacito) or the shape of the tune (La Cucaracha, which has no singer). |
| `…-4-physical-model.mp3` | A computed sax (a reed-and-tube model after STK's "Saxofony"), no recordings at all. Included for comparison; it sounds like a synthesizer. |

La Cucaracha is seconds 3 to 30 of the built-in song. Despacito is the chorus (1:24 to 1:52) of the
uploaded test song; only the app's own rendering of the tune is here, none of the record.

## How they measured

`service/scripts/compare_sax_sound.py` compares each file with a real alto player (a sax cover of
Despacito in `test-recordings/`, kept out of the repository) and with real single alto notes (MTG Solo
Saxophones). Lower is closer to the real thing.

| | La Cucaracha | Despacito |
|---|---|---|
| 1 old sound | 0.72 | 0.88 |
| 2 new recordings, plain | 0.46 | 0.69 |
| 3 new recordings, phrased (shipped) | **0.33** | **0.66** |
| 4 physical model | 1.13 | 1.43 |

What moved the numbers: the old sound wobbled in pitch inside each note (4 to 5 cents against a real
player's 1.3; the new one measures 1.3), and played everything at one loudness (1.5 dB between soft and
loud notes in La Cucaracha against a real player's 8; the shipped version has 6.9). The physical model
takes 125 ms to speak (a real note takes about 40) and its tone is furthest from a real sax.

The scores are a guide, not a verdict. The real player comes from a separated recording with some of the
band left in, so vibrato could not be measured reliably and is left out of the score. Please trust your
ears over the table.

## Switching in the app

The shipped version is the default. To hear the others in the player, open the browser console on a song
page, run one of these and reload:

```js
localStorage.setItem("na.saxSound", "classic")     // the old sound (file 1)
localStorage.setItem("na.hearExpression", "0")     // new recordings without phrasing (file 2)
localStorage.removeItem("na.saxSound"); localStorage.removeItem("na.hearExpression")   // back to the default
```

To make these files again: `web/scripts/render-hear-demo.mjs` (files 1 to 3; it runs the app's own sound
code) and `service/scripts/render_physical_sax.py` (file 4).
