/**
 * Sheet music: turns the song's notes (real times in seconds) into written rhythm.
 *
 * The service supplies the beat grid (`ScoreData`: where every beat and bar line falls, the metre and the
 * chords). Here each note is moved onto that grid and cut into bars and into values a reader expects to see:
 * nothing is written across the middle of a 4/4 bar, rests sit on beats, a note held over a bar line is tied.
 *
 * Time is counted in ticks, 24 to a quarter note, with tick 0 on the first bar line. The Letters view and
 * playback keep using the notes' real times: nothing here changes the song.
 */
import type { Note, Word } from "./types";

/** Ticks per quarter note: divides into 32nds (3), 16ths (6), triplet 8ths (8) and triplet 16ths (4). */
export const TPQ = 24;

export type ChordSpan = { start: number; end: number; root: number | null; quality: string; bass?: number | null };

/** What GET /api/songs/{id}/score returns (service/notealong/pipeline/score.py). */
export type ScoreData = {
  version: number;
  /** authored: the song was written by hand, so its rhythm is exact. detected: found by listening. none: no grid, tempo only. */
  source: "authored" | "detected" | "none";
  meter: [number, number];
  /** Beats per minute, a beat being one 1/meter[1] note. */
  tempo: number;
  /** Time in seconds of every beat. */
  beats: number[];
  /** Index in `beats` of the first bar line. */
  downbeat: number;
  first_bar?: number | null;
  chords: ChordSpan[];
  /** Authored songs: the syllable sung on each note ("cu-" when the word goes on). */
  syllables: Record<string, string>;
};

/** When the service has no score (cloud mode, or it failed): a plain 4/4 grid at the song's tempo. */
export function fallbackScore(tempoBpm: number | null | undefined, duration: number): ScoreData {
  const bpm = tempoBpm && tempoBpm > 0 ? tempoBpm : 100;
  const step = 60 / bpm;
  const beats: number[] = [];
  for (let i = 0; i * step <= duration + step; i++) beats.push(Math.round(i * step * 10000) / 10000);
  return { version: 0, source: "none", meter: [4, 4], tempo: bpm, beats, downbeat: 0, chords: [], syllables: {} };
}

export type Grid = {
  n: number; d: number;
  beatTicks: number; barTicks: number;
  /** 6/8, 9/8, 12/8: beats group in threes. */
  compound: boolean;
  /** Song seconds to ticks (not rounded). */
  pos: (seconds: number) => number;
  /** Ticks to song seconds. */
  time: (tick: number) => number;
};

export function makeGrid(score: ScoreData): Grid {
  const [n, d] = score.meter;
  const beatTicks = (TPQ * 4) / d;
  let b = score.beats;
  if (b.length < 2) { const step = 60 / (score.tempo > 0 ? score.tempo : 100); b = [0, step]; }
  const last = b.length - 1;
  const index = (t: number) => {
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[last]) return last + (t - b[last]) / (b[last] - b[last - 1]);
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  };
  return {
    n, d, beatTicks, barTicks: n * beatTicks, compound: d === 8 && n % 3 === 0 && n > 3,
    pos: (t) => (index(t) - score.downbeat) * beatTicks,
    time: (tick) => {
      const x = tick / beatTicks + score.downbeat;
      const i = Math.max(0, Math.min(last - 1, Math.floor(x)));
      return b[i] + (x - i) * (b[i + 1] - b[i]);
    },
  };
}

/** A note on the grid. `ids` are the song's notes it stands for (two that fell on the same place become one). */
export type QNote = { id: string; ids: string[]; start: number; end: number; midi: number };

/** Nearest 8th; a 16th only when the note is clearly nearer to it (plain rhythms read best). */
function snapLoose(x: number): number {
  const eighth = Math.round(x / 12) * 12, sixteenth = Math.round(x / 6) * 6;
  return Math.abs(x - sixteenth) + 2 < Math.abs(x - eighth) ? sixteenth : eighth;
}
/** Nearest place a hand-written rhythm can have: a 32nd, or a third of the beat. */
function snapExact(x: number, span: number): number {
  const base = Math.floor(x / span) * span, off = x - base;
  let best = Math.round(off / 3) * 3;
  for (const c of [span / 3, (2 * span) / 3]) if (Math.abs(off - c) < Math.abs(off - best)) best = c;
  return base + best;
}
function snapThirds(x: number, span: number): number {
  return Math.round(x / (span / 3)) * (span / 3);
}

