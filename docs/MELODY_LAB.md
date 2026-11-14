# Melody Lab: finding the note rules by testing them on many songs

Rounds 1 and 2 (docs/MELODY_RETHINK.md) were tuned on one or two songs, and each fix broke something
else. This round built a lab instead: answer keys for 49 songs, an automatic scorer, a tuning set and a
held-out set, and a search that only keeps what improves the songs it was never tuned on.

## The result in one paragraph

On the 15 held-out songs the overall score went from **73.3 to 78.6**. Notes correct rose from 68% to
76%, missed notes fell from 21.5% to 13.9%, and 14 of the 15 songs improved (the other lost 0.4 points).
One change did almost all of it: a second pitch inside a syllable is now a note once the voice holds it
for about a tenth of a second, where it used to need up to half a second. That old rule was swallowing
real melody notes. The price is more extra notes (9.5% to 16.3%). The targets set for this round (90%
correct, 5% missed) were **not** reached, and the lab shows why they cannot be on these answer keys: a
human playing the tune on a sax or violin scores 79% correct and 16% missed against the same keys.

## Decisions taken without asking

- **Solo covers are the truth, the singer's pitch line only lines things up.** The singer's pitch is used
  to align covers and to throw out lines, never to choose a key note.
- **No Demucs on covers.** The lead line of a raw cover matches the lead line of its separated stems on
  90 to 99% of frames, so covers are tracked directly (3 s instead of 50 s each). That paid for six
  candidate covers per song instead of three.
- **Repeats of a held pitch are not judged.** Covers cannot show reliably whether a held pitch was struck
  again (four syllables on one note). Lowering the re-strike bar cut held notes in two. So the scorer
  judges every change of pitch, and leaves repeats to the one-attack-per-syllable rule.
- **The held-out songs come only from songs no earlier round looked at**, picked by a hash of the name.
- **Clips of answer keys next to the original vocal stay in `test-recordings/`.** The committed clips are
  the key (or the app's notes) played on the sax engine alone; nothing with a recording in it is committed.
- **Singing-to-notes models were not used.** None has weights cleared for commercial use (see below).
- **Pickup lengthening was added although it does not move the score.** It answers the "Let it be sounds
  like it be" complaint directly: the first note was 0.1 s long.
- **The uploads were re-processed by script, not by restarting the app**, because the running app was
  not started by this session. Restart it (`./start.sh`) to load the new rules and the flag list.

## The songs (titles only)

60 songs were collected; 49 have an answer key.

**Tuning set (34):** A Thousand Years, Ain't No Sunshine, All of Me, As It Was, Auld Lang Syne, Bailando,
Billie Jean, Blinding Lights, Despacito, Don't Stop Believin', Dynamite, Fix You, Flowers, Hallelujah,
Halo, Havana, Hello, Imagine, Just Give Me a Reason, Just the Way You Are, Killing Me Softly, Let Her Go,
Let It Be, No Woman No Cry, Perfect, Rolling in the Deep, Senorita, Shape of You, Someone Like You,
Someone You Loved, Tum Hi Ho, Viva la Vida, Vivir Mi Vida, Wonderwall.

**Held-out set (15):** Besame Mucho, Careless Whisper, Creep, Dance Monkey, Fly Me to the Moon, Hey Jude,
If I Ain't Got You, La Vie en Rose, Memories, Scarborough Fair, Shallow, Stay With Me, Thinking Out Loud,
Yesterday, Zombie.

**Dropped, no trustworthy key (11):** Can't Help Falling in Love, My Heart Will Go On, I Will Always Love
You, Say Something, Amazing Grace, Danny Boy (too few lines where the covers agree); Stand By Me, What a
Wonderful World, Sweet Child O' Mine, House of the Rising Sun (the covers do not agree at all); Easy On Me
(no usable solo cover found). The long-held-note ballads are over-represented among the drops, so that
style is thin in the test set.

Styles covered: ballads, fast pop, duets, R&B with runs, rock, Latin (Spanish), Hindi, French, jazz,
reggae, two traditional songs. All recordings, covers, lyrics and keys are in the gitignored
`test-recordings/`; `service/scripts/check_no_test_material.py` fails the web build, the Python tests
and `deploy.sh` if any of it could be committed or shipped.

## How the answer keys were built

Scripts in `service/scripts/lab/`: `collect.py`, `prepare.py`, `lead.py`, `keys.py`.

1. **Original**: the owner's upload where there is one, otherwise fetched; run through the normal upload
   pipeline into a separate test library.
2. **Covers**: up to six solo-instrument covers per song (sax, violin, flute, trumpet, clarinet, cello).
3. **Lead line of each cover**: Basic Pitch finds the notes sounding and the top voice from G3 up is the
   lead. A one-voice tracker (CREPE) was tried first and followed the piano under the soloist; Let It Be
   had no usable cover that way.
4. **Alignment**: each lead line is aligned straight to the singer's pitch line (dynamic time warping on
   note names, tried in the three most likely keys, which also undoes a key change). A second alignment
   by harmony is kept when it fits the singer better. Then, in 8 s windows, the cover is slid up to 0.6 s
   to where it fits best; windows that never fit (intros, solos, added verses) are cut.
