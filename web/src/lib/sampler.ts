/**
 * The sampled-instrument player for "Hear it played".
 *
 * Each instrument is a set of recordings of single held notes
 * (public/instruments/<id>/*.flac, built by service/scripts/build_instruments.py).
 * A note is played from the nearest recording, re-pitched by a few semitones
 * at most and corrected for how far out of tune the recording itself is. Wind
 * and string notes loop inside the steady part of the tone for as long as the
 * note lasts.
 *
 * Richer instruments (the alto sax) have every semitone recorded soft and
 * loud, twice each: the loudness of a note picks the recording, and a repeated
 * note alternates between the two takes so it never sounds stamped out. Only
 * the notes a song needs are downloaded.
 *
 * On top of the recordings the player phrases like a musician (`expression`):
 * loudness and brightness follow each note's level, notes that run on from the
 * one before are tongued softly or slurred with no new attack, some phrase
 * starts are scooped up from just below the pitch, and long notes bloom and
 * grow a vibrato after a moment. Turn `expression` off to hear the bare
 * recordings.
 */
export type Zone = { midi: number; tune: number; file: string; loop?: [number, number]; /** 0 = soft, 1 = loud */ layer?: number; /** which take */ rr?: number };
export type InstrumentDef = {
  name: string;
  source?: string;
  sustain: boolean;
  release: number;
  /** [rate in Hz, depth in cents, seconds before it starts] or null */
  vibrato: [number, number, number] | null;
  tone: number;
  level: number;
  /** how many loudness layers the recordings have (absent = 1) */
  layers?: number;
  zones: Zone[];
};
export type InstrumentAlias = { name: string; from: string; shift: number };
export type Manifest = { version: number; sample_rate: number; instruments: Record<string, InstrumentDef | InstrumentAlias> };

export type Resolved = { folder: string; def: InstrumentDef; shift: number; name: string };

/** How a note is played. Everything is optional: a bare note is tongued at a medium level. */
export type PlayOptions = {
  /** loudness, 0 (very soft) to 1 (full); about 0.7 is a comfortable medium */
  level?: number;
  /** "soft": runs on from the note before, lightly tongued. "slur": no new attack at all. */
  attack?: "soft" | "slur";
  /** the sounding pitch of the note before, for the little slide of a slur */
  from?: number;
  /** the first note of a phrase (may be scooped) */
  phrase?: boolean;
};

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

/**
 * The recording to play for a pitch: the closest in pitch, and among those the wanted loudness layer and
 * take. A recording of the right note in the other layer beats the right layer a semitone away.
 * `has` leaves out recordings that are not loaded yet.
 */
export function pickZone(zones: Zone[], pitch: number, want?: { layer?: number; rr?: number }, has?: (z: Zone) => boolean): Zone {
  let best = zones[0];
  let bestCost = Infinity;
  for (const z of zones) {
    if (has && !has(z)) continue;
    let cost = Math.abs(zonePitch(z) - pitch);
    if (want?.layer !== undefined && z.layer !== undefined && z.layer !== want.layer) cost += 0.4;
    if (want?.rr !== undefined && z.rr !== undefined && z.rr !== want.rr) cost += 0.1;
    if (cost < bestCost) { best = z; bestCost = cost; }
  }
  return best;
}

/** The recordings a set of pitches needs: for each pitch, the nearest one in every layer and take. */
export function zonesFor(zones: Zone[], pitches: Iterable<number>): Zone[] {
  const kinds = new Map<string, { layer?: number; rr?: number }>();
  for (const z of zones) kinds.set(`${z.layer}/${z.rr}`, { layer: z.layer, rr: z.rr });
  const out = new Set<Zone>();
  for (const p of pitches) for (const k of kinds.values()) out.add(pickZone(zones, p, k, (z) => z.layer === k.layer && z.rr === k.rr));
  return [...out];
}

/** How fast to play a recording so that it sounds at `pitch`. */
export function rateFor(z: Zone, pitch: number): number { return Math.pow(2, (pitch - zonePitch(z)) / 12); }