/**
 * Puts the notes on the grid. A hand-written song lands exactly where it was written. A song found by
 * listening is rounded to 8ths, to 16ths where that is clearly meant, and to triplets where a beat is
 * plainly split in three; notes too close to tell apart become one; short gaps are closed so the line is
 * not littered with tiny rests.
 */
export function quantize(notes: Note[], score: ScoreData, grid: Grid): QNote[] {
  const span = grid.d === 8 ? 12 : 24;
  const raw = [...notes].sort((a, b) => a.start - b.start).map((n) => ({ n, s: grid.pos(n.start), e: grid.pos(n.end) }));
  const authored = score.source === "authored";

  const triplets = new Set<number>();
  if (!authored && grid.d === 4) {
    const byBeat = new Map<number, number[]>();
    for (const r of raw) { const k = Math.floor((r.s + 2) / 24); byBeat.set(k, [...(byBeat.get(k) ?? []), r.s - 24 * k]); }
    for (const [k, offs] of byBeat) {
      const near = (c: number, by: number) => offs.some((o) => Math.abs(o - c) <= by);
      if (near(8, 2) && near(16, 2) && !near(12, 1.5)) triplets.add(k);
    }
  }
  const loose = (x: number) => (triplets.has(Math.floor((x + 2) / 24)) ? snapThirds(x, 24) : snapLoose(x));

  const out: (QNote & { strict: boolean; rawS: number; rawLen: number })[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const strict = authored && !r.n.edited;
    let s = strict ? snapExact(r.s, span) : loose(r.s);
    let e = strict ? snapExact(r.e, span) : loose(r.e);
    // a long note ends on a beat
    if (!strict && e - s >= 36 && !triplets.has(Math.floor((r.e + 2) / 24))) e = Math.max(s + 24, Math.round(r.e / 24) * 24);
    const prev = out[out.length - 1];
    if (prev && s <= prev.start) {
      const nextS = raw[i + 1]?.s ?? Infinity;
      if (!strict && r.s - prev.rawS > 3 && prev.start + 6 <= nextS - 3) s = prev.start + 6;
      else {
        prev.ids.push(r.n.id);
        if (r.e - r.s > prev.rawLen) { prev.midi = r.n.midi; prev.rawLen = r.e - r.s; }
        prev.end = Math.max(prev.end, e);
        continue;
      }
    }
    if (e <= s) e = s + (strict ? 3 : 6);
    if (prev && prev.end > s) prev.end = s;
    out.push({ id: r.n.id, ids: [r.n.id], start: s, end: e, midi: r.n.midi, strict, rawS: r.s, rawLen: r.e - r.s });
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const q = out[i], gap = out[i + 1].start - q.end;
    if (!q.strict && gap > 0 && gap <= 12) q.end = out[i + 1].start;
    // no 16th rest after a note: it is held to the next 8th
    else if (!q.strict && gap > 12 && q.end % 12 === 6) q.end += 6;
  }
  const lastNote = out[out.length - 1];
  if (lastNote && !lastNote.strict && lastNote.end % 12 === 6) lastNote.end += 6;

  // A beat with a triplet in it is written in thirds throughout.
  const marked = new Set<number>();
  const inside = (t: number) => { const k = Math.floor(t / span); if ((t - k * span) % 3 !== 0) marked.add(k); };
  for (const q of out) { inside(q.start); inside(q.end); }
  if (marked.size) {
    const fix = (t: number) => (marked.has(Math.floor(t / span)) && t % span !== 0 ? snapThirds(t, span) : t);
    for (const q of out) { q.start = fix(q.start); q.end = fix(q.end); }
    for (let i = 0; i < out.length; i++) {
      const q = out[i], next = out[i + 1];
      if (q.end <= q.start) q.end = q.start + span / 3;
      if (next && next.start < q.end) {
        if (next.start > q.start) q.end = next.start;
        else { next.ids.unshift(...q.ids); next.start = q.start; out.splice(i, 1); i--; }
      }
    }
  }
  return out.map(({ id, ids, start, end, midi }) => ({ id, ids, start, end, midi }));
}

export type Chord = { root: number; quality: string; bass: number | null };
export type Lyric = { text: string; syllabic: "single" | "begin" | "middle" | "end" };

