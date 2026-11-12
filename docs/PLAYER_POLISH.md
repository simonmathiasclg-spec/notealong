# Player polish: tooltips, looping, "Hear it played", sheet music

Work done in four parts, each committed on its own. Screenshots are in `docs/player-polish/shots/`.
Decisions made along the way are noted under each part.

## Part 1: tooltips

**The problem.** The little labels on the buttons at the top of the player opened above the button, so
the top of the window cut them off. They were drawn with CSS inside the button, so any parent that
clips its contents could also cut them.

| Before | After |
| --- | --- |
| ![](player-polish/shots/tooltip-before-instrument-desktop.png) | ![](player-polish/shots/tooltip-after-instrument-desktop.png) |
| ![](player-polish/shots/tooltip-before-settings-phone.png) | ![](player-polish/shots/tooltip-after-settings-phone.png) |
| ![](player-polish/shots/tooltip-before-focus-ipad.png) | ![](player-polish/shots/tooltip-after-focus-ipad.png) |

**What changed.**

- One tooltip for the whole app (`web/src/components/TooltipLayer.tsx`). It is drawn in its own layer
  on top of the page and placed with Floating UI (`@floating-ui/dom`, MIT licence). It opens on the
  preferred side, flips to the other side when there is no room, and slides along the window edge
  instead of crossing it. No parent can clip it.
- The buttons at the top of the player now ask for "below".
- Everything that used the browser's own `title` tooltip (note chips, the instrument list, the "unsure"
  dot, "Add a note here") now uses the same tooltip, so they all look and behave alike.
- Timing: the first tooltip waits about a third of a second. Moving along a row of buttons then swaps
  the text at once, with no blink in the gaps between buttons. A click puts the tooltip away.
- Keyboard: moving with Tab shows the tooltip of the focused button; Esc closes it.
- Touch: a finger doesn't hover, so tooltips stay out of the way. The small "i" marks in Settings open
  on a tap.

**How it was checked.** A Playwright script hovered every element with a tooltip on the home page,
My songs, a song's page, the player, the player with Settings open and the player in edit mode, at
1440×900, 834×1194 (iPad), 390×844 (phone) and a short 1024×600 window. For each one it checked that
the tooltip was fully inside the window, showed the right text and did not cover its own button.
Result: 305 tooltips checked, 0 clipped or wrong. Sweeping the mouse across the row of top buttons:
6 tooltips seen, 0 moments without one. First tooltip: closed at 120 ms, open at 520 ms.

**Decisions.**

- Floating UI rather than Radix Tooltip: the app already marks tooltips with a `data-tip` attribute in
  about forty places; one small layer that reads that attribute fixes all of them without wrapping
  every button in a component.
- Tooltips are hints for the eye only. Every button keeps its own `aria-label` for screen readers.

## Part 2: looping

**The problem.** Dragging along the progress bar to move through the song left a loop behind, so the
song kept jumping back and it wasn't obvious why or how to stop it.

**Before and after: the same drag along the bar.**

| Before (a loop appears) | After (it only moves the song) |
| --- | --- |
| ![](player-polish/shots/loop-before-after-drag-desktop.png) | ![](player-polish/shots/loop-after-after-drag-desktop.png) |
| ![](player-polish/shots/loop-before-after-drag-ipad.png) | ![](player-polish/shots/loop-after-after-drag-ipad.png) |
| ![](player-polish/shots/loop-before-after-drag-phone.png) | ![](player-polish/shots/loop-after-after-drag-phone.png) |

**The new loop.**

| One line | Two lines (end handle dragged) | Phone |
| --- | --- | --- |
| ![](player-polish/shots/loop-after-one-line-desktop.png) | ![](player-polish/shots/loop-after-two-lines-desktop.png) | ![](player-polish/shots/loop-after-two-lines-phone.png) |

The one-time tip: ![](player-polish/shots/loop-after-hint-desktop.png)

**How it works now.**

- The bar only moves the song: drag to scrub, click or tap to jump. It never makes a loop, with a
  mouse or a finger.
- Looping is a deliberate act: the loop button (left of "Slower") or the L key loops the lyric line
  you are on. The button is filled yellow while a loop is on.
- While looping, the looped part is marked on the bar with a handle at each end. Drag a handle to take
  in more or fewer lines; it snaps to the starts and ends of lines. Hold Alt (Option) to place it
  freely. With the keyboard, Tab to a handle and use the arrow keys. On touch screens the handles are
  large enough for a thumb.
- A yellow chip above the bar says what is looping, "Looping: lines 4–5", with a ✕.
- To stop: the ✕, the loop button again, L again, or Esc.
- Clicking a lyric line outside the loop grows the loop to take that line in.
- The first time the player opens, a small note by the loop button says "Tip: tap ⟳ to loop the line
  you're on." It is shown once per browser and never again.
- Loops are still saved with the song and come back after a reload.

**Inside a loop.** Jumping (clicking the bar, previous/next line) stays inside the loop; next on the
last looped line goes round to the first. Speed, key changes, the timing guide and "Hear it played"
carry on as normal.

**Timing fix found on the way.** With "Hear it played" on, the first note after each trip round the
loop came in 40 to 55 ms early. Cause: for a moment after a jump the audio stands still (about 40 ms
in Chrome) while the app's clock had already set off, and the first note was booked in that moment.
Now the clock waits until the audio is really moving at speed, nothing is booked while a jump is in
progress, notes past the loop's end are not booked at all, and a note that is waiting is moved if the
clock is corrected after it was booked.

**How it was checked.**

- `looptest.mjs` (Playwright, at 1440×900, 834×1194 and 390×844): the tip shows once and not after a
  reload; a mouse drag, a click and a finger swipe on the bar move the song and make no loop; the
  button, L, Esc, ✕ start and stop a loop; handles snap to lines, move freely with Alt and can't cross
  each other; the loop survives a reload. All passed at all three sizes.
- `web/scripts/check-loop.mjs` (kept in the repo): plays La Cucaracha looping two lines with "Hear it
  played" on, four times round, then changes key and goes three more times round, at full and half
  speed. Result: the song was never outside the loop (0 ms); 129 notes timed at full speed, worst
  21 ms; 126 at half speed, worst 15 ms; no note from outside the loop was played.
- `web/scripts/check-hear-sync.mjs` over the whole song still passes: worst 12 ms at full speed, 15 ms
  at half speed, no drift.

**Decisions.**

- The chip sits in its own row above the bar, centred, so it can't be missed and never covers the
  handles (on touch screens it sits a little higher to clear the larger handles).
- The label counts lyric lines ("line 4", "lines 4–5"). A loop placed freely with Alt shows times
  instead ("0:18–0:24").
- Esc closes things in this order: an open panel, then the loop, then focus mode.
- The tip counts as seen as soon as it has been shown, so it can't come back.
- A loop starts 0.15 s before the line and ends 0.2 s after it, so the first note isn't clipped.
