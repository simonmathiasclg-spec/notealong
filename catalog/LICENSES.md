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
| Alto sax (every semitone, soft and loud, two takes of each) | Weresax, Karoryfer Samples (condenser microphone takes of the alto). <https://github.com/sfzinstruments/karoryfer.weresax> | CC0 1.0 Universal, `LICENSE` in the repository; the readme adds "you can do whatever you want with it" | 12 Nov 2026 |
| Alto sax "classic" (the earlier, smaller sound, kept as a switch), soprano sax, clarinet, flute, oboe, trumpet, French horn | University of Iowa Electronic Music Studios, Musical Instrument Samples, recorded by Lawrence Fritts. <https://theremin.music.uiowa.edu/MIS.html> | No formal licence. The page states the recordings "may be downloaded and used for any projects, without restrictions". | 4 Nov 2026, read on the source page |
| Tenor sax, recorder (baroque soprano), piano (Steinway B) | Versilian Community Sample Library (VCSL), Versilian Studios. <https://github.com/sgossner/VCSL> | CC0 1.0 Universal (public domain dedication), `LICENSE` in the repository | 4 Nov 2026 |
| Violin (solo, with vibrato) | VSCO 2 Community Edition, Versilian Studios. <https://github.com/sgossner/VSCO-2-CE> | CC0 1.0 Universal, `LICENSE` in the repository | 4 Nov 2026 |
| Baritone sax | The tenor sax recordings above, played a fifth lower | as tenor sax | |
| Voice | The piano recordings above | as piano | |

Attribution is not required by any of these, but credit is given here and in the README.

### Used for measuring only, not shipped

| Source | Used for | Licence / terms | Checked |
|---|---|---|---|
| MTG Solo Saxophones (Music Technology Group, Universitat Pompeu Fabra). <https://github.com/sfzinstruments/MTG.SoloSax> | Real alto notes as the yardstick for tone and attack in `service/scripts/compare_sax_sound.py`. A good source for a layered tenor, soprano and baritone later (credit would then be required). | CC BY 4.0 | 12 Nov 2026 |
| STK "Saxofony" reed model (Perry Cook, Gary Scavone), re-written in `service/scripts/render_physical_sax.py` | The physical-model entry in the sax sound comparison | MIT-style: "use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies" | 12 Nov 2026 |

### Considered and rejected

| Source | Why not |
|---|---|
| TinySOL alto sax (Ircam, Zenodo 3685367) | Licence is fine (CC BY 4.0) and it has three loudness levels, but one take per note, 16-bit, and a 1 GB download for 99 notes. Weresax gives two takes with no credit needed. |
| Good-sounds full set (Zenodo 4588740) | The record says CC BY 4.0 in one place and CC BY-NC 4.0 in another. Not safe for a paid app. |
| OrchideaSOL (Ircam) | Non-commercial use only. |
| FiloSax | Restricted access, no open licence. |
| NSynth | Licence is fine (CC BY 4.0) but 16 kHz, four-second notes: worse than what was there. |
| Magenta DDSP saxophone models (timbre-transfer checkpoint, DDSP-VST `Saxophone.tflite`), MIDI-DDSP | Code is Apache 2.0, but no licence is stated for the trained weights or the recordings they were trained on. They are tenor sax at 16 kHz (nothing above 8 kHz), and MIDI-DDSP does not install on Apple silicon. Not shippable, and not better. |
| acids-ircam `ddsp_pytorch` saxophone model | Same problem: licence of the weights and training recordings not stated. |
| RAVE (Ircam) | CC BY-NC 4.0: non-commercial. |
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

## Sampled instruments (SFZ) for the backing tracks

Since the second overnight run, the piano in every style, the drum kit of up-tempo swing and of gospel,
and the gospel electric bass are real multi-sampled instruments in SFZ format, played by sfizz (through
the `pysfizz` Python binding) instead of a General MIDI soundfont. Like the soundfonts they are fetched
to `service/models/sfz/` on first use (`python -m notealong.catalog.sfz_sources`) and never shipped; only
the rendered backing tracks are distributed.