/** One written note or rest. `start` counts from the bar line of its bar. */
export type Piece = {
  start: number; dur: number; rest: boolean;
  /** A rest that fills its bar. */
  whole?: boolean;
  id?: string; ids?: string[]; midi?: number;
  tieStart?: boolean; tieStop?: boolean;
  /** Part of a triplet: where in the group it stands. */
  tuplet?: "start" | "mid" | "stop";
  lyric?: Lyric;
  chord?: Chord;
};
export type Measure = {
  /** Tick of this bar's first written beat (a pickup bar starts part way through). */
  start: number;
  /** Tick of the bar line before it. */
  bar: number;
  len: number;
  pickup: boolean;
  pieces: Piece[];
};
export type Sheet = {
  meter: [number, number];
  tempo: number;
  source: ScoreData["source"];
  /** Whole bars of music before the first written bar. */
  introBars: number;
  measures: Measure[];
  grid: Grid;
};

const NOTE_LENGTHS = new Set([3, 6, 12, 18, 24, 36, 48, 72, 96]);

/** May a note of this length start here? `s` counts from the bar line. */
function noteFits(s: number, len: number, g: Grid): boolean {
  if (!NOTE_LENGTHS.has(len)) return false;
  if (len === 3) return true;
  if (s % 6 === 3) return false;
  if (g.compound) {
    const at = s % 36;
    if (at === 0) return len <= 36 || (len === 72 && s % 72 === 0);
    if (at === 12) return len === 6 || len === 12 || len === 24;
    if (at === 24) return len === 6 || len === 12;
    return len === 6;
  }
  if (s % 12 === 6) return len === 6 || ((len === 12 || len === 18) && s % 24 === 6);
  if (s % 24 === 12) return len <= 12 || (len === 24 && !(g.n === 4 && s % 48 === 36));
  if (g.n !== 4 || g.d !== 4) return true;
  // 4/4: the middle of the bar stays visible
  return len <= 24 || s % 48 === 0 || (s === 24 && (len === 48 || len === 72));
}
function restFits(s: number, len: number, g: Grid): boolean {
  if (g.compound) return ((len === 3 || len === 6 || len === 12) && s % len === 0) || ((len === 24 || len === 36) && s % 36 === 0);
  if (len === 48) return g.n === 4 && g.d === 4 && s % 48 === 0;
  return (len === 3 || len === 6 || len === 12 || len === 24) && s % len === 0;
}
/** Cuts [s, e) into values that may be written, splitting at the strongest beat inside first. */
function cut(s: number, e: number, rest: boolean, g: Grid): [number, number][] {
  if ((rest ? restFits : noteFits)(s, e - s, g)) return [[s, e]];
  const levels = g.compound ? [72, 36, 12, 6, 3] : g.n === 4 && g.d === 4 ? [48, 24, 12, 6, 3] : [24, 12, 6, 3];
  for (const level of levels) {
    const b = (Math.floor(s / level) + 1) * level;
    if (b < e) return [...cut(s, b, rest, g), ...cut(b, e, rest, g)];
  }
  return [[s, e]];
}

/** Chord changes as ticks on the beat, repeats removed. */
function chordChanges(score: ScoreData, grid: Grid): { tick: number; chord: Chord | null }[] {
  const out: { tick: number; chord: Chord | null }[] = [];
  for (const c of score.chords) {
    const tick = Math.round(grid.pos(c.start) / grid.beatTicks) * grid.beatTicks;
    const chord = c.root === null || c.root === undefined ? null : { root: c.root, quality: c.quality ?? "", bass: c.bass ?? null };
    const last = out[out.length - 1];
    if (last && last.tick === tick) { last.chord = chord; continue; }
    if (last && JSON.stringify(last.chord) === JSON.stringify(chord)) continue;
    out.push({ tick, chord });
  }
  return out;
}

/**
 * The written music: bars of notes and rests, with lyrics and chords attached. Starts at the first bar that
 * has melody in it (a part bar when the tune starts with a pickup).
 */