5. **Vote**: the four covers that agree best vote. A note two or more play at the same moment (same note
   name, starts within 150 ms) is a key note, in concert pitch, with start, duration and syllable.
6. **Line confidence**: a line is "high" or "medium" by how much of what the covers play there was agreed
   and how often the singer's pitch passes through the key notes; otherwise it is dropped. 1,359 of 1,815
   lines were kept (985 high), holding 12,014 scored notes.

How good are the keys?

- **Against human letter notes** (10 songs that have both, note-name sequence per line, repeats
  collapsed): the key has 65 to 89% of the human's notes, typically about 82%. The app's own notes are in
  the same range on those songs. So a key is roughly as close to a human transcription as the app is,
  and differences of a point or two between algorithms are noise. The lab's strength is the average over
  many songs, not any single line.
- **The ceiling**: each voting cover, scored as if it were the app, gets 80 overall, 78 to 79% correct and
  16 to 17% missed (and this flatters the covers, which helped write the key).
- **Known bias**: surviving lines lean towards lines where the pitch tracker hears the singer well.
- Spot-check clips of five keys: `docs/listening-samples/melody-lab/answer-keys/`. They were not judged
  by ear in this run.

## The scorer

`service/scripts/lab/score.py`. Only kept lines are scored.

- **Correct**: a key note with an output note of the same note name starting within 200 ms.
- **Wrong**: an output note at the right time with another note name (off-key ones counted apart).
- **Missed**: a key note with no output note starting within 200 ms.
- **Extra**: an output note with no key note within 200 ms, unless one of the voting covers plays that
  note there (then nobody can call it wrong, and it is not counted), or it repeats the pitch being held.
