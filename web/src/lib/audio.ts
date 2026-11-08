/**
 * Playback engine: two <audio> elements (backing + guide vocal) kept in sync.
 * - Speed uses playbackRate with preservesPitch (native, good quality).
 * - Key changes swap in pitch-shifted renders from the service (rubberband),
 *   keeping the current position.
 * - A short count-in is played with the Web Audio API before starting.
 */
import { SmoothClock } from "./clock";

export type EngineState = {
  playing: boolean;
  loading: boolean;
  countingIn: number | null; // beats remaining during count-in
  ready: boolean;
  error: string | null;
  /** The key shift of the audio that is actually loaded (lags the setting while a new key is prepared). */
  shift: number;
};

type Listener = (s: EngineState) => void;

export class AudioEngine {
  backing: HTMLAudioElement;
  vocals: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private listeners = new Set<Listener>();
  private state: EngineState = { playing: false, loading: true, countingIn: null, ready: false, error: null, shift: 0 };
  private urlFor: (stem: "backing" | "vocals", shift: number) => string;
  private shift = 0;
  private speed = 1;
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  loop: [number, number] | null = null;
  duration = 0;
  /** Called when the song plays through to its end. */
  onEnded: (() => void) | null = null;
  /** Called right after the position jumps (a seek or a loop wrapping round). */
  onJump: (() => void) | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(urlFor: (stem: "backing" | "vocals", shift: number) => string) {
    this.urlFor = urlFor;
    this.backing = new Audio();
    this.vocals = new Audio();
    for (const el of [this.backing, this.vocals]) {
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      (el as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
    }
    this.vocals.volume = 0;
    this.backing.addEventListener("ended", () => { this.setState({ playing: false }); this.onEnded?.(); });
    this.backing.addEventListener("loadedmetadata", () => { this.duration = this.backing.duration; });
    this.backing.addEventListener("waiting", () => this.setState({ loading: true }));
    this.backing.addEventListener("playing", () => this.setState({ loading: false }));
    this.backing.addEventListener("error", () => this.setState({ error: "Could not load the backing track.", loading: false }));
  }

  subscribe(fn: Listener) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  getState() { return this.state; }
  private setState(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  async load(shift = 0) {
    this.shift = shift;
    this.setState({ loading: true, ready: false, error: null });
    await this.swapSources(shift, 0, false);
    this.setState({ loading: false, ready: true, shift });
  }

  private waitCanPlay(el: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (el.readyState >= 3) return resolve();
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error("load failed")); };
      const cleanup = () => { el.removeEventListener("canplay", ok); el.removeEventListener("error", bad); };
      el.addEventListener("canplay", ok); el.addEventListener("error", bad);
    });
  }

  private async swapSources(shift: number, position: number, resume: boolean) {
    this.backing.src = this.urlFor("backing", shift);
    this.vocals.src = this.urlFor("vocals", shift);
    this.backing.load(); this.vocals.load();
    await Promise.all([this.waitCanPlay(this.backing), this.waitCanPlay(this.vocals).catch(() => undefined)]);
    this.backing.currentTime = position;
    this.vocals.currentTime = position;
    this.applyRate();
    if (resume) await this.playNow();
  }

  /** Change the key: loads the shifted render and continues from the same place. */
  async setKeyShift(shift: number) {
    if (shift === this.shift) return;
    const wasPlaying = this.state.playing;
    const pos = this.currentTime;
    this.shift = shift;
    this.backing.pause(); this.vocals.pause();
    this.setState({ loading: true, playing: false });
    try {
      await this.swapSources(shift, pos, wasPlaying);
      if (this.shift !== shift) return; // superseded by a newer change
      this.setState({ loading: false, playing: wasPlaying, error: null, shift });
    } catch {
      this.setState({ loading: false, error: "Could not prepare that key. Try again." });
    }
  }

  setSpeed(speed: number) { this.speed = speed; this.applyRate(); }
  private applyRate() { this.backing.playbackRate = this.speed; this.vocals.playbackRate = this.speed; }
  setBackingVolume(v: number) { this.backing.volume = Math.max(0, Math.min(1, v)); }
  setGuideVolume(v: number) { this.vocals.volume = Math.max(0, Math.min(1, v)); }

  get currentTime() { return this.backing.currentTime; }
  get rate() { return this.speed; }
  private clock = new SmoothClock();
  /** The position for animation and for scheduling sound: the media clock, made steady between its updates. */
  get smoothTime() {
    return this.clock.read(this.backing.currentTime, performance.now(), this.backing.playbackRate, this.state.playing && !this.backing.paused && !this.backing.seeking);
  }
  seek(t: number) {
    t = Math.max(0, Math.min(this.duration || t, t));
    this.backing.currentTime = t;
    this.vocals.currentTime = t;
    this.clock.reset();
    this.onJump?.();
  }

  /** The shared AudioContext (count-in clicks and the sampled instrument). */
  audioContext(): AudioContext {
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    return this.ctx;
  }

  private async playNow() {
    try {
      await Promise.all([this.backing.play(), this.vocals.play().catch(() => undefined)]);
      this.setState({ playing: true, loading: false });
      this.startSync();
    } catch (e) {
      this.setState({ error: (e as Error).message, playing: false });
    }
  }

  /** Play, optionally after a count-in of `beats` beats at `bpm`. */
  async play(countIn?: { beats: number; bpm: number }) {
    if (this.state.countingIn !== null) return;
    if (countIn && countIn.beats > 0) {
      const interval = 60000 / countIn.bpm;
      let remaining = countIn.beats;
      const tick = () => {
        this.click(remaining === countIn.beats);
        this.setState({ countingIn: remaining });
        remaining--;
        if (remaining <= 0) {
          this.countInTimer = setTimeout(() => { this.setState({ countingIn: null }); this.playNow(); }, interval);
        } else {
          this.countInTimer = setTimeout(tick, interval);
        }
      };
      tick();
      return;
    }
    await this.playNow();
  }

  pause() {
    if (this.countInTimer) { clearTimeout(this.countInTimer); this.countInTimer = null; }
    this.backing.pause(); this.vocals.pause();
    this.stopSync();
    this.setState({ playing: false, countingIn: null });
  }

  private click(accent: boolean) {
    try {
      const ctx = this.audioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accent ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.13);
    } catch {}
  }

  private startSync() {
    this.stopSync();
    this.syncTimer = setInterval(() => {
      if (!this.state.playing) return;
      // keep the guide vocal glued to the backing track
      if (Math.abs(this.vocals.currentTime - this.backing.currentTime) > 0.06) this.vocals.currentTime = this.backing.currentTime;
      if (!this.loop) return;
      // Wrap the loop on time: when its end is close, set a timer for the exact moment
      // instead of noticing up to a tenth of a second late.
      const left = (this.loop[1] - this.backing.currentTime) / (this.speed || 1);
      if (left <= 0) this.seek(this.loop[0]);
      else if (left < 0.13 && !this.loopTimer) {
        this.loopTimer = setTimeout(() => {
          this.loopTimer = null;
          if (this.state.playing && this.loop && this.backing.currentTime >= this.loop[1] - 0.03) this.seek(this.loop[0]);
        }, left * 1000);
      }
    }, 50);
  }
  private stopSync() {
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
  }

  destroy() {
    this.pause();
    this.backing.removeAttribute("src"); this.vocals.removeAttribute("src");
    this.backing.load(); this.vocals.load();
    this.ctx?.close().catch(() => undefined);
    this.listeners.clear();
  }
}
