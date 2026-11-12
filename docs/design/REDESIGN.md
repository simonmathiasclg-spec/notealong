# NoteAlong redesign: "Front Row"

**Run it:** `./start.sh`, then open http://localhost:3001

## In short

- **The direction:** the confident stage of the Lola Wilde site (warm black, a huge condensed red title, a 3D ring
  of portrait cards, quiet pill navigation, track lists with hairlines) with the music widgets of the Dribbble shot
  as the material for every song (artwork as the whole surface, tiny white type, a round play button, a hairline of
  progress). Chosen from three mockups, below.
- **Fonts:** Archivo (display, song titles, lyrics, note letters) and Instrument Sans (everything you click). Both
  are SIL Open Font License, free for commercial web use. Inter and Fraunces are gone.
- **Covers:** the generator now draws photographic-feeling pictures (light through leaves, low sun through a window,
  a red sun over a dune, city lights out of focus, a backlit curtain, light on a pool floor, dusk through grass) with
  a light leak, halation and film grain. Each song's colours tint its own surfaces, and its "now" colour (the note
  to play, the word being sung) comes from its artwork.
- **The signature detail:** a stage light. While a song plays, a thin beam of light crosses the current line in
  time with the music, pooling on the word below, and each note blooms as you reach it.
- **Motion:** spring physics throughout (the ring of songs, the navigation pill, the mini player, the lines of the
  lyrics), parallax inside the ring's cards, and the cover morphing from a tile into the player (React view
  transitions). All of it switches off with the system's "reduce motion" setting.
- **New:** a mini player. Leave a song while it plays and it carries on in a small artwork widget in the corner;
  click it and you are back in the player with the same audio, no gap.
- **Function first:** the player still reads from a music stand: the current line is up to 4.6 rem, bone white on a
  dimmed, blurred backdrop at about 11 to 13 to 1 contrast (never below 6.8 to 1 even against the brightest part of
  the artwork). Timing guide, Hear it played, key changes, edit mode, setlists, search, favourites, uploads and the
  online version all work as before; Python tests (85), web tests (86) and the production build pass.

## The references, studied

Both were opened in a real browser (Playwright): full-size screenshots, the live Lola Wilde site scrolled and recorded
as video, its carousel dragged, hovered and opened, and its styles measured.

- **Dribbble, "Music widget" by Kawsar Ahmed.** Squircle, tall, wide and round widgets; the photo fills the shape,
  softly blurred, grainy; 26 px light white title cut by a fade, artist in small capitals at 60 % white; a four-bar
  waveform glyph in the corner; a round 62 px play button in translucent white whose icon takes the picture's dark;
  a 1 px progress line with a short vertical tick for the playhead; open-triangle skip icons; on the round widget
  the progress is an arc. Colours come from the pictures: deep foliage green, burnt orange, amber corridor light.
- **Lola Wilde (Awwwards nominee) and lolawilde.com.** Background `#0B0A09`, text `#F3EEE7`; the name in Archivo Black,
  83 px, red `#D9141F`, tracking -1 %; a centred row of 14 px links with one bone pill ("Listen"); a ring of twelve
  portrait cards 300 × 468 px, 22 px corners, 23° apart on a curved wall in 1500 px perspective, the side cards
  turned away and dimmed, numbered "01" with "03 · SINGLE" on the one in the middle, its title in Archivo Bold 24 px,
  and a white "Play and sing along" pill that appears only on the centre card; "01 / 12" between round arrow
  buttons; "Drag to browse" in faint small type at the left. Cards load as colour fields that sharpen into photos.
  Below: an album block (square art, a red pill and an outlined pill), a numbered track list with hairlines, panels
  on `#1D1915`, and the red name again as the footer. Its sing-along view: a tall picture on the left, "TRACK 02 OF
  12" in tracked small capitals, the title in Archivo ExtraBold at 58 px, the lyrics in Archivo SemiBold with the
  current line bright and the rest dim, over the picture blurred into the background.