- **Timing**: median and 90th-percentile start error of the correct notes.
- **Sounds-like**: the output as a pitch line (each note from its start to its end, which is what "Hear
  it played" plays) against the singer's pitch line over the whole song. It is computed from the note
  list, not from rendered audio.
- A key note only two of the four covers play counts half.

```
overall = 100 * (0.40*C + 0.20*(1 - min(1, 2*M)) + 0.20*(1 - min(1, E)) + 0.10*T + 0.10*L)
C = correct / key notes   M = missed / key notes   E = extra / key notes
T = 1 - min(1, median start error / 150 ms)        L = sounds-like
```

A missed note costs twice (it is not correct, and M is doubled). Extra notes carry real weight so that
neither "too simple" nor "tat tat tat" can win.

**Rule for keeping a change**: settings are chosen on the tuning set only. A change is kept only if the
held-out score improves and no held-out song loses more than 3 points.

## Experiments

"Not run" means the candidate was rejected on the tuning set and never shown the held-out songs.

| # | Experiment | What changed | Tuning | Held-out | Correct | Missed | Extra | Onset (median) | Worst held-out songs |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Detailed | baseline: the literal transcription | 73.2 | 73.7 | 75.0 | 11.5 | 35.6 | 36.5 | la-vie-en-rose 59.9, zombie 63.1 |
| 2 | Sax-friendly round 1 | baseline: one note per syllable, as first shipped | 69.8 | 71.9 | 66.9 | 22.8 | 9.5 | 42.5 | if-i-aint-got-you 61.8, stay-with-me 64.5 |
| 3 | Sax-friendly round 2 | baseline: the default before the lab | 71.1 | 73.3 | 68.3 | 21.5 | 9.5 | 37.9 | if-i-aint-got-you 64.1, zombie 66.7 |
| 4 | Shorter held second notes | melisma_max=0.12,melisma_min=0.1,melisma_beats=0.2 | 76.1 | 77.2 | 73.7 | 15.7 | 14.1 | 36.1 | if-i-aint-got-you 72.3, shallow 73.1 |
| 5 | … and every piece of the main note kept | melisma_max=0.12,melisma_min=0.1,melisma_beats=0.2,first_beats=0 | 77.3 | 78.5 | 76.4 | 14.1 | 16.4 | 35.5 | shallow 72.9, careless-whisper 74.3 |
| 6 | Settled short notes only | old hold kept; a short second note counts only if steady (0.25 st) and in tune: rejected on the tuning set, the stability test only loses notes | 72.5 | not run |  |  |  |  | auld-lang-syne 57.2, imagine 60.3 |
| 7 | Even shorter hold | 0.08 to 0.1 s: +0.3 on tuning, at the noise threshold, with more extra notes; not adopted | 77.6 | not run |  |  |  |  | auld-lang-syne 67.2, billie-jean 68.5 |
| 8 | Pickup lengthening alone | on the round 2 settings: no change in score | 71.2 | not run |  |  |  |  | auld-lang-syne 54.6, tum-hi-ho 57.8 |
| 9 | Vote: add swallowed Detailed notes | Sax-friendly plus Detailed notes it holds through (0.12 s, in key): rejected on tuning (+0.2, within noise; more extras) | 77.5 | not run |  |  |  |  | auld-lang-syne 67.5, billie-jean 69.6 |
| 10 | Vote: drop notes under 0.08 s | rejected on tuning | 77.0 | not run |  |  |  |  | auld-lang-syne 67.6, billie-jean 68.2 |
| 11 | Vote: short notes need Detailed's support | notes under 0.2 s kept only if Detailed has them: rejected on tuning (misses rise) | 75.4 | not run |  |  |  |  | billie-jean 61.6, auld-lang-syne 63.4 |
| 12 | One-at-a-time sweep of 37 settings | 66 values tried (timing weights, attack, silence, key evidence, rests, phrase length ...): none gains 0.3 on tuning; best +0.2 | 77.3 | not run |  |  |  |  | auld-lang-syne 67.6, billie-jean 69.1 |
| 13 | Final: + pickup lengthening | melisma_max=0.12,melisma_min=0.1,melisma_beats=0.2,first_beats=0,pickup_min=0.2 (a note after a silence sounds at least 0.2 s; asked for by ear, score-neutral) | 77.3 | 78.6 | 76.4 | 13.9 | 16.3 | 36.1 | shallow 72.9, careless-whisper 74.1 |

What the search says:

- Rounds 1 and 2 both scored *below* Detailed on missed notes. That matches what the owner heard.
- The melody rule is the only setting that matters. 66 other values of 37 settings moved the tuning score
  by 0.2 at most.
- Requiring a short note to be steady and in tune (the "ornament or real note" test) only lost notes.
- Voting with Detailed did not help: its added notes are right about as often as they are extra.
- Off-key notes are not the problem they seemed: 0.3% of key notes get an out-of-key note.
- Lead vocal in duets was not improved: no candidate was built for it. Shallow is the worst held-out song.

## The winner: baseline against final on the held-out set

Baseline is Sax-friendly round 2. Numbers are percent of key notes, except Overall.

| Song | Style | Overall | Correct | Missed | Extra | Wrong | Start error (median) |
|---|---|---|---|---|---|---|---|
| Besame Mucho | Latin | 73.4 → 78.3 | 69.5 → 77.5 | 22.5 → 15.8 | 11.6 → 17.4 | 8.0 → 6.8 | 35 → 35 ms |
| Careless Whisper | R&B | 69.8 → 74.1 | 61.4 → 68.7 | 24.7 → 18.7 | 7.1 → 13.7 | 13.9 → 12.7 | 40 → 38 ms |
| Creep | rock | 75.5 → 78.3 | 69.5 → 74.0 | 18.0 → 15.0 | 11.0 → 13.0 | 12.5 → 11.0 | 34 → 34 ms |
| Dance Monkey | fast pop | 77.3 → 82.6 | 71.0 → 79.7 | 16.7 → 10.5 | 4.0 → 8.3 | 12.3 → 9.8 | 40 → 40 ms |
| Fly Me to the Moon | jazz | 83.2 → 82.8 | 80.0 → 81.3 | 6.7 → 4.0 | 16.0 → 26.7 | 13.3 → 14.7 | 30 → 30 ms |
| Hey Jude | ballad | 76.3 → 81.2 | 72.7 → 80.2 | 20.6 → 13.0 | 7.1 → 14.2 | 6.7 → 6.7 | 30 → 30 ms |
| If I Ain't Got You | R&B, runs | 64.1 → 76.5 | 57.7 → 72.3 | 32.9 → 16.3 | 6.3 → 12.0 | 9.4 → 11.4 | 50 → 40 ms |
| La Vie en Rose | ballad | 74.1 → 77.3 | 68.3 → 72.7 | 18.0 → 12.2 | 11.5 → 18.7 | 13.7 → 15.1 | 35 → 32 ms |
| Memories | fast pop | 80.6 → 83.1 | 77.2 → 80.6 | 16.7 → 13.3 | 5.0 → 6.7 | 6.1 → 6.1 | 30 → 30 ms |
| Scarborough Fair | traditional | 77.6 → 79.9 | 73.3 → 79.0 | 11.4 → 5.7 | 21.0 → 34.3 | 15.2 → 15.2 | 33 → 30 ms |
| Shallow | duet | 70.0 → 72.9 | 67.3 → 71.8 | 27.7 → 23.3 | 7.9 → 11.9 | 5.0 → 5.0 | 50 → 49 ms |
| Stay With Me | ballad | 68.7 → 77.4 | 63.7 → 77.8 | 27.4 → 15.4 | 6.8 → 17.9 | 9.0 → 6.8 | 45 → 44 ms |
| Thinking Out Loud | R&B | 68.5 → 77.4 | 64.1 → 76.7 | 27.1 → 16.2 | 10.5 → 16.6 | 8.8 → 7.0 | 42 → 37 ms |
| Yesterday | ballad | 73.6 → 77.3 | 67.7 → 74.7 | 20.1 → 14.9 | 8.2 → 16.4 | 12.3 → 10.4 | 45 → 42 ms |
| Zombie | rock | 66.7 → 79.5 | 60.8 → 78.8 | 32.0 → 14.8 | 8.0 → 16.8 | 7.2 → 6.4 | 30 → 30 ms |
| **Mean** | | **73.3 → 78.6** | **68.3 → 76.4** | **21.5 → 13.9** | **9.5 → 16.3** | **10.2 → 9.7** | **38 → 36 ms** |

90th-percentile start error 115 → 113 ms. Sounds-like 89.9 → 92.6. A human cover on the same songs:
80.9 overall, 79.1% correct, 16.4% missed.

The owner's three uploads (all tuning songs): Let It Be 78.3 → 84.7 (correct 78.8 → 89.4%, missed 16.3 →
6.7%, extra 14.8 → 26.1%); Just Give Me a Reason 72.0 → 74.3; Despacito 76.5 → 78.0. One tuning song got
worse: Hallelujah, 77.3 → 76.3.

