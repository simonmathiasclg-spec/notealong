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
import type { PlayOptions, Sampler, Voice } from "./sampler";

export type HearNote = { id: string; start: number; end: number; pitch: number } & PlayOptions;

/** A gap shorter than this (song seconds) and the next note runs on from this one. */
const RUNS_ON = 0.05;
/** A gap longer than this starts a new phrase. */
const NEW_PHRASE = 0.3;
/** Legato: a gap shorter than this is not a rest; the note before is held across it. */
const BRIDGE = 0.14;
/** Legato: the same pitch again on a new syllable is parted from the note before by this much, so it is heard twice. */
const PART = 0.028;

/**
 * Phrases the melody the way a player would: which notes run on from the one before (lightly tongued, or
 * slurred when a quick note moves by step inside one word), where phrases start, and how loud each note is.
 * `levels` is how loudly each note was sung (from the service, when the song has a singer); without it the
 * loudness follows the shape of the melody: higher is stronger, phrases swell in the middle.
 * Notes must be sorted by start.
 *
 * `legato` plays the tune the way it is sung (the sax-friendly melody): notes are joined across small gaps,
 * every new syllable is tongued softly so the same pitch twice is heard twice, a second note on one syllable
 * is slurred, and only real rests are silent.
 */
export function phrase(notes: (Omit<HearNote, keyof PlayOptions> & { word?: string | null; syl?: number })[], levels?: Record<string, number> | null,
  opts: { legato?: boolean } = {}): HearNote[] {
  const legato = !!opts.legato;
  const out: HearNote[] = [];
  let first = 0;
  const close = (to: number) => {
    // one phrase is notes[first..to)
    const n = to - first;
    if (n <= 0) return;
    let mean = 0;
    for (let i = first; i < to; i++) mean += notes[i].pitch / n;
    for (let i = first; i < to; i++) {
      const o = out[i];
      const sung = levels?.[o.id];
      if (typeof sung === "number") { o.level = sung; continue; }
      const height = Math.max(-0.16, Math.min(0.16, (o.pitch - mean) * 0.03));
      const arc = n > 2 ? Math.sin((Math.PI * (i - first)) / (n - 1)) * 0.07 : 0;
      const held = o.end - o.start > 0.6 ? 0.03 : 0;
      o.level = Math.round(Math.max(0.4, Math.min(0.95, 0.63 + height + arc + held)) * 1000) / 1000;
    }
  };
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], prev = i > 0 ? notes[i - 1] : null;
    const o: HearNote = { id: n.id, start: n.start, end: n.end, pitch: n.pitch };
    let gap = prev ? n.start - prev.end : Infinity;
    if (legato && prev && gap < BRIDGE) {
      const before = out[i - 1];
      const sameSyllable = !!n.word && n.word === prev.word && (n.syl ?? 0) === (prev.syl ?? 0);
      if (sameSyllable && n.pitch !== prev.pitch) o.attack = "slur";
      else o.attack = "soft";
      o.from = prev.pitch;
      // held right up to this note; the same pitch again is parted by a breath of silence so it speaks twice
      const parted = n.pitch === prev.pitch && before.end - before.start > 0.16;
      before.end = Math.max(before.start + 0.06, n.start - (parted ? PART : 0));
      gap = 0;
    } else if (gap > NEW_PHRASE) { close(i); first = i; o.phrase = true; }
    else if (prev && gap < RUNS_ON) {
      const step = Math.abs(n.pitch - prev.pitch);
      const quick = Math.min(n.end - n.start, prev.end - prev.start) < 0.2;
      const sameWord = !!n.word && n.word === prev.word;
      o.attack = sameWord && quick && step >= 1 && step <= 4 ? "slur" : "soft";
      o.from = prev.pitch;
    }
    out.push(o);
  }
  close(notes.length);
  return out;
}

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
  /** Notes booked but not yet sounding, so they can be moved if the clock is corrected. */
  private booked = new Map<string, HearNote>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private lastT = 0;
  private lastNow = 0;
  private lastRate = 1;
  private running = false;
  private probes: Probe[] = [];
  private unsub: (() => void) | null = null;
  /** Called at the moment each note is heard (for the button's sound waves). */
  onNote: ((seconds: number) => void) | null = null;

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
    this.voices.clear(); this.booked.clear();
    // a note that was stopped before it sounded has nothing to measure
    if (this.probes.length) { const now = this.sampler.ctx.currentTime; this.probes = this.probes.filter((p) => p.heardAt <= now); }
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
      if (all || v.when > now + 0.004) { v.stop(); this.voices.delete(id); this.booked.delete(id); }
    }
    // a note that was dropped before it sounded has nothing to measure
    if (this.probes.length) this.probes = this.probes.filter((p) => p.heardAt <= now + 0.004 && !all);
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
    // just after a start or a jump the audio stands still for a moment: book nothing until it moves,
    // or the first notes would come in early by however long that took
    if (this.audio.settling) { this.running = false; return; }

    if (this.running) {
      const expected = this.lastT + (now - this.lastNow) * this.lastRate;
      if (rate !== this.lastRate || Math.abs(t - expected) > 0.06) {
        // a jump the engine did not announce (stall, tab wake-up) or a new speed
        for (const [id, v] of this.voices) { if (rate !== this.lastRate || v.when > now + 0.004) { v.stop(); this.voices.delete(id); this.booked.delete(id); } }
        this.running = false;
      }
    }
    if (!this.running) { this.next = firstAt(this.notes, t); this.running = true; }
    this.lastT = t; this.lastNow = now; this.lastRate = rate;

    for (const [id, v] of this.voices) if (v.end + 1 < now) { this.voices.delete(id); this.booked.delete(id); }
    const latency = this.latency();
    // A note is booked up to a fifth of a second ahead. If the song's clock has been put right since (the
    // audio often hesitates just after a jump), a note still waiting is moved to where it now belongs.
    for (const [id, n] of this.booked) {
      const v = this.voices.get(id);
      if (!v || v.when <= now + 0.012) { this.booked.delete(id); continue; }
      const when = now + Math.max(0, (n.start - t) / rate - latency);
      if (Math.abs(when - v.when) < 0.012) continue;
      v.stop();
      this.probes = this.probes.filter((p) => p.id !== id);
      const voice = this.sampler.play(id, n.pitch, when, (n.end - n.start) / rate, n);
      if (!voice) { this.voices.delete(id); this.booked.delete(id); continue; }
      this.voices.set(id, voice);
      if ((window as DebugWindow).__hearDebug) this.probes.push({ id, start: n.start, heardAt: voice.when + latency, rate, late: false });
    }

    const { bookings, next } = plan(this.notes, this.next, t, rate, LOOKAHEAD, (id) => this.voices.has(id));
    this.next = next;
    const loopEnd = this.audio.loop ? this.audio.loop[1] : Infinity;
    for (const b of bookings) {
      // inside a loop the song turns back at the loop's end: a note past it will not be reached
      if (b.note.start >= loopEnd) continue;
      // the instrument is heard `latency` after its place on the audio clock; the song position is what is heard now
      const when = now + Math.max(0, b.delay - latency);
      const voice = this.sampler.play(b.note.id, b.note.pitch, when, b.duration, b.delay > 0 ? b.note : { level: b.note.level });
      if (!voice) continue;
      this.voices.set(b.note.id, voice);
      if (b.delay > 0) this.booked.set(b.note.id, b.note);
      if (this.onNote) setTimeout(() => { if (this.voices.get(b.note.id) === voice) this.onNote?.(b.duration); }, Math.max(0, (voice.when + latency - now) * 1000));
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

// Test hook: lets scripts/render-hear-demo.mjs phrase a melody exactly as the player does.
if (typeof window !== "undefined" && (window as Window & { __hearDebug?: boolean }).__hearDebug) {
  (window as unknown as { __NoteAlongPhrase: typeof phrase }).__NoteAlongPhrase = phrase;
}
