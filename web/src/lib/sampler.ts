/**
 * A small sampled-instrument player for "Hear it played".
 *
 * Each instrument is a handful of recordings of single held notes
 * (public/instruments/<id>/*.flac, built by service/scripts/build_instruments.py).
 * A note is played from the nearest recording, re-pitched by a few semitones
 * at most and corrected for how far out of tune the recording itself is. Wind
 * and string notes loop inside the steady part of the tone for as long as the
 * note lasts; long notes get a slight swell and a vibrato that fades in, the
 * way a player shapes a held note. Nothing is loaded until an instrument is
 * first needed.
 */
export type Zone = { midi: number; tune: number; file: string; loop?: [number, number] };
export type InstrumentDef = {
  name: string;
  source?: string;
  sustain: boolean;
  release: number;
  /** [rate in Hz, depth in cents, seconds before it starts] or null */
  vibrato: [number, number, number] | null;
  tone: number;
  level: number;
  zones: Zone[];
};
export type InstrumentAlias = { name: string; from: string; shift: number };
export type Manifest = { version: number; sample_rate: number; instruments: Record<string, InstrumentDef | InstrumentAlias> };

export type Resolved = { folder: string; def: InstrumentDef; shift: number; name: string };

/** Follows aliases (the baritone sax borrows the tenor's recordings, a fifth lower). */
export function resolveInstrument(manifest: Manifest, id: string): Resolved | null {
  let entry = manifest.instruments[id];
  let folder = id;
  let shift = 0;
  const name = entry?.name ?? id;
  for (let hops = 0; entry && "from" in entry && hops < 3; hops++) {
    shift += entry.shift;
    folder = entry.from;
    entry = manifest.instruments[folder];
  }
  if (!entry || "from" in entry || !entry.zones?.length) return null;
  return { folder, def: entry, shift, name };
}

/** The real pitch of a recording as a fractional MIDI number. */
export function zonePitch(z: Zone): number { return z.midi + z.tune / 100; }

/** The recording closest to the wanted pitch. */
export function pickZone(zones: Zone[], pitch: number): Zone {
  let best = zones[0];
  let bestDist = Infinity;
  for (const z of zones) {
    const d = Math.abs(zonePitch(z) - pitch);
    if (d < bestDist) { best = z; bestDist = d; }
  }
  return best;
}

/** How fast to play a recording so that it sounds at `pitch`. */
export function rateFor(z: Zone, pitch: number): number { return Math.pow(2, (pitch - zonePitch(z)) / 12); }

export type Voice = { id: string; when: number; end: number; stop: (at?: number) => void };

export type SamplerState = "idle" | "loading" | "ready" | "error";

export class Sampler {
  readonly ctx: AudioContext;
  private manifest: Manifest | null = null;
  private manifestPromise: Promise<Manifest> | null = null;
  private buffers = new Map<string, AudioBuffer>();       // "<folder>/<file>"
  private loading = new Map<string, Promise<void>>();     // per folder
  private current: Resolved | null = null;
  private out: GainNode;
  private tone: BiquadFilterNode;
  private volume = 0.8;
  private base: string;