The reference screenshots, the scroll recording and the frames are kept in `docs/design/references/` on this Mac only
(that folder is not committed: it is other people's work). The side-by-side tables below show them when this file is
opened here; on GitHub only our half shows.

Copied: layouts, proportions, the type scale, spacing, colour treatment, controls, shapes and motion. Not copied:
their photos, logos, names, text or code. Our pages use our own songs, our generated artwork and fonts with
commercial licences.

## Three directions

Each was rendered as a static mockup of Discover and the player, with real catalog songs and the new covers
(`docs/design/redesign/mockups/`).

| | A. Front Row | B. Greenhouse | C. Late Set |
|---|---|---|---|
| Combines | Lola's stage and ring, Dribbble's surfaces | Dribbble's widget board, artwork everywhere | an editorial night page: full-bleed art hero, film strip |
| Fonts | Archivo condensed black + Archivo + Instrument Sans | Big Shoulders Display + Hanken Grotesk | Archivo expanded black + Newsreader (serif lyrics) |
| Colour | warm black, bone, one red; art colours per song | no house colour; the art's light is "now" | black and an amber light leak |
| Signature | a light sweeping across the line | a turntable: the round widget spins while it plays | notes that bloom like light |
| Discover | ![A](redesign/mockups/a-front-row-discover.png) | ![B](redesign/mockups/b-greenhouse-discover.png) | ![C](redesign/mockups/c-late-set-discover.png) |
| Player | ![A](redesign/mockups/a-front-row-player.png) | ![B](redesign/mockups/b-greenhouse-player.png) | ![C](redesign/mockups/c-late-set-player.png) |

**The pick: A, Front Row.** It is the only one that takes both references at their word: Lola's confident red title
and 3D ring give Discover a point of view, and the Dribbble widgets give every song its own surface.
A's split player failed the 1-metre test (the lyrics wrapped beside the picture), so the player takes B's full-width
stage over the blurred artwork.

## Fonts and licences

| Role | Font | Where from | Licence |
|---|---|---|---|
| The house title (condensed black), song and page titles, lyrics, note letters, the wordmark | **Archivo**, variable: width 62 to 125 %, weight 100 to 900 (Omnibus-Type) | Google Fonts, self-hosted from `@fontsource-variable/archivo` 5.3.0 | SIL Open Font License 1.1: commercial use, embedding and self-hosting allowed |
| Buttons, navigation, labels, body text | **Instrument Sans**, variable (Instrument) | Google Fonts, self-hosted from `@fontsource-variable/instrument-sans` 5.3.0 | SIL Open Font License 1.1 |

Why these: Lola Wilde's display face is Archivo Black, itself under the OFL, so the closest match is the family
itself; its width axis gives both the wide black of Lola's subtitles and the condensed black of our title from one
file. Both references set their small type in Inter (banned here); Instrument Sans is the closest free neo-grotesque
that isn't on the list, a little narrower and more refined. Archivo has no music signs, so the sharp and flat are
drawn (`components/art/Glyphs.tsx`) to sit with its letters.

## Colour

| Token | Dark (default) | Light ("house lights") | Use |
|---|---|---|---|
| Room | `#0B0A09` | `#F3EEE7` | the background |
| Bone / ink | `#F3EEE7` | `#0B0A09` | text, the pill that marks where you are, primary buttons |
| Raised | `#161311` | `#FBF8F3` | sheets and dialogs (a step of tone, no border) |
| House red | `#E1251B` | `#D0170E` | the title, the wordmark, "Add a song", "Play along", the record |
| Song colours | from its cover: deep, mid, glow | same | backdrops, the colour a cover loads from, the player's tint |
| Now | from the cover's light, adjusted to at least 4.5 : 1 on the room and under chip letters | same | the note to play, the word being sung, the stage light |

## Covers

`service/notealong/catalog/artwork.py` draws each cover from the song's id: one of ten palettes (fern, ember, amber,
crimson, tide, plum, ochre, ink, rose, smoke; a song's style leans towards a few) and one of seven scenes, toned with
a gradient map like a print, then a light leak from one edge, halation around the brightest light, a vignette and
film grain. 960 px WebP, about 70 KB each, about a quarter of a second. All 208 built-in songs were redrawn
(`python -m notealong.catalog.build --covers`) and their colours stored in `catalog.json`. Uploads keep the picture
inside their file (private to the uploader); one without a picture gets a generated cover the first time it is shown.
The film grain is also laid over artwork in the app as a texture (`web/public/grain.png`) so it stays crisp at any size.

## Before and after

| | Before | After |
|---|---|---|
| Discover | ![](redesign/before/discover-desktop.jpg) | ![](redesign/screens/discover-desktop.jpg) |
| Player | ![](redesign/before/player-desktop.jpg) | ![](redesign/screens/player-desktop.jpg) |
| Discover, phone | ![](redesign/before/discover-phone.jpg) | ![](redesign/screens/discover-phone.jpg) |
| Player, phone | ![](redesign/before/player-phone.jpg) | ![](redesign/screens/player-phone.jpg) |

("Before" is the app at commit 63b1f1f, with its own covers.)

## Side by side with the references

| Reference | NoteAlong |
|---|---|
| ![](references/lola-00-load.png) Lola Wilde: title, pill navigation, the ring | ![](redesign/screens/discover-desktop.jpg) Discover |
| ![](references/lola-tv-1500.png) Lola Wilde: sing-along | ![](redesign/screens/player-blue-desktop.jpg) The player |
| ![](references/lola-02-scroll.png) Lola Wilde: album and track list | ![](redesign/screens/song-page-desktop.jpg) A song's page |
| ![](references/lola-03-scroll.png) Lola Wilde: track list | ![](redesign/screens/my-songs-desktop.jpg) My songs |
| ![](references/dribbble-shot.png) Dribbble: widgets in four shapes | ![](redesign/screens/discover-shelves-desktop.jpg) Shelves of widgets |
| ![](references/dribbble-shot.png) Dribbble: the wide widget | ![](redesign/screens/mini-player-close.jpg) The mini player |
| ![](references/dribbble-shot.png) Dribbble: the round widget's arc | ![](redesign/screens/processing-desktop.jpg) Getting a song ready |

## Every screen

| Screen | Desktop | iPad | Phone |
|---|---|---|---|
| First run | ![](redesign/screens/first-run-desktop.jpg) | | ![](redesign/screens/first-run-phone.jpg) |
| Discover | ![](redesign/screens/discover-desktop.jpg) | ![](redesign/screens/discover-ipad.jpg) | ![](redesign/screens/discover-phone.jpg) |
| Discover, shelves | ![](redesign/screens/discover-shelves-desktop.jpg) | | ![](redesign/screens/discover-shelves-phone.jpg) |
| Player | ![](redesign/screens/player-desktop.jpg) | ![](redesign/screens/player-ipad.jpg) | ![](redesign/screens/player-phone.jpg) |
| Settings | ![](redesign/screens/player-settings-desktop.jpg) | | ![](redesign/screens/player-settings-phone.jpg) |
| Edit mode | ![](redesign/screens/player-edit-desktop.jpg) | | |
| A song's page | ![](redesign/screens/song-page-desktop.jpg) | | ![](redesign/screens/song-page-phone.jpg) |
| My songs | ![](redesign/screens/my-songs-desktop.jpg) | | ![](redesign/screens/my-songs-phone.jpg) |
| My songs, empty | ![](redesign/screens/my-songs-empty-desktop.jpg) | | |
| Getting a song ready | ![](redesign/screens/processing-desktop.jpg) | | ![](redesign/screens/processing-phone.jpg) |
| Search | ![](redesign/screens/search-desktop.jpg) | | ![](redesign/screens/search-phone.jpg) |
| Setlists | ![](redesign/screens/setlists-desktop.jpg) | | |
| A setlist | ![](redesign/screens/setlist-desktop.jpg) | | ![](redesign/screens/setlist-phone.jpg) |
| Mini player | ![](redesign/screens/mini-player-desktop.jpg) | | |
| Print sheet | ![](redesign/screens/print-desktop.jpg) | | |
| Service not running | ![](redesign/screens/service-down-desktop.jpg) | | |
| Song not found | ![](redesign/screens/not-found-desktop.jpg) | | ![](redesign/screens/not-found-phone.jpg) |
| Sign in (online version) | ![](redesign/screens/sign-in-desktop.jpg) | | ![](redesign/screens/sign-in-phone.jpg) |
| Account (online version) | ![](redesign/screens/account-desktop.jpg) | | |
| House lights (light theme) | ![](redesign/screens/light-discover-desktop.jpg) | | ![](redesign/screens/light-discover-phone.jpg) |
| Player, light | ![](redesign/screens/light-player-desktop.jpg) | | |

## The signature detail: a stage light

![The stage light on the current line](redesign/screens/signature-stage-light.jpg)

The timing guide already had a thin line crossing the current line in time with the notes. It is now a stage light:
a bright core with a soft cone of the song's own colour around it, pooling on the word below, lighting each word as
it passes. When the beam reaches a note, the note blooms: it fills with the colour, flares and settles (a 0.5 s
keyframe on the chip). It is the same moment a player needs anyway (this note, now), so the delight is the
information. With the timing guide off, the notes still bloom; with reduced motion, nothing moves.

## Motion

- The ring of songs: spring physics on drag, flick, arrow keys, the round buttons and the trackpad; side cards turn
  away in perspective and dim; the picture inside each card drifts against its turn (parallax); the "Play along"
  pill rises onto the card that comes to the middle.
- Tile to player: the clicked cover morphs into the player's blurred backdrop (React `<ViewTransition>`, named only
  on the tile that was clicked, so the same song can appear twice on a page); other pages fade.
