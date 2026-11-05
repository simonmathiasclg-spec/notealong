/**
 * "Hear it played": plays the melody on a sampled instrument, locked to the
 * backing track.
 *
 * The backing track is an <audio> element; the instrument is Web Audio. Every
 * few milliseconds the scheduler reads the song position and books the notes
 * that start within the next fraction of a second at their exact place on the
 * audio clock. Because each note is placed from the song position at that
 * moment, timing errors cannot add up: there is nothing to drift. A seek, a
 * loop jump, a speed change or a new set of notes (edit, key, octave) drops
 * what was booked and books again from where the song now is.
 */
import type { AudioEngine } from "./audio";
import type { Sampler, Voice } from "./sampler";

export type HearNote = { id: string; start: number; end: number; pitch: number };

/** How far ahead notes are booked, in real seconds. */
export const LOOKAHEAD = 0.22;
const TICK_MS = 25;
/** A note already under way is still started if at least this much of it is left (real seconds). */
const MIN_REST = 0.18;

export type Booking = { note: HearNote; delay: number; duration: number };

/**
 * Which notes to book now. `from` is the index of the first note not yet dealt
 * with; returns the bookings (delay and duration in real seconds from now) and
 * the new index. Pure, so it can be tested without a browser.
 */
export function plan(notes: HearNote[], from: number, t: number, rate: number, lookahead = LOOKAHEAD, sounding?: (id: string) => boolean): { bookings: Booking[]; next: number } {
  const bookings: Booking[] = [];
  let i = from;
  const horizon = t + lookahead * rate;
  while (i < notes.length && notes[i].start <= horizon) {
    const n = notes[i++];
    if (sounding?.(n.id)) continue;
    const delay = (n.start - t) / rate;
    if (delay >= -0.012) {
      bookings.push({ note: n, delay: Math.max(0, delay), duration: (n.end - n.start) / rate });
    } else {
      const rest = (n.end - t) / rate;                 // joined in the middle of the note
      if (rest >= MIN_REST) bookings.push({ note: n, delay: 0, duration: rest });
    }
  }
  return { bookings, next: i };
}

/** Index of the first note that has not finished at time t (notes sorted by start). */
export function firstAt(notes: HearNote[], t: number): number {
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].end > t) hi = mid; else lo = mid + 1; }
  return lo;
}

type Probe = { id: string; start: number; heardAt: number; rate: number; late: boolean };
type DebugWindow = Window & { __hearDebug?: boolean; __hearLog?: { id: string; start: number; errorMs: number; rate: number; late: boolean }[] };

export class HearEngine {
  private notes: HearNote[] = [];
  private next = 0;
  private voices = new Map<string, Voice>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private lastT = 0;
  private lastNow = 0;
  private lastRate = 1;
  private running = false;
  private probes: Probe[] = [];
  private unsub: (() => void) | null = null;

  constructor(private audio: AudioEngine, private sampler: Sampler) {
    audio.onJump = () => this.resync();
    this.unsub = audio.subscribe((s) => { if (s.playing) this.tick(); else this.silence(); });
  }

  setNotes(notes: HearNote[]) { this.notes = notes; this.resync(true); }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      void this.sampler.ctx.resume();
      this.timer ??= setInterval(() => this.tick(), TICK_MS);
      this.resync();
    } else {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.silence();
    }
  }

  /** Stops what is sounding (quick fade) and forgets what was booked. */
  private silence() {
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    this.running = false;
  }

  /**
   * The song jumped or the notes changed: drop notes that were booked but have
   * not started, and start again from the current position. Notes already
   * sounding are left to finish unless the notes themselves changed.
   */
  resync(all = false) {
    const now = this.sampler.ctx.currentTime;
    for (const [id, v] of this.voices) {
      if (all || v.when > now + 0.004) { v.stop(); this.voices.delete(id); }
    }
    this.running = false;
    if (this.enabled) this.tick();
  }

  private latency(): number {
    const ctx = this.sampler.ctx as AudioContext & { outputLatency?: number };
    const l = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return Number.isFinite(l) ? Math.max(0, Math.min(0.3, l)) : 0;
  }

  private tick() {
    if (!this.enabled || !this.sampler.ready) return;
    const state = this.audio.getState();
    if (!state.playing) { if (this.voices.size) this.silence(); return; }
    const ctx = this.sampler.ctx;
    const now = ctx.currentTime;
    const t = this.audio.smoothTime;
    const rate = this.audio.rate || 1;

    if (this.running) {
      const expected = this.lastT + (now - this.lastNow) * this.lastRate;
      if (rate !== this.lastRate || Math.abs(t - expected) > 0.06) {
        // a jump the engine did not announce (stall, tab wake-up) or a new speed
        for (const [id, v] of this.voices) { if (rate !== this.lastRate || v.when > now + 0.004) { v.stop(); this.voices.delete(id); } }
        this.running = false;
      }
    }
    if (!this.running) { this.next = firstAt(this.notes, t); this.running = true; }
    this.lastT = t; this.lastNow = now; this.lastRate = rate;

    for (const [id, v] of this.voices) if (v.end + 1 < now) this.voices.delete(id);

    const { bookings, next } = plan(this.notes, this.next, t, rate, LOOKAHEAD, (id) => this.voices.has(id));
    this.next = next;
    const latency = this.latency();
    for (const b of bookings) {
      // the instrument is heard `latency` after its place on the audio clock; the song position is what is heard now
      const when = now + Math.max(0, b.delay - latency);
      const voice = this.sampler.play(b.note.id, b.note.pitch, when, b.duration);
      if (!voice) continue;
      this.voices.set(b.note.id, voice);
      if ((window as DebugWindow).__hearDebug) this.probes.push({ id: b.note.id, start: b.note.start, heardAt: voice.when + latency, rate, late: b.delay === 0 && b.note.start < t - 0.012 });
    }
    if (this.probes.length) this.measure(now, rate);
  }

  /**
   * Test hook (window.__hearDebug): once a booked note has started, work out
   * from the media clock itself where the song was at that instant and record
   * how far that is from the note's start.
   */
  private measure(now: number, rate: number) {
    const w = window as DebugWindow;
    const media = this.audio.currentTime;
    const keep: Probe[] = [];
    for (const p of this.probes) {
      if (p.heardAt > now) { keep.push(p); continue; }
      if (p.rate !== rate || now - p.heardAt > 0.2) continue;
      const songAtNote = media - (now - p.heardAt) * rate;
      (w.__hearLog ??= []).push({ id: p.id, start: p.start, errorMs: ((songAtNote - p.start) / rate) * 1000, rate, late: p.late });
    }
    this.probes = keep;
  }

  destroy() {
    this.setEnabled(false);
    this.unsub?.();
    if (this.audio.onJump) this.audio.onJump = null;
  }
}