export function buildSheet(song: { notes: Note[]; words: Word[] }, score: ScoreData, wordText?: (w: Word) => string): Sheet {
  const grid = makeGrid(score);
  const q = quantize(song.notes, score, grid);
  const sheet: Sheet = { meter: score.meter, tempo: score.tempo, source: score.source, introBars: 0, measures: [], grid };
  if (!q.length) return sheet;
  const { barTicks, beatTicks } = grid;
  const span = grid.d === 8 ? 12 : 24;

  // lyrics: the syllable on each note (hand-written songs), or the word on its first note
  const lyricOf = new Map<string, Lyric>();
  const byId = new Map(song.notes.map((n) => [n.id, n]));
  const words = new Map(song.words.map((w) => [w.id, w]));
  const text = wordText ?? ((w: Word) => w.text);
  const hasSyllables = Object.keys(score.syllables ?? {}).length > 0;
  // a word whose text was edited no longer matches its syllables: its notes fall back to the word itself
  const changed = new Set<string>();
  if (hasSyllables) {
    const sung = new Map<string, string>();
    const wordOf = (n: QNote) => n.ids.map((id) => byId.get(id)?.word).find((w) => !!w) ?? null;
    for (const n of q) { const w = wordOf(n); if (w) sung.set(w, (sung.get(w) ?? "") + n.ids.map((id) => score.syllables[id] ?? "").join("").replace(/-$/, "")); }
    for (const n of q) {
      const w = wordOf(n);
      if (n.ids.some((id) => byId.get(id)?.edited && !(id in score.syllables)) || (w && words.get(w) && sung.get(w) !== words.get(w)!.text)) changed.add(n.id);
    }
  }
  let going = false, lastWord: string | null = null;
  for (const n of q) {
    const syl = changed.has(n.id) ? undefined : n.ids.map((id) => score.syllables?.[id]).find((s) => typeof s === "string" && s.length > 0);
    if (syl !== undefined) {
      const goesOn = syl.endsWith("-") && syl.length > 1;
      lyricOf.set(n.id, { text: goesOn ? syl.slice(0, -1) : syl, syllabic: going ? (goesOn ? "middle" : "end") : goesOn ? "begin" : "single" });
      going = goesOn;
      continue;
    }
    if (hasSyllables && !changed.has(n.id)) continue;       // a note held under the syllable before it
    const wid = n.ids.map((id) => byId.get(id)?.word).find((w) => !!w) ?? null;
    if (wid && wid !== lastWord) { const w = words.get(wid); if (w && text(w)) lyricOf.set(n.id, { text: text(w), syllabic: "single" }); }
    if (wid) lastWord = wid;
  }

  const firstBar = Math.floor(q[0].start / barTicks);
  const lead = q[0].start - firstBar * barTicks;
  const pickupFrom = lead >= beatTicks ? Math.floor(lead / beatTicks) * beatTicks : 0;
  sheet.introBars = Math.max(0, firstBar);
  const lastBar = Math.floor((q[q.length - 1].end - 1) / barTicks);
  const changes = chordChanges(score, grid);
  let ci = 0, current: Chord | null = null, shown: Chord | null = null;
  let qi = 0;
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const b0 = bar * barTicks;
    const from = bar === firstBar ? pickupFrom : 0;
    // what sounds in this bar, bar-relative: notes with the gaps between them as rests
    type Ev = { s: number; e: number; note: QNote | null; first: boolean; last: boolean };
    const evs: Ev[] = [];
    let at = from;
    while (qi < q.length && q[qi].start < b0 + barTicks) {
      const n = q[qi];
      const s = Math.max(from, n.start - b0), e = Math.min(barTicks, n.end - b0);
      if (s > at) evs.push({ s: at, e: s, note: null, first: true, last: true });
      evs.push({ s, e, note: n, first: n.start >= b0 + from, last: n.end <= b0 + barTicks });
      at = e;
      if (n.end > b0 + barTicks) break;
      qi++;
    }
    if (at < barTicks) evs.push({ s: at, e: barTicks, note: null, first: true, last: true });

    // chord changes in this bar
    while (ci < changes.length && changes[ci].tick <= b0 + from) current = changes[ci++].chord;
    const here: { s: number; chord: Chord | null }[] = [];
    if (current && JSON.stringify(current) !== JSON.stringify(shown)) here.push({ s: from, chord: current });
    while (ci < changes.length && changes[ci].tick < b0 + barTicks) { current = changes[ci].chord; here.push({ s: changes[ci].tick - b0, chord: current }); ci++; }

    const pieces: Piece[] = [];
    if (evs.length === 1 && !evs[0].note && from === 0 && here.every((h) => h.s === 0)) {
      pieces.push({ start: 0, dur: barTicks, rest: true, whole: true });
    } else {
      // beats written in thirds
      const thirds = new Set<number>();
      for (const ev of evs) for (const t of [ev.s, ev.e]) if (t % 3 !== 0) thirds.add(Math.floor(t / span));
      for (const ev of evs) {
        // cut at chord changes and at the edges of triplet beats, then into writable values
        const cuts = new Set<number>([ev.s, ev.e]);
        for (const h of here) if (h.s > ev.s && h.s < ev.e) cuts.add(h.s);
        for (const k of thirds) for (const t of [k * span, (k + 1) * span]) if (t > ev.s && t < ev.e) cuts.add(t);
        const edges = [...cuts].sort((a, b) => a - b);
        const parts: [number, number, boolean][] = [];
        for (let i = 0; i + 1 < edges.length; i++) {
          const [s, e] = [edges[i], edges[i + 1]];
          const k = Math.floor(s / span);
          if (thirds.has(k) && e <= (k + 1) * span && e - s < span) parts.push([s, e, true]);
          else for (const [a, b] of cut(s, e, !ev.note, grid)) parts.push([a, b, false]);
        }
        parts.forEach(([s, e, third], i) => {
          const p: Piece = { start: s, dur: e - s, rest: !ev.note };
          if (third) { const k = Math.floor(s / span); p.tuplet = s === k * span ? "start" : e === (k + 1) * span ? "stop" : "mid"; }
          if (ev.note) {
            p.id = ev.note.id; p.ids = ev.note.ids; p.midi = ev.note.midi;
            if (i > 0 || !ev.first) p.tieStop = true;
            if (i < parts.length - 1 || !ev.last) p.tieStart = true;
            if (i === 0 && ev.first) p.lyric = lyricOf.get(ev.note.id);
          }
          pieces.push(p);
        });
      }
    }
    for (const h of here) {
      const p = pieces.find((x) => x.start >= h.s) ?? pieces[pieces.length - 1];
      if (h.chord) { p.chord = h.chord; shown = h.chord; }
    }
    sheet.measures.push({ start: b0 + from, bar: b0, len: barTicks - from, pickup: from > 0, pieces });
  }
  return sheet;
}