- The navigation pill slides to the section you open (a shared layout animation).
- The mini player springs in from below; its waveform glyph breathes while the song plays; long titles scroll as
  a marquee.
- Covers develop from their colour field into the picture as they load; the record turns while a file is added.
- The lyric lines glide into place (springs, kept from before); the count-in number pops in a ring.
- Reduced motion: every CSS animation and transition, the view transitions and the springs stop (Framer Motion's
  `reducedMotion="user"`, `useReducedMotion` in the ring).

## Refinement passes (as a demanding product designer)

Every screen was screenshotted at desktop (1440 × 900), iPad (834 × 1194) and phone (390 × 844) after each pass.

1. **First pass.** The "you are here" pill vanished on wide screens (two navigation bars shared one animation id); the
   ring could widen the phone page; the play button on tall tiles covered the title; the search box had a heavy double
   focus ring; a setlist's name was cut on phones; "song not found" was still the old small-icon card; the stage
   light was too faint to notice. All fixed.
2. **Second pass.** White titles over the brightest part of a picture were hard to read: added a soft shadow to
   artwork type; tightened setlist rows on phones; checked the light theme, a real upload's progress view, the
   online version's sign-in and account pages (with a local copy of Supabase and a throwaway user, removed after),
   and the account title sitting against the header.