### Against the targets

| Target on the held-out set | Result | Met? |
|---|---|---|
| at least 90% of notes correct | 76.4% | no |
| at most 5% missed notes | 13.9% | no |
| median start error under 80 ms | 36 ms | yes |
| no song below 75% correct | 6 of 15 are below (lowest: Careless Whisper 68.7%) | no |

What blocks the first two: the measuring stick. The players the keys are made from only reach 79%
correct and 16% missed against those keys, because the keys keep notes that just two of four players
play. The app is now within 3 points of a human cover on correct notes and ahead of it on missed ones.
Getting a meaningful 90% needs better keys (note-level human transcriptions, or MIDI of the vocal line),
not more tuning against these.

### What the winner changed in the app

`service/notealong/pipeline/saxmelody.py`, pipeline version 8:

- a second pitch inside a syllable is a note once held about a tenth of a second (0.2 beat, 0.10 to
  0.12 s), instead of 0.6 beat (0.18 to 0.5 s);
- every held piece of a syllable's main note is kept (the round 2 "landing note" rule is off; the shorter
  hold covers what it did);
- a note that comes in after a silence sounds for at least 0.2 s: its start moves earlier into the
  silence.

Detailed mode is unchanged. Nothing here depends on the instrument: all of it is concert pitch, and
transposition stays a display step.

