# Design principles for NoteAlong

What the best music apps have in common, and the five rules we take from them.
Spotify and Apple Music make the screen about one thing (the song) and keep their own chrome quiet.
Apple Music's lyrics view puts the current line in enormous type and lets the rest fade. Moises and
Yousician make feedback feel musical: things move on the beat, states are never ambiguous, and the
app always looks like it knows what is happening. Simply Piano makes the next action obvious for
someone who cannot read music.

1. **The current line owns the stage.** In the player everything else, including our own controls,
   steps back. The line being sung is large enough to read from a music stand a metre away; the
   previous and next lines are present but clearly secondary. No decoration competes with it.
2. **One colour means "now".** The accent is reserved for the thing that is happening: the note to
   play, the word being sung, the play button. Everything else is neutral, so the eye finds "now"
   without searching. Cover art is where the colour lives on Discover.
3. **Motion follows the music, not the mouse.** Highlights move on the beat with the easing of a
   conductor's hand, lines scroll gently into place, the count-in pulses. Motion that answers an
   action (opening a panel, saving an edit) confirms what changed. Nothing animates just to animate.
4. **Say it in the player's words.** "Higher / Lower", "Slower", "Hear the melody quietly", "Which
   note to play". Theory terms appear only where unavoidable (key, octave) and get a one-line tooltip.
   Buttons say exactly what they do.
5. **Confidence in the details.** Skeletons instead of spinners, a song that starts within a second,
   settings remembered per song, generous targets for fingers and for hands holding an instrument,
   and every state designed: empty, loading, failed, offline, first run. Light and dark both finished.