| Library | Used for | Licence / terms | Checked |
|---|---|---|---|
| Salamander Grand Piano V3 (Yamaha C5), Alexander Holm; FLAC edition assembled by FreePats. <https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html> | the piano in ballad, waltz, swing, gospel and lullaby styles | Creative Commons Attribution 3.0 (stated in the package `readme.txt` and on the FreePats page). Commercial use allowed; attribution given here and in the README. | 7 Nov 2026 |
| Virtuosity Drums, Versilian Studios with Karoryfer Samples. <https://github.com/sfzinstruments/virtuosity_drums> | the drum kit played with sticks: up-tempo swing (150 bpm and faster) and gospel | CC0 1.0 (`LICENSE` in the repository) | 7 Nov 2026 |
| Swagbass, Karoryfer Samples (D. Smolken). <https://github.com/sfzinstruments/karoryfer.swagbass> | the electric bass in gospel | CC0 1.0 (`LICENSE` in the repository); the readme adds "royalty-free for all commercial and non-commercial use" | 7 Nov 2026 |
| sfizz / pysfizz (the SFZ player). <https://github.com/sfztools/sfizz> | rendering the libraries above | BSD 2-Clause (sfizz, and the pysfizz wheel, whose metadata says BSD-2-Clause). Used as a tool, not shipped. | 7 Nov 2026 |

Everything else in the band (guitars, upright bass, strings, brass, organ, brushes, world percussion)
still comes from the two soundfonts above.

### Sample libraries considered and not used