## The worst remaining songs, and why

- **Extra notes went up everywhere** (held-out 9.5% → 16.3%; Scarborough Fair 34%, Fly Me to the Moon
  27%, Let It Be 26%). This is the direct cost of the shorter hold, and it is the "tat tat tat" risk from
  round 1 coming partway back. The scorer judged the trade worth it; the owner's ear has not.
- **Shallow (72.9, duet)**: 23% missed. The tracker follows one voice through the duet sections.
- **Careless Whisper (74.1)**: 13% wrong notes, the most on the held-out set; a breathy, sliding vocal.
- **Billie Jean (69.2, tuning)**: 19% wrong notes; half-spoken, percussive singing.
- **Auld Lang Syne (67.6, tuning)**: 56% extra notes on a key built from only two covers.
- **Someone Like You (70.4, tuning)**: still 25% missed.
- **Wrong notes did not move** (10.2% → 9.7%). Nothing tried in this round touches pitch choice.

## "This note sounds wrong"

In the player, press **W** to mark the note you just heard, or tap a note and choose "This note sounds
wrong". Marking again removes the mark; marked notes get a wavy underline. Marks are saved in the browser
and, when the app runs locally, in `library/.me/flags.json`.

`service/scripts/lab/flags_to_cases.py` turns the marks into `test-recordings/lab/flag-cases.json`, and
its `still_wrong()` reports, for any algorithm, how many marked notes it would still write. Songs marked
but not yet in the lab are listed so the next round can collect covers for them. There are no marks yet.

## Listening samples

`docs/listening-samples/melody-lab/`: before and after "Hear it played" clips on alto sax for six songs
(the Let It Be chorus, Just Give Me a Reason, Despacito, and three held-out songs: Zombie, Stay With Me,
Thinking Out Loud). `answer-keys/` holds five keys played the same way. None were judged by ear.

## Model licences

No new model was added, so `catalog/LICENSES.md` is unchanged. Basic Pitch (Apache-2.0, already listed)
is reused to track the covers. Singing-to-notes models checked and not used:

| Model | Code | Released weights | Verdict |
|---|---|---|---|
| SOME (openvpi) | MIT | CC BY-NC-SA 4.0 | not allowed |
| GAME (openvpi) | MIT | CC BY-NC-SA 4.0 | not allowed |
| ROSVOT | MIT | no licence stated; trained only on M4Singer (non-commercial) | treat as not allowed |
| STARS | MIT | no licence, training data undisclosed; needs lyrics as input | unclear |
| MusicYOLO, VOCANO / Omnizart, YourMT3 | Apache-2.0 / MIT / GPL-3.0 | no weights licence stated | unclear |

## What a next round should do

1. Listen to the six clip pairs and mark notes with W: extras are the open question.
2. Better keys for a subset: note-level human transcriptions would lift the ceiling and let wrong notes
   and extras be judged properly.
3. A duet candidate (follow the lead through harmony sections).
4. Covers for the dropped long-held-note ballads.