  constructor(ctx: AudioContext, base = "/instruments") {
    this.ctx = ctx;
    this.base = base;
    this.out = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 8000;
    this.tone.Q.value = 0.5;
    // a little room so the instrument sits with the band instead of in front of it
    const dry = ctx.createGain(); dry.gain.value = 0.88;
    const wet = ctx.createGain(); wet.gain.value = 0.2;
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    this.out.connect(this.tone);
    this.tone.connect(dry).connect(ctx.destination);
    this.tone.connect(room).connect(wet).connect(ctx.destination);
    this.applyVolume();
  }

  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  private applyVolume() {
    // perceptual curve: half-way on the slider is clearly quieter, not barely different
    const g = this.volume * this.volume * 1.6 * (this.current?.def.level ?? 1);
    this.out.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  private async getManifest(): Promise<Manifest> {
    this.manifestPromise ??= fetch(`${this.base}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error("Could not load the instrument list.");
      return r.json() as Promise<Manifest>;
    });
    try { this.manifest = await this.manifestPromise; } catch (e) { this.manifestPromise = null; throw e; }
    return this.manifest;
  }

  /** Loads the recordings of one instrument (once) and makes it the one that plays. */
  async use(instrumentId: string): Promise<Resolved> {
    const manifest = await this.getManifest();
    const resolved = resolveInstrument(manifest, instrumentId) ?? resolveInstrument(manifest, "piano");
    if (!resolved) throw new Error("No sound is available for this instrument.");
    let job = this.loading.get(resolved.folder);
    if (!job) {
      job = Promise.all(resolved.def.zones.map(async (z) => {
        const res = await fetch(`${this.base}/${resolved.folder}/${z.file}`);
        if (!res.ok) throw new Error("Could not load the instrument sound.");
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(`${resolved.folder}/${z.file}`, buf);
      })).then(() => undefined);
      this.loading.set(resolved.folder, job);
      job.catch(() => this.loading.delete(resolved.folder));
    }
    await job;
    this.current = resolved;
    this.tone.frequency.setTargetAtTime(resolved.def.tone, this.ctx.currentTime, 0.05);
    this.applyVolume();
    return resolved;
  }

  get ready() { return this.current !== null; }

  /**
   * Plays one note. `pitch` is the sounding (concert) pitch as a MIDI number,
   * `when` the AudioContext time it starts, `duration` how long it is held in real seconds.
   */
  play(id: string, pitch: number, when: number, duration: number): Voice | null {
    const inst = this.current;
    if (!inst) return null;
    const ctx = this.ctx;
    const def = inst.def;
    const zone = pickZone(def.zones, pitch - inst.shift);
    const buffer = this.buffers.get(`${inst.folder}/${zone.file}`);
    if (!buffer) return null;
    const start = Math.max(when, ctx.currentTime);
    const dur = Math.max(0.06, duration);
    const end = start + dur;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // a human never lands on exactly the same pitch and loudness twice
    const rate = rateFor(zone, pitch) * Math.pow(2, (Math.random() * 6 - 3) / 1200);
    src.playbackRate.value = rate;
    if (def.sustain && zone.loop) { src.loop = true; src.loopStart = zone.loop[0]; src.loopEnd = zone.loop[1]; }

    const amp = ctx.createGain();
    const level = 0.9 + Math.random() * 0.1;
    const g = amp.gain;
    g.setValueAtTime(0, start);
    if (def.sustain) {
      const long = dur > 0.55;
      g.linearRampToValueAtTime(level * (long ? 0.86 : 1), start + 0.012);
      // long notes bloom a little after the attack and ease off towards the end
      if (long) {
        g.linearRampToValueAtTime(level, start + Math.min(0.45, dur * 0.4));
        if (dur > 1.6) g.linearRampToValueAtTime(level * 0.9, end);
        else g.setValueAtTime(level, end);
      } else g.setValueAtTime(level, end);
      g.setTargetAtTime(0, end, def.release / 3);
    } else {
      g.linearRampToValueAtTime(level, start + 0.004);
      g.setValueAtTime(level, end);
      g.setTargetAtTime(0, end, def.release / 3);     // the damper
    }
    src.connect(amp).connect(this.out);

    let lfo: OscillatorNode | null = null;
    if (def.sustain && def.vibrato && dur > def.vibrato[2] + 0.35) {
      const [hz, cents, delay] = def.vibrato;
      lfo = ctx.createOscillator();
      lfo.frequency.value = hz * (0.96 + Math.random() * 0.08);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, start);
      depth.gain.setValueAtTime(0, start + delay);
      depth.gain.linearRampToValueAtTime(rate * (Math.pow(2, cents / 1200) - 1), start + delay + 0.5);
      lfo.connect(depth).connect(src.playbackRate);
      lfo.start(start + delay);
    }

    const tail = def.release * 2 + 0.05;
    src.start(start);
    src.stop(end + tail);
    lfo?.stop(end + tail);
    let stopped = false;
    src.onended = () => { try { amp.disconnect(); } catch {} };
    return {
      id, when: start, end,
      stop: (at?: number) => {
        if (stopped) return;
        stopped = true;
        const t = Math.max(at ?? ctx.currentTime, ctx.currentTime);
        try {
          g.cancelScheduledValues(t);
          g.setTargetAtTime(0, t, 0.012);
          src.stop(t + 0.08);
          lfo?.stop(t + 0.08);
        } catch {}
      },
    };
  }
}

/** A short, soft room: decaying noise, darker towards the end, different in each ear. */
function roomImpulse(ctx: AudioContext, seconds = 1.3): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const white = Math.random() * 2 - 1;
      const k = 0.55 - 0.4 * t;           // the filter closes as the room dies away
      lp += k * (white - lp);
      d[i] = lp * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1);
    }
  }
  return buf;
}

// Test hook: lets scripts/render-hear-demo.mjs render the real sampler offline (see docs/listening-samples).
if (typeof window !== "undefined" && (window as Window & { __hearDebug?: boolean }).__hearDebug) {
  (window as unknown as { __NoteAlongSampler: typeof Sampler }).__NoteAlongSampler = Sampler;
}