| Library | Decision |
|---|---|
| Spitfire LABS | Free, but under Spitfire's own end-user licence, which allows using the sounds in music you release and does not allow redistributing the samples or building playable instruments from them. Rendering whole backing tracks for a paid app is a grey zone; left out. |
| Pianobook libraries (Decent Sampler) | Uploaders agree their packs may be used in commercial compositions, but Pianobook forbids redistributing the samples and terms vary per library. Not needed once the Salamander piano was in. |
| Decent Samples free libraries | The licence of each library has to be read one by one and several are personal-use only. Not used. |
| Salamander Drumkit, AVL Drumkits | CC BY-SA 3.0: share-alike adds obligations for derivatives that are unclear for rendered backing tracks. Virtuosity Drums (CC0) was chosen instead. |
| Naked Drums (Wilkinson Audio) | CC BY 4.0 and good, but 1.3 GB per mic set; Virtuosity covers the jazz kit we needed. A candidate for rock and pop styles later. |
| Karoryfer Emilyguitar, Black and Green Guitars | CC0 but electric guitars; the folk and Latin styles need steel-string and nylon acoustic guitars, for which no CC0 or CC BY multi-sampled library was found. The soundfont guitars stay. |
| Free upright basses (Ergo EUB, Sneakybass) | No licence text could be found for them; not used. The upright bass stays on the soundfont. |
| VSCO 2 Community Edition strings | CC0 and already used for the "Hear it played" violin; the section strings were not wired in during this run (see the report's next steps). |

Reverb, EQ, compression and loudness normalisation are done in our own code (`render.py`) and with
FFmpeg; no third-party impulse responses or plug-ins are used.

### Considered and rejected for the backing tracks

| Source | Why not |
|---|---|
| SGM-V2.01, Timbres of Heaven, Arachno SoundFont | Not evaluated in this run. They are popular, but I did not have a licence text for them that clearly permits commercial use, so they were left out rather than assumed. |
| Sonatina Symphonic Orchestra | Creative Commons Sampling Plus 1.0 (advertising restriction). |
| Commercial sample libraries of any kind | Not free to redistribute renders from without a paid licence. |
## Public-domain standards (second overnight run)

Fifty-four famous songs published in 1930 or earlier were written out by hand from the original published
melody and words. Each was checked against two rules before it was written: first published in 1930 or
earlier (public domain in the United States in 2026), and every credited composer and lyricist died in 1971
or earlier (public domain in Canada, life plus 50 years for authors who died before the 2022 extension).
Death years were checked one by one (Wikipedia, Library of Congress and VIAF authority records, the UCSB
Discography of American Historical Recordings); melodies were read from scans of period sheet music
(Internet Archive, Wikimedia Commons, library collections) or from *The Public Domain Song Anthology*
(Open Book Publishers, CC BY 4.0, which itself reproduces public-domain sheet music). Dialect spellings in a
few period lyrics are written in standard spelling; the words are otherwise as published. Every song is
tagged `standard` and appears on the "Jazz and classic standards" shelf (the two Japanese songs are in the catalog
but not on that shelf).

| Song | Published | Music by (died) | Words by (died) | US | Canada | Sources checked |
|---|---|---|---|---|---|---|
| Plaisir d'amour (`plaisir-d-amour`) | 1784 | Jean-Paul-Égide Martini (1816) | Jean-Pierre Claris de Florian (1794) | yes | yes | <https://commons.wikimedia.org/wiki/File:Plaisir_d%27amour_(%C3%A9d._Leduc),_page_1.jpg> <https://en.wikipedia.org/wiki/Plaisir_d%27amour> |
| Cielito Lindo (`cielito-lindo`) | 1882 | Quirino Mendoza y Cortés (1957) | Quirino Mendoza y Cortés (1957), after older Spanish coplas | yes | yes | <https://en.wikipedia.org/wiki/Cielito_Lindo> <https://es.wikipedia.org/wiki/Cielito_lindo> |
| After the Ball (`after-the-ball`) | 1892 | Charles K. Harris (1930) | Charles K. Harris (1930) | yes | yes | <https://imslp.org/wiki/After_the_Ball_(Harris,_Charles_Kassell)> <https://en.wikipedia.org/wiki/Charles_K._Harris> |
| Daisy Bell (A Bicycle Built for Two) (`daisy-bell`) | 1892 | Harry Dacre (1922) | Harry Dacre (1922) | yes | yes | <https://commons.wikimedia.org/wiki/File:Daisy_Bell_(IA_daisybell00harr).pdf> <https://en.wikipedia.org/wiki/Harry_Dacre> |
| The Sidewalks of New York (`the-sidewalks-of-new-york`) | 1894 | Charles B. Lawlor (1925) | James W. Blake (1935) | yes | yes | <https://imslp.org/wiki/The_Sidewalks_of_New_York_(Lawlor,_Charles_B.)> <https://en.wikipedia.org/wiki/Charles_B._Lawlor> <https://en.wikipedia.org/wiki/James_W._Blake> |
| Bill Bailey, Won't You Please Come Home (`bill-bailey`) | 1902 | Hughie Cannon (1912) | Hughie Cannon (1912) | yes | yes | <https://commons.wikimedia.org/wiki/File:Bill_Bailey_Won%27t_You_Please_Come_Home.pdf> <https://en.wikipedia.org/wiki/Hughie_Cannon> |
| In the Good Old Summer Time (`in-the-good-old-summer-time`) | 1902 | George "Honey Boy" Evans (1915) | Ren Shields (1913) | yes | yes | <https://en.wikipedia.org/wiki/George_%22Honey_Boy%22_Evans> <https://en.wikipedia.org/wiki/Ren_Shields> <https://doi.org/10.32881/book2> |
| Sweet Adeline (You're the Flower of My Heart, Sweet Adeline) (`sweet-adeline`) | 1903 | Harry Armstrong (1951) | Richard H. Gerard (Husch) (1948) | yes | yes | <https://imslp.org/wiki/You%27re_the_Flower_of_My_Heart,_Sweet_Adeline_(Armstrong,_Henry_W.)> <https://en.wikipedia.org/wiki/Henry_W._Armstrong> <https://web.archive.org/web/20030513105335/http://www.morrisonfoundation.org/Richard_H_Gerard.htm> |
| Give My Regards to Broadway (`give-my-regards-to-broadway`) | 1904 | George M. Cohan (1942) | George M. Cohan (1942) | yes | yes | <https://archive.org/details/jukebox.broadway> <https://en.wikipedia.org/wiki/George_M._Cohan> |
| Meet Me in St. Louis, Louis (`meet-me-in-st-louis`) | 1904 | Kerry Mills (1948) | Andrew B. Sterling (1955) | yes | yes | <https://imslp.org/wiki/Meet_Me_in_St._Louis,_Louis_(Mills,_Kerry)> <https://en.wikipedia.org/wiki/Kerry_Mills> <https://en.wikipedia.org/wiki/Andrew_B._Sterling> |
| Torna a Surriento (`torna-a-surriento`) | 1905 (copyright; written 1894/1902) | Ernesto De Curtis (1937) | Giambattista De Curtis (1926) | yes | yes | <https://en.wikipedia.org/wiki/Ernesto_De_Curtis> <https://en.wikipedia.org/wiki/Giambattista_De_Curtis> <https://imslp.org/wiki/Torna_a_Surriento_(De_Curtis,_Ernesto)> |
| You're a Grand Old Flag (`youre-a-grand-old-flag`) | 1906 | George M. Cohan (1942) | George M. Cohan (1942) | yes | yes | <https://doi.org/10.32881/book2> <https://imslp.org/wiki/You%27re_a_Grand_Old_Flag_(Cohan,_George_Michael)> <https://commons.wikimedia.org/wiki/File:You%27re_A_Grand_Old_Flag_5.jpg> |
| Shine On, Harvest Moon (`shine-on-harvest-moon`) | 1908 | Nora Bayes (1928) / Jack Norworth (1959) | Jack Norworth (1959) / Nora Bayes (1928) | yes | yes | <https://commons.wikimedia.org/wiki/File:Shine_On_Harvest_Moon_(1908)_sheet_music.pdf> <https://en.wikipedia.org/wiki/Nora_Bayes> <https://en.wikipedia.org/wiki/Jack_Norworth> |
| Take Me Out to the Ball Game (`take-me-out-to-the-ball-game`) | 1908 | Albert Von Tilzer (1956) | Jack Norworth (1959) | yes | yes | <https://imslp.org/wiki/Take_Me_Out_to_the_Ball_Game_(Von_Tilzer,_Albert)> <https://en.wikipedia.org/wiki/Albert_Von_Tilzer> <https://en.wikipedia.org/wiki/Jack_Norworth> |
| By the Light of the Silvery Moon (`by-the-light-of-the-silvery-moon`) | 1909 | Gus Edwards (1945) | Edward Madden (1952) | yes | yes | <https://imslp.org/wiki/By_the_Light_of_the_Silvery_Moon_(Edwards,_Gus)> <https://en.wikipedia.org/wiki/Gus_Edwards_(vaudevillian)> <https://en.wikipedia.org/wiki/Edward_Madden_(lyricist)> |
| Down by the Old Mill Stream (`down-by-the-old-mill-stream`) | 1910 | Tell Taylor (1937); Earl K. Smith (1954) later claimed co-composer on renewal | Tell Taylor (1937) | yes | yes | <https://imslp.org/wiki/Down_by_the_Old_Mill_Stream_(Taylor,_Tell)> <https://archive.org/details/SM000421> <https://viaf.org/viaf/78005187> |
| Let Me Call You Sweetheart (`let-me-call-you-sweetheart`) | 1910 | Leo Friedman (1927) | Beth Slater Whitson (1930) | yes | yes | <https://archive.org/details/letmecallyouswee00whit_0> <https://imslp.org/wiki/Let_Me_Call_You_Sweetheart_(Friedman,_Leo)> <https://popularmusic.library.wisc.edu/catalog/pop005453> |
| I Want a Girl (Just Like the Girl That Married Dear Old Dad) (`i-want-a-girl`) | 1911 | Harry Von Tilzer (1946) | William (Will) Dillon (1966) | yes | yes | <https://levysheetmusic.mse.jhu.edu/sites/default/files/collection-pdfs/levy-153-004.pdf> <https://en.wikipedia.org/wiki/William_Dillon> <https://songhall.org/profile/Harry_Von_Tilzer> |
| Oh, You Beautiful Doll (`oh-you-beautiful-doll`) | 1911 | Nat D. Ayer (1952) | A. Seymour Brown (1947; a few sites say 1952, still before 1972) | yes | yes | <https://archive.org/details/SM002741> <https://adp.library.ucsb.edu/names/102551> <https://adpprod2.library.ucsb.edu/names/100307> |
| Frankie and Johnny (`frankie-and-johnny`) | by 1912 (traditional) | Traditional | Traditional (text: Sandburg, The American Songbag, 1927, stanzas 1, 6, 7) | yes | yes (no individual author) | <https://archive.org/details/americansongbag029895mbp> |
| It's a Long Way to Tipperary (`its-a-long-way-to-tipperary`) | 1912 | Jack Judge (1938) / Harry Williams (1924) | Jack Judge (1938) / Harry Williams (1924) | yes | yes | <https://archive.org/details/CSM_01044> <https://imslp.org/wiki/It's_a_Long_Way_to_Tipperary_(Judge,_Jack)> <https://en.wikipedia.org/wiki/It%27s_a_Long_Way_to_Tipperary> |
| Moonlight Bay (`moonlight-bay`) | 1912 | Percy Wenrich (1952) | Edward Madden (1952) | yes | yes | <https://archive.org/details/jukebox.moonlightbay> <https://archive.org/details/jukebox.moonlightbay.omr> <https://www.songhall.org/profiles/edward-madden> |
| Ballin' the Jack (`ballin-the-jack`) | 1913 | Chris Smith (1949) | Jim Burris (1923) | yes | yes | <https://archive.org/details/SM000501> <https://imslp.org/wiki/Ballin%27_the_Jack_(Smith,_Chris)> <https://en.wikipedia.org/wiki/Chris_Smith_(composer)> |
| Peg o' My Heart (`peg-o-my-heart`) | 1913 | Fred Fisher (1942) | Alfred Bryan (1958) | yes | yes | <https://archive.org/details/SM002740> <https://imslp.org/wiki/Peg_O'_My_Heart_(Fisher,_Fred)> <https://www.cshf.ca/song/peg-o-my-heart/> |
| You Made Me Love You (I Didn't Want to Do It) (`you-made-me-love-you`) | 1913 | James V. Monaco (1945) | Joseph McCarthy (1943) | yes | yes | <https://archive.org/details/SM000400> <https://imslp.org/wiki/You_Made_Me_Love_You_(Monaco,_James_Vincent)> <https://en.wikipedia.org/wiki/James_V._Monaco> |
| St. Louis Blues (`st-louis-blues`) | 1914 | W. C. Handy (1958) | W. C. Handy (1958) | yes | yes | <https://commons.wikimedia.org/wiki/File:W._C._Handy_-_St._Louis_Blues_(1914,_Handy_Bros.).pdf> <https://commons.wikimedia.org/wiki/File:W._C._Handy_-_St._Louis_Blues_(1914,_Pace_and_Handy).pdf> <https://en.wikipedia.org/wiki/W._C._Handy> |
| Pack Up Your Troubles in Your Old Kit-Bag (`pack-up-your-troubles`) | 1915 | Felix Powell (1942) | George Henry Powell as George Asaf (1951) | yes | yes | <https://archive.org/details/mms_driscoll_ser_6_box_167_pack_up_your_troubles_in_your> <https://en.wikipedia.org/wiki/Felix_Powell> <https://popularmusic.library.wisc.edu/catalog/pop001146> |
| Over There (`over-there`) | 1917 | George M. Cohan (1942) | George M. Cohan (1942) | yes | yes | <https://archive.org/details/overthere00coha> <https://en.wikipedia.org/wiki/George_M._Cohan> |
| Smiles (`smiles`) | 1917 | Lee S. Roberts (1949) | J. Will Callahan (1946) | yes | yes | <https://commons.wikimedia.org/wiki/File:Smiles_-_Mon_soleil,_c%27est_ton_sourire_-_(fox-trot)_pour_piano_et_chant_-_par_Lee_S._Roberts_> <https://en.wikipedia.org/wiki/Lee_S._Roberts> <https://en.wikipedia.org/wiki/J._Will_Callahan> |
| Hamabe no Uta (`hamabe-no-uta`) | 1918 (Senō Gakufu; composed by 1916, poem 1913) | Tamezō Narita (1945) | Kokei Hayashi (1947) | yes | yes | <https://ja.wikipedia.org/wiki/浜辺の歌> <https://imslp.org/wiki/Hamabe_no_Uta_(Narita,_Tamez%C5%8D)> |
| Ja-Da (`ja-da`) | 1918 | Bob Carleton (1956) | Bob Carleton (1956) | yes | yes | <https://commons.wikimedia.org/wiki/File:Ja-da_-_ja_da,_ja_da,_jing_jing_jing!_(IA_jadajadajadajing00carl).pdf> <https://en.wikipedia.org/wiki/Bob_Carleton> |
| Avalon (`avalon`) | 1920 | Vincent Rose (1944) | Al Jolson (1950), B. G. DeSylva (1950) | yes | yes | <https://en.wikipedia.org/wiki/Vincent_Rose> <https://en.wikipedia.org/wiki/Al_Jolson> <https://en.wikipedia.org/wiki/Buddy_DeSylva> |
| The Japanese Sandman (`the-japanese-sandman`) | 1920 | Richard A. Whiting (1938) | Raymond B. Egan (1952) | yes | yes | <https://en.wikipedia.org/wiki/Richard_A._Whiting> <https://en.wikipedia.org/wiki/Raymond_B._Egan> |
| Ain't We Got Fun (`aint-we-got-fun`) | 1921 | Richard A. Whiting (1938) | Gus Kahn (1941), Raymond B. Egan (1952) | yes | yes | <https://archive.org/details/SM002357> <https://en.wikipedia.org/wiki/Gus_Kahn> <https://en.wikipedia.org/wiki/Richard_A._Whiting> |
| April Showers (`april-showers`) | 1921 | Louis Silvers (1954) | B. G. DeSylva (1950) | yes | yes | <https://en.wikipedia.org/wiki/Louis_Silvers> <https://en.wikipedia.org/wiki/Buddy_DeSylva> |
| Carolina in the Morning (`carolina-in-the-morning`) | 1922 | Walter Donaldson (1947) | Gus Kahn (1941) | yes | yes | <https://commons.wikimedia.org/wiki/File:Carolina_in_the_Morning.pdf> <https://en.wikipedia.org/wiki/Walter_Donaldson_(songwriter)> <https://en.wikipedia.org/wiki/Gus_Kahn> |
| Toot, Toot, Tootsie (Goo' Bye!) (`toot-toot-tootsie`) | 1922 | Gus Kahn (1941), Ernie Erdman (1946), Dan Russo (1956) | same | yes | yes | <https://en.wikipedia.org/wiki/Gus_Kahn> <https://adp.library.ucsb.edu/names/111147> <https://en.wikipedia.org/wiki/Danny_Russo> |
| Charleston (`charleston`) | 1923 | James P. Johnson (1955) | Cecil Mack (1944) | yes | yes | <https://en.wikipedia.org/wiki/James_P._Johnson> <https://en.wikipedia.org/wiki/Cecil_Mack> |
| I'll See You in My Dreams (`ill-see-you-in-my-dreams`) | 1924 (Leo Feist) | Isham Jones (1956) | Gus Kahn (1941) | yes | yes | <https://imslp.org/wiki/I'll_See_You_in_My_Dreams_(Jones,_Isham)> <https://en.wikipedia.org/wiki/Isham_Jones> <https://en.wikipedia.org/wiki/Gus_Kahn> |
| It Had to Be You (`it-had-to-be-you`) | 1924 (Remick) | Isham Jones (1956) | Gus Kahn (1941) | yes | yes | <https://imslp.org/wiki/It_Had_to_Be_You_(Jones,_Isham)> <https://en.wikipedia.org/wiki/Isham_Jones> <https://en.wikipedia.org/wiki/Gus_Kahn> |
| Dinah (`dinah`) | 1925 | Harry Akst (1963) | Sam M. Lewis (1959) and Joe Young (1939) | yes | yes | <https://imslp.org/wiki/Dinah_(Akst,_Harry)> <https://en.wikipedia.org/wiki/Harry_Akst> <https://en.wikipedia.org/wiki/Sam_M._Lewis> |
| Five Foot Two, Eyes of Blue (Has Anybody Seen My Girl?) (`five-foot-two-eyes-of-blue`) | 1925 (Leo Feist) | Ray Henderson (1970) | Sam M. Lewis (1959), Joe Young (1939) | yes | yes | <https://archive.org/details/SM000155> <https://en.wikipedia.org/wiki/Ray_Henderson> <https://en.wikipedia.org/wiki/Sam_M._Lewis> |
| Sweet Georgia Brown (`sweet-georgia-brown`) | 1925 | Ben Bernie (1943) and Maceo Pinkard (1962) | Kenneth Casey (1965) | yes | yes | <https://imslp.org/wiki/Sweet_Georgia_Brown_(Bernie,_Ben)> <https://en.wikipedia.org/wiki/Kenneth_Casey> <https://viaf.org/viaf/61815933/> |
| Yes Sir, That's My Baby (`yes-sir-thats-my-baby`) | 1925 (Irving Berlin, Inc.) | Walter Donaldson (1947) | Gus Kahn (1941) | yes | yes | <https://commons.wikimedia.org/wiki/File:Yes_Sir!_That%27s_My_Baby.pdf> <https://imslp.org/wiki/Yes_Sir,_That's_My_Baby_(Donaldson,_Walter)> <https://en.wikipedia.org/wiki/Walter_Donaldson_(songwriter)> |
| Bye Bye Blackbird (`bye-bye-blackbird`) | 1926 (Jerome H. Remick & Co.) | Ray Henderson (1970) | Mort Dixon (1956) | yes | yes | <https://archive.org/details/SM001855> <https://imslp.org/wiki/Bye_Bye_Blackbird_(Henderson,_Ray)> <https://en.wikipedia.org/wiki/Ray_Henderson> |
| Akatonbo (Red Dragonfly) (`akatonbo`) | 1927 (poem 1921) | Kōsaku Yamada (1965) | Rofū Miki (1964) | yes | yes | <https://commons.wikimedia.org/wiki/File:Ndl-digital-collection-yamadakosaku100-2-akatonbo.jpg> <https://en.wikipedia.org/wiki/Akatombo> <https://en.wikipedia.org/wiki/Kosaku_Yamada> |
| Careless Love (`careless-love`) | traditional; printed 1927 (Sandburg) | Traditional | Traditional (text: Sandburg 1927, from R. W. Gordon, stanzas 1-2) | yes | yes (no individual author) | <https://archive.org/details/americansongbag029895mbp> |
| I'm Looking Over a Four Leaf Clover (`im-looking-over-a-four-leaf-clover`) | 1927 (Jerome H. Remick & Co.) | Harry Woods (1970) | Mort Dixon (1956) | yes | yes | <https://archive.org/details/SM000134> <https://en.wikipedia.org/wiki/Harry_M._Woods> <https://en.wikipedia.org/wiki/Mort_Dixon> |
| My Blue Heaven (`my-blue-heaven`) | 1927 (Leo Feist) | Walter Donaldson (1947) | George A. Whiting (1943) | yes | yes | <https://commons.wikimedia.org/wiki/File:My_Blue_Heaven_(1927)_sheet_music.pdf> <https://imslp.org/wiki/My_Blue_Heaven_(Donaldson,_Walter)> <https://en.wikipedia.org/wiki/George_A._Whiting> |
| Ol' Man River (`ol-man-river`) | 1927 (T. B. Harms Co.; from "Show Boat") | Jerome Kern (1945) | Oscar Hammerstein II (1960) | yes | yes | <https://commons.wikimedia.org/wiki/File:Ol%27_Man_River_(1927)_Sheet_music.pdf> <https://en.wikipedia.org/wiki/Jerome_Kern> <https://en.wikipedia.org/wiki/Oscar_Hammerstein_II> |
| Side by Side (`side-by-side`) | 1927 (Shapiro, Bernstein & Co.) | Harry Woods (1970) | Harry Woods (1970) | yes | yes | <https://archive.org/details/SM000259> <https://imslp.org/wiki/Side_By_Side_(Woods,_Harry)> <https://en.wikipedia.org/wiki/Harry_M._Woods> |
| St. James Infirmary (`st-james-infirmary`) | traditional; text and tune printed 1927 (Sandburg, "Those Gambler's Blues", version B) | Traditional | Traditional (Sandburg 1927 text) | yes | yes (no individual author used) | <https://archive.org/details/americansongbag029895mbp> <https://en.wikipedia.org/wiki/St._James_Infirmary_Blues> |
| Makin' Whoopee (`makin-whoopee`) | 1928 (Donaldson, Douglas & Gumble; from "Whoopee!") | Walter Donaldson (1947) | Gus Kahn (1941) | yes | yes | <https://commons.wikimedia.org/wiki/File:Makin%27_Whoopee!_(1928)_Sheet_Music.pdf> <https://en.wikipedia.org/wiki/Walter_Donaldson_(songwriter)> <https://en.wikipedia.org/wiki/Gus_Kahn> |
| Am I Blue? (`am-i-blue`) | 1929 (M. Witmark & Sons) | Harry Akst (1963) | Grant Clarke (1931) | yes | yes | <https://commons.wikimedia.org/wiki/File:Am_I_Blue%3F_sheet_music_(1929).pdf> <https://imslp.org/wiki/Am_I_Blue%3F_(Akst,_Harry)> <https://en.wikipedia.org/wiki/Harry_Akst> |

### Standards considered and left out

| Song | Why |
|---|---|
| 'O sole mio | A 2002 Italian court recognised Alfredo Mazzucchi, who died in 1972, as co-composer of the melody. That fails the Canada rule. |
| My Melancholy Baby | Maybelle E. Watson wrote the original 1911 words and was credited as co-lyricist after a royalty suit; her death year could not be found, so the Canada rule cannot be confirmed. |
| Basin Street Blues | The only scan available already contains the verse that Glenn Miller and Jack Teagarden added in 1931, which is not public domain in the US until 2027; the 1928 original could not be separated from it. |
| Waiting for the Robert E. Lee | Rights are fine, but the available sources disagree on the syncopated chorus; the verse also leans on minstrel-era dialect and plantation imagery. Left for a later decision. |
| Till We Meet Again | Rights are fine; the only scan was too low in resolution to read the chorus reliably. |
| K-K-K-Katy | Rights are fine; the only scan was too small to read one bar with confidence. |
| When the Red, Red Robin Comes Bob, Bob, Bobbin' Along | Rights are fine; the 1926 printing is only behind bot checks, and the open copy is a 1960 choral arrangement. |
| Estrellita | Rights are fine (Ponce died 1948); no melody source could be reached. |
| Nobody Knows You When You're Down and Out | Rights are fine (Jimmy Cox died 1925); no scan of the 1923 sheet music, and the familiar words come from a 1929 recording. |
| Sous les ponts de Paris | Rights are fine (Scotto died 1952, Rodor 1967); neither the 1913 melody nor the original words could be checked. |

Also left out on purpose, without being written: "Mack the Knife" (the English words are by Marc Blitzstein, 1954)
and "Lady Be Good", "Ain't Misbehavin'" and other songs whose authors died after 1971 (for example Irving Berlin, Hoagy
Carmichael, Fats Waller's lyricist Andy Razaf died 1973), which are public domain in the US but not yet in Canada.