// ---- names ----

const LETTERS = ["F", "C", "G", "D", "A", "E", "B"];
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export type Spelled = { step: string; alter: number };
export type Spelling = { fifths: number; mode: "major" | "minor"; of: (pc: number) => Spelled; tonic: Spelled };

/** Sharps (positive) or flats (negative) in the key signature. */
export function keyFifths(tonic: number, mode: "major" | "minor"): number {
  const pc = ((tonic % 12) + 12) % 12;
  return FIFTHS[mode === "minor" ? (pc + 3) % 12 : pc];
}

/**
 * How each of the twelve notes is written in a key: the notes of the key as the key signature has them,
 * the rest as the usual raised or lowered neighbours (F sharp in C, B flat in C, G sharp in A minor).
 */
export function spelling(tonic: number | null | undefined, mode: "major" | "minor" = "major"): Spelling {
  const fifths = tonic === null || tonic === undefined ? 0 : keyFifths(tonic, mode);
  // the line of fifths: F flat (0), C flat, G flat ... F (7), C (8), G ... ; twelve in a row around the key
  const table = new Map<number, Spelled>();
  const name = (j: number): Spelled => ({ step: LETTERS[((j % 7) + 7) % 7], alter: Math.floor(j / 7) - 1 });
  for (let j = 8 + fifths - 3; j <= 8 + fifths + 8; j++) { const s = name(j); table.set((((NATURAL[s.step] + s.alter) % 12) + 12) % 12, s); }
  return { fifths, mode, of: (pc) => table.get(((pc % 12) + 12) % 12)!, tonic: name(8 + fifths + (mode === "minor" ? 3 : 0)) };
}

export function pitchOf(midi: number, sp: Spelling): Spelled & { octave: number } {
  const s = sp.of(midi);
  return { ...s, octave: Math.floor((midi - s.alter) / 12) - 1 };
}

const SIGN = (alter: number, flat = "b", sharp = "#") => (alter < 0 ? flat.repeat(-alter) : sharp.repeat(alter));

/** "F#m7", "Bb", "C/E": the chord moved by `shift` semitones and named in the key. */
export function chordName(c: Chord, sp: Spelling, shift = 0, pretty = false): string {
  const nm = (pc: number) => { const s = sp.of(pc + shift); return s.step + (pretty ? SIGN(s.alter, "♭", "♯") : SIGN(s.alter)); };
  return nm(c.root) + c.quality + (c.bass !== null && c.bass !== undefined && (c.bass - c.root) % 12 !== 0 ? "/" + nm(c.bass) : "");
}

/** The chord sounding at each moment, for showing above the lyric lines. */
export function chordAt(score: ScoreData | null, t: number): Chord | null {
  if (!score) return null;
  for (const c of score.chords) if (c.start <= t && t < c.end) return c.root === null || c.root === undefined ? null : { root: c.root, quality: c.quality ?? "", bass: c.bass ?? null };
  return null;
}
