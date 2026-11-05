/**
 * A steady clock for animation and for scheduling sound.
 *
 * `HTMLMediaElement.currentTime` is the truth, but some browsers only refresh
 * it every 20 to 40 ms, which makes a sweeping line stutter and would make
 * scheduled notes land late. SmoothClock runs its own clock at the playback
 * rate between refreshes and keeps steering it back to the media clock, so it
 * never drifts: a seek, a loop jump or a stall re-anchors it at once.
 *
 * A coarse media clock is only exactly right at the instant its value changes;
 * a repeated value is stale. So stale readings are ignored, and a fresh one is
 * taken to have changed, on average, half a polling interval ago.
 */
export class SmoothClock {
  private media = 0;
  private wall = 0;
  private valid = false;
  private lastRaw = NaN;
  private lastReadWall = 0;
  private coarse = false;
  private freshRun = 0;
  /** How far the two clocks may disagree before we jump instead of steering (seconds). */
  jump = 0.08;
  /** Share of the disagreement corrected on each fresh reading. */
  steer = 0.08;

  /** Returns the position to draw or schedule at. `wallMs` is performance.now(). */
  read(mediaTime: number, wallMs: number, rate: number, playing: boolean): number {
    if (!playing) { this.valid = false; this.lastRaw = NaN; return mediaTime; }
    if (!this.valid) {
      this.media = mediaTime; this.wall = wallMs; this.valid = true;
      this.lastRaw = mediaTime; this.lastReadWall = wallMs; this.freshRun = 0;
      return mediaTime;
    }
    const predicted = this.media + ((wallMs - this.wall) / 1000) * rate;
    const stale = mediaTime === this.lastRaw;
    const sincePoll = wallMs - this.lastReadWall;
    this.lastReadWall = wallMs;
    if (stale) {
      if (sincePoll > 0) { this.coarse = true; this.freshRun = 0; }
      if (predicted - mediaTime > this.jump + 0.25 * rate) { this.media = mediaTime; this.wall = wallMs; return mediaTime; } // really stuck
      this.media = predicted; this.wall = wallMs;
      return predicted;
    }
    this.lastRaw = mediaTime;
    if (this.coarse && ++this.freshRun > 40) this.coarse = false;
    const observed = mediaTime + (this.coarse ? (0.5 * sincePoll / 1000) * rate : 0);
    const err = observed - predicted;
    if (Math.abs(err) > this.jump) { this.media = mediaTime; this.wall = wallMs; return mediaTime; }
    const corrected = predicted + err * this.steer;
    this.media = corrected; this.wall = wallMs;
    return corrected;
  }

  reset() { this.valid = false; this.lastRaw = NaN; }
}