/** Below this level a note is played from the soft recordings. */
export const SOFT_BELOW = 0.52;
/** Gain for a level: medium (0.7) is unchanged, full is about 5 dB up, very soft about 12 dB down. */
export function gainFor(level: number): number { return Math.pow(10, ((level - 0.7) * 18) / 20); }
/** A number in 0..1 that is always the same for the same note (so a looped line is phrased the same way each time). */
export function chance(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export type Voice = { id: string; when: number; end: number; stop: (at?: number) => void };

export type SamplerState = "idle" | "loading" | "ready" | "error";

/** Instruments with more recordings than this are loaded note by note, as songs need them. */
const LOAD_ALL_UP_TO = 24;
/** A slurred note starts this far into the recording, past the tongued attack (seconds). */
const PAST_ATTACK = 0.14;

export class Sampler {
  readonly ctx: AudioContext;
  /** Phrasing on top of the recordings (see the top of this file). Off: every note is tongued at one level. */
  expression = true;
  private manifest: Manifest | null = null;
  private manifestPromise: Promise<Manifest> | null = null;
  private buffers = new Map<string, AudioBuffer>();       // "<folder>/<file>"
  private loading = new Map<string, Promise<void>>();     // per file
  private current: Resolved | null = null;
  private takes = 1;
  private turn = new Map<number, number>();               // pitch -> which take comes next
  private out: GainNode;
  private tone: BiquadFilterNode;
  private air: AudioBuffer | null = null;
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

  private load(folder: string, z: Zone): Promise<void> {
    const key = `${folder}/${z.file}`;
    let job = this.loading.get(key);
    if (!job) {
      job = (async () => {
        const res = await fetch(`${this.base}/${key}`);
        if (!res.ok) throw new Error("Could not load the instrument sound.");
        this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      })();
      this.loading.set(key, job);
      job.catch(() => this.loading.delete(key));
    }
    return job;
  }

  /**
   * Loads what `pitches` (sounding MIDI numbers) need. Resolves when one take of every note is there, which
   * is enough to play; the other takes follow in the background. Small instruments are loaded whole.
   */
  private async fetchFor(inst: Resolved, pitches?: Iterable<number>): Promise<void> {
    const all = inst.def.zones;
    let need = all;
    if (pitches && all.length > LOAD_ALL_UP_TO) need = zonesFor(all, [...pitches].map((p) => p - inst.shift));
    const first = need.filter((z) => !z.rr);
    const later = need.filter((z) => z.rr);
    await Promise.all(first.map((z) => this.load(inst.folder, z)));
    void Promise.all(later.map((z) => this.load(inst.folder, z))).catch(() => undefined);
  }

  /**
   * Makes an instrument the one that plays, loading its recordings first (once). With `pitches`, a large
   * instrument loads only the notes those pitches need.
   */
  async use(instrumentId: string, pitches?: Iterable<number>): Promise<Resolved> {
    const manifest = await this.getManifest();
    const resolved = resolveInstrument(manifest, instrumentId) ?? resolveInstrument(manifest, "piano");
    if (!resolved) throw new Error("No sound is available for this instrument.");
    await this.fetchFor(resolved, pitches);
    this.current = resolved;
    this.takes = 1 + Math.max(0, ...resolved.def.zones.map((z) => z.rr ?? 0));
    this.turn.clear();
    this.tone.frequency.setTargetAtTime(resolved.def.tone, this.ctx.currentTime, 0.05);
    this.applyVolume();
    return resolved;
  }

  /** The notes changed (a new key, an edit): fetch any recordings they need. Notes play from the nearest one meanwhile. */
  prepare(pitches: Iterable<number>): Promise<void> {
    return this.current ? this.fetchFor(this.current, pitches).catch(() => undefined) : Promise.resolve();
  }

  get ready() { return this.current !== null; }

  /** One second of breath: noise shaped like air through a mouthpiece, shared by every note. */
  private breath(): AudioBuffer {
    if (this.air) return this.air;
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let lp = 0, hp = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      lp += 0.45 * (white - lp);                 // roll off the top
      hp = 0.93 * (hp + lp - prev); prev = lp;   // and the bottom
      d[i] = hp;
    }
    this.air = buf;
    return buf;
  }

  /**
   * Plays one note. `pitch` is the sounding (concert) pitch as a MIDI number,
   * `when` the AudioContext time it starts, `duration` how long it is held in real seconds.
   */
  play(id: string, pitch: number, when: number, duration: number, how: PlayOptions = {}): Voice | null {
    const inst = this.current;
    if (!inst) return null;
    const ctx = this.ctx;
    const def = inst.def;
    const expressive = this.expression && def.sustain;
    const lvl = expressive ? Math.max(0, Math.min(1, how.level ?? 0.7)) : 0.7;
    const attack = expressive ? how.attack : undefined;
    const layers = def.layers ?? 1;
    const key = Math.round(pitch);
    const take = this.turn.get(key) ?? 0;
    if (this.takes > 1) this.turn.set(key, (take + 1) % this.takes);
    const zone = pickZone(def.zones, pitch - inst.shift, { layer: layers > 1 ? (lvl < SOFT_BELOW ? 0 : layers - 1) : undefined, rr: take },
      (z) => this.buffers.has(`${inst.folder}/${z.file}`));
    const buffer = this.buffers.get(`${inst.folder}/${zone.file}`);
    if (!buffer) return null;
    const start = Math.max(when, ctx.currentTime);
    const dur = Math.max(0.06, duration);
    const end = start + dur;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // a human never lands on exactly the same pitch and loudness twice
    const rate = rateFor(zone, pitch) * Math.pow(2, (Math.random() * 6 - 3) / 1200);
    const pr = src.playbackRate;
    pr.value = rate;
    if (def.sustain && zone.loop) { src.loop = true; src.loopStart = zone.loop[0]; src.loopEnd = zone.loop[1]; }

    const amp = ctx.createGain();
    const level = (0.9 + Math.random() * 0.1) * (expressive ? gainFor(lvl) : 1);
    const g = amp.gain;
    const nodes: AudioNode[] = [amp];
    let offset = 0;
    g.setValueAtTime(0, start);
    if (def.sustain) {
      const long = dur > 0.55;
      const first = level * (long ? 0.86 : 1);
      if (attack === "slur") {
        // no tongue: come in past the recorded attack, under the end of the note before, sliding a little from its pitch
        offset = Math.min(PAST_ATTACK, (zone.loop?.[0] ?? buffer.duration) * 0.5);
        g.linearRampToValueAtTime(first, start + 0.04);
        if (how.from !== undefined && how.from !== pitch) {
          const slide = Math.max(-0.6, Math.min(0.6, (how.from - pitch) * 0.3));
          pr.setValueAtTime(rate * Math.pow(2, slide / 12), start);
          pr.exponentialRampToValueAtTime(rate, start + 0.045);
        }
      } else if (attack === "soft") {
        // a light tongue: most of the attack's bite is skipped
        offset = 0.03;
        g.linearRampToValueAtTime(first, start + 0.022);
      } else {
        // softer notes are started more gently
        g.linearRampToValueAtTime(first, start + (expressive ? 0.008 + (1 - lvl) * 0.02 : 0.012));
        // now and then a phrase starts from just under the note, as players do
        if (expressive && dur > 0.3 && chance(id) < (how.phrase ? 0.5 : 0.12)) {
          const cents = 22 + chance(id, 1) * 26;
          pr.setValueAtTime(rate * Math.pow(2, -cents / 1200), start);
          pr.linearRampToValueAtTime(rate, start + 0.06 + chance(id, 2) * 0.04);
        }
      }
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
    if (expressive) {
      // a soft note is darker than a loud one; high notes keep their overtones
      const colour = ctx.createBiquadFilter();
      colour.type = "lowpass";
      colour.Q.value = 0.4;
      const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
      colour.frequency.value = Math.min(16000, Math.max(1700 * Math.pow(2, lvl * 2.7), f0 * 5));
      src.connect(colour).connect(amp);
      nodes.push(colour);
    } else src.connect(amp);
    amp.connect(this.out);

    let lfo: OscillatorNode | null = null;
    if (def.sustain && def.vibrato && dur > def.vibrato[2] + 0.35) {
      const [hz, cents, delay] = def.vibrato;
      lfo = ctx.createOscillator();
      lfo.frequency.value = hz * (0.96 + Math.random() * 0.08);
      const depth = ctx.createGain();
      const much = expressive ? (0.75 + Math.random() * 0.35) * (0.8 + lvl * 0.3) : 1;
      depth.gain.setValueAtTime(0, start);
      depth.gain.setValueAtTime(0, start + delay);
      // the vibrato grows in slowly, and more slowly on a longer note
      const grow = Math.min(1.1, Math.max(0.5, (dur - delay) * 0.5));
      depth.gain.linearRampToValueAtTime(rate * (Math.pow(2, (cents * much) / 1200) - 1), start + delay + grow);
      lfo.connect(depth).connect(pr);
      if (expressive) {
        // the loudness breathes with the pitch, a little
        const swell = ctx.createGain();
        swell.gain.setValueAtTime(0, start);
        swell.gain.setValueAtTime(0, start + delay);
        swell.gain.linearRampToValueAtTime(level * 0.05 * much, start + delay + grow);
        lfo.connect(swell).connect(g);
        nodes.push(swell);
      }
      nodes.push(depth);
      lfo.start(start + delay);
    }

    let wind: AudioBufferSourceNode | null = null;
    if (expressive && attack !== "slur") {
      // the puff of air that starts a tongued note
      wind = ctx.createBufferSource();
      wind.buffer = this.breath();
      wind.loop = true;
      const puff = ctx.createGain();
      const peak = level * (attack === "soft" ? 0.02 : 0.045);
      puff.gain.setValueAtTime(0, start);
      puff.gain.linearRampToValueAtTime(peak, start + 0.012);
      puff.gain.setTargetAtTime(0, start + 0.02, 0.03);
      wind.connect(puff).connect(this.out);
      nodes.push(puff);
      wind.start(start, Math.random());
      wind.stop(start + 0.25);
    }

    const tail = def.release * 2 + 0.05;
    src.start(start, offset);
    src.stop(end + tail);
    lfo?.stop(end + tail);
    let stopped = false;
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch {} } };
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
          wind?.stop(t + 0.02);
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
