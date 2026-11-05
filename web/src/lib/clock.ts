/**
 * A steady clock for animation and for scheduling sound.
 *
 * `HTMLMediaElement.currentTime` is the truth, but browsers only refresh it
 * every few milliseconds (some every 20 to 40 ms), which makes a sweeping line
 * stutter. SmoothClock runs its own clock at the playback rate between those
 * refreshes and keeps steering it back to the media clock, so it never drifts:
 * a seek, a loop jump or a stall re-anchors it at once.
 */
export class SmoothClock {
  private media = 0;
  private wall = 0;
  private valid = false;
  /** How far the two clocks may disagree before we jump instead of steering (seconds). */
  jump = 0.08;
  /** Share of the disagreement corrected on each reading. */
  steer = 0.06;

  /** Returns the position to draw or schedule at. `wallMs` is performance.now(). */
  read(mediaTime: number, wallMs: number, rate: number, playing: boolean): number {
    if (!playing) { this.valid = false; return mediaTime; }
    if (!this.valid) { this.media = mediaTime; this.wall = wallMs; this.valid = true; return mediaTime; }
    const predicted = this.media + ((wallMs - this.wall) / 1000) * rate;
    const err = mediaTime - predicted;
    if (Math.abs(err) > this.jump) { this.media = mediaTime; this.wall = wallMs; return mediaTime; }
    const corrected = predicted + err * this.steer;
    this.media = corrected; this.wall = wallMs;
    return corrected;
  }

  reset() { this.valid = false; }
}