3. **Third pass.** Centred titles on tall and round tiles get a soft dark halo; the page layer of a transition only
   fades (no slide); one last sweep of the banned list (below). Checked the morph frame by frame, and that reduced
   motion skips it.

## The banned list, checked

| Banned | Status |
|---|---|
| A coloured stripe on the left edge of cards, list items or active items | none anywhere (searched the code for left borders) |
| Inter, Fraunces, Geist, Plus Jakarta Sans, DM Sans, Poppins, Space Grotesk, Roboto | none; both font packages removed |
| The "active card": rounded card, soft shadow, tinted background, accent border | none; the current section is a bone pill, a chosen instrument a filled pill, a playing note a filled chip |
| Generic gradient blobs | none; the only gradients are the artwork's own colours and the shade that keeps text readable |
| Glassmorphism | none (no backdrop blur anywhere) |
| Emoji icons | none; transport glyphs drawn for the app, other icons at a light stroke |
| Pill badges on everything | pills are the navigation, primary buttons and "Play along"; no badges on tiles |
| Identical card grids | shelves mix tall, square, wide and round tiles; search results break the grid every few tiles; setlists are posters made from their songs |

## Calls I made (no questions asked)

- The reference screenshots stay out of git (other people's photos and work); everything we made is committed.
- The light theme stays, restyled as "house lights" (bone paper, ink, the same red).
- The mini player keeps the actual audio going (and "Hear it played" with it) rather than only remembering the song.
  Opening a different song stops it; a page reload clears it.
- A song's "now" colour comes from its artwork for built-in songs and uploads alike; black-and-white artwork falls
  back to the house red.
- Generated covers are WebP; the old SVG covers were removed from the catalog. The online version uploads the WebP
  covers too (nothing was deployed).
- On phones a long lyric line still shrinks to fit (as before) rather than wrapping, so the timing guide keeps
  working; a music stand needs a tablet or a laptop anyway.
- The local service now accepts calls only from pages on this Mac (any `localhost` port), part of moving to port 3001.
