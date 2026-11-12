import { describe, expect, it } from "vitest";
import { buildSheet, chordName, fallbackScore, keyFifths, makeGrid, pitchOf, quantize, spelling, type ScoreData, type Sheet } from "../score";
import { sheetToMusicXml } from "../musicxml";
import type { Note, Word } from "../types";

/** A steady grid: `bpm` beats a minute, first bar line on beat `downbeat`. */
function score(bpm: number, meter: [number, number] = [4, 4], over: Partial<ScoreData> = {}): ScoreData {
  const step = 60 / bpm;
  return { version: 1, source: "detected", meter, tempo: bpm, beats: Array.from({ length: 200 }, (_, i) => i * step), downbeat: 0, chords: [], syllables: {}, ...over };
}
/** Notes from [start, length, midi] in beats at 120 bpm (half a second a beat). */
function notes(list: [number, number, number][], beat = 0.5): Note[] {
  return list.map(([s, l, midi], i) => ({ id: `n${i}`, start: s * beat, end: (s + l) * beat, midi, word: null, line: 0 }));
}
const shape = (sheet: Sheet) => sheet.measures.map((m) => m.pieces.map((p) => `${p.rest ? "r" : ""}${p.dur}${p.tieStart ? "~" : ""}`).join(" "));
function sound(sheet: Sheet) {
  for (const m of sheet.measures) {
    expect(m.pieces.reduce((a, p) => a + p.dur, 0)).toBe(m.len);
    let at = m.start - m.bar;
    for (const p of m.pieces) { expect(p.start).toBe(at); at += p.dur; }
  }
}

describe("grid", () => {
  it("maps seconds to ticks and back, from the first bar line", () => {
    const g = makeGrid(score(120, [4, 4], { downbeat: 2 }));
    expect(g.pos(1)).toBe(0);
    expect(g.pos(1.25)).toBe(12);
    expect(g.time(96)).toBeCloseTo(3);
    expect(g.barTicks).toBe(96);
    expect(makeGrid(score(120, [6, 8])).compound).toBe(true);
    expect(makeGrid(score(120, [3, 4])).compound).toBe(false);
  });
  it("follows a tempo that moves", () => {
    const g = makeGrid({ ...score(120), beats: [0, 0.5, 1.0, 1.6, 2.2] });
    expect(g.pos(1.3)).toBeCloseTo(60);
    expect(g.time(60)).toBeCloseTo(1.3);
  });
});

describe("quantize", () => {
  it("rounds a sung rhythm to 8ths and closes small gaps", () => {
    const s = score(120);
    const q = quantize(notes([[0.04, 0.4, 60], [0.52, 0.41, 62], [0.97, 0.9, 64]]), s, makeGrid(s));
    expect(q.map((n) => [n.start, n.end])).toEqual([[0, 12], [12, 24], [24, 48]]);
  });
  it("keeps a 16th that is clearly meant", () => {
    const s = score(120);
    const q = quantize(notes([[0, 0.25, 60], [0.25, 0.25, 62], [0.5, 0.5, 64]]), s, makeGrid(s));
    expect(q.map((n) => n.start)).toEqual([0, 6, 12]);
  });
  it("makes one note of two that land on the same place", () => {
    const s = score(120);
    const q = quantize(notes([[0, 0.05, 60], [0.06, 0.9, 62], [1, 1, 64]]), s, makeGrid(s));
    expect(q.length).toBe(2);
    expect(q[0].ids).toEqual(["n0", "n1"]);
    expect(q[0].midi).toBe(62);
  });
  it("writes a beat split in three as a triplet", () => {
    const s = score(120);
    const q = quantize(notes([[0, 0.33, 60], [0.335, 0.33, 62], [0.665, 0.33, 64], [1, 1, 65]]), s, makeGrid(s));
    expect(q.map((n) => n.start)).toEqual([0, 8, 16, 24]);
    const sheet = buildSheet({ notes: notes([[0, 0.33, 60], [0.335, 0.33, 62], [0.665, 0.33, 64], [1, 1, 65]]), words: [] }, s);
    expect(sheet.measures[0].pieces.slice(0, 3).map((p) => p.tuplet)).toEqual(["start", "mid", "stop"]);
    sound(sheet);
    const xml = sheetToMusicXml(sheet, { title: "t", instrumentId: "flute", keyShift: 0, octaveShift: 0 });
    expect((xml.match(/<time-modification>/g) ?? []).length).toBe(3);
    expect(xml).toContain('<tuplet type="start" bracket="yes"/>');
  });
  it("leaves a hand-written rhythm exactly as written", () => {
    const s = score(120, [4, 4], { source: "authored" });
    const list: [number, number, number][] = [[0, 0.75, 60], [0.75, 0.25, 62], [1, 0.125, 64], [1.125, 0.375, 65], [1.5, 2.5, 67]];
    const q = quantize(notes(list), s, makeGrid(s));
    expect(q.map((n) => [n.start, n.end])).toEqual([[0, 18], [18, 24], [24, 27], [27, 36], [36, 96]]);
  });
});

describe("buildSheet", () => {
  it("fills every bar, ties over the bar line and keeps the middle of a 4/4 bar visible", () => {
    const s = score(120);
    const sheet = buildSheet({ notes: notes([[0, 1, 60], [1.5, 2, 62], [3.5, 1.5, 64]]), words: [] }, s);
    sound(sheet);
    expect(shape(sheet)).toEqual(["36 12~ 36 12~", "24 r24 r48"]);          // the 8th rest after the first note is closed
  });
  it("writes a dotted quarter and a syncopation plainly", () => {
    const s = score(120);
    expect(shape(buildSheet({ notes: notes([[0, 1.5, 60], [1.5, 0.5, 62], [2, 2, 64]]), words: [] }, s))).toEqual(["36 12 48"]);
    expect(shape(buildSheet({ notes: notes([[0, 0.5, 60], [0.5, 1, 62], [1.5, 0.5, 64], [2, 2, 65]]), words: [] }, s))).toEqual(["12 24 12 48"]);
  });
  it("names an instrumental hook where it starts", () => {
    const hook = notes([[0, 1, 60], [1, 1, 62], [2, 2, 64]]).map((n) => ({ ...n, hook: "Solo" }));
    const sheet = buildSheet({ notes: hook, words: [] }, score(120));
    expect(sheet.measures[0].pieces.map((p) => p.lyric?.text ?? null)).toEqual(["Solo", null, null]);
  });
  it("starts with a pickup bar and counts the intro", () => {
    const s = score(120);
    const sheet = buildSheet({ notes: notes([[11, 1, 60], [12, 4, 62]]), words: [] }, s);
    sound(sheet);
    expect(sheet.introBars).toBe(2);
    expect(sheet.measures[0].pickup).toBe(true);
    expect(sheet.measures[0].len).toBe(24);
    expect(shape(sheet)).toEqual(["24", "96"]);
    const xml = sheetToMusicXml(sheet, { title: "t", instrumentId: "flute", keyShift: 0, octaveShift: 0 });
    expect(xml).toContain('<measure number="0" implicit="yes">');
    expect(xml).toContain("2 bars intro");
  });
  it("groups 6/8 in dotted quarters", () => {
    const s = score(240, [6, 8]);                       // an 8th every quarter second
    const sheet = buildSheet({ notes: notes([[0, 3, 60], [3, 1, 62], [4, 1, 64], [5, 1, 65], [6, 6, 67]], 0.25), words: [] }, s);
    sound(sheet);
    expect(shape(sheet)).toEqual(["36 12 12 12", "72"]);
    expect(shape(buildSheet({ notes: notes([[0, 2, 60], [2, 2, 62], [4, 2, 64]], 0.25), words: [] }, s))).toEqual(["24 12~ 12 24"]);
  });
  it("puts 3/4 rests on beats and a whole-bar rest in an empty bar", () => {
    const s = score(120, [3, 4]);
    const sheet = buildSheet({ notes: notes([[0, 1, 60], [6, 3, 62]]), words: [] }, s);
    sound(sheet);
    expect(shape(sheet)).toEqual(["24 r24 r24", "r72", "72"]);
    expect(sheet.measures[1].pieces[0].whole).toBe(true);
  });
  it("puts each word on its first note, and syllables where the song has them", () => {
    const s = score(120);
    const ns = notes([[0, 1, 60], [1, 1, 62], [2, 1, 64], [3, 1, 65]]);
    ns[0].word = "w1"; ns[1].word = "w1"; ns[2].word = "w2"; ns[3].word = "w2";
    const words: Word[] = [{ id: "w1", text: "hello", start: 0, end: 1, line: 0 }, { id: "w2", text: "there", start: 1, end: 2, line: 0 }];
    const plain = buildSheet({ notes: ns, words }, s);
    expect(plain.measures[0].pieces.map((p) => p.lyric?.text)).toEqual(["hello", undefined, "there", undefined]);
    const syl = buildSheet({ notes: ns, words }, { ...s, source: "authored", syllables: { n0: "hel-", n1: "lo", n2: "there" } });
    expect(syl.measures[0].pieces.map((p) => p.lyric && [p.lyric.text, p.lyric.syllabic])).toEqual([["hel", "begin"], ["lo", "end"], ["there", "single"], undefined]);
    // a word that was retyped no longer matches its syllables
    const edited = buildSheet({ notes: ns, words: [{ ...words[0], text: "goodbye" }, words[1]] }, { ...s, source: "authored", syllables: { n0: "hel-", n1: "lo", n2: "there" } });
    expect(edited.measures[0].pieces.map((p) => p.lyric?.text)).toEqual(["goodbye", undefined, "there", undefined]);
  });
  it("shows a chord where it changes and splits a held note there", () => {
    const s = score(120, [4, 4], { chords: [{ start: 0, end: 1, root: 0, quality: "" }, { start: 1, end: 2, root: 0, quality: "" }, { start: 2, end: 4, root: 7, quality: "7" }, { start: 4, end: 8, root: 9, quality: "m" }] });
    const sheet = buildSheet({ notes: notes([[0, 8, 60], [8, 4, 62]]), words: [] }, s);
    sound(sheet);
    expect(sheet.measures.map((m) => m.pieces.map((p) => p.chord?.root))).toEqual([[0], [7], [9]]);
    expect(sheet.measures[0].pieces[0].tieStart).toBe(true);
    const xml = sheetToMusicXml(sheet, { title: "t", instrumentId: "alto_sax", keyShift: 0, octaveShift: 0, key: { tonic: 0, mode: "major", name: "C major", confidence: 1 } });
    // alto sax reads a major sixth up: C is written A, G7 is E7, A minor is F sharp minor
    expect(xml).toContain("<root><root-step>A</root-step></root><kind text=\"\">major</kind>");
    expect(xml).toContain("<root><root-step>E</root-step></root><kind text=\"7\">dominant</kind>");
    expect(xml).toContain("<root><root-step>F</root-step><root-alter>1</root-alter></root><kind text=\"m\">minor</kind>");
    expect(xml).toContain("<fifths>3</fifths>");
  });
});

describe("names", () => {
  it("knows the key signatures", () => {
    expect(keyFifths(0, "major")).toBe(0);
    expect(keyFifths(7, "major")).toBe(1);
    expect(keyFifths(5, "major")).toBe(-1);
    expect(keyFifths(9, "minor")).toBe(0);
    expect(keyFifths(2, "minor")).toBe(-1);
    expect(keyFifths(4, "major")).toBe(4);
  });
  it("spells notes for the key", () => {
    const f = spelling(5, "major");
    expect(f.of(10)).toEqual({ step: "B", alter: -1 });
    expect(f.of(6)).toEqual({ step: "F", alter: 1 });
    const e = spelling(4, "major");
    expect(e.of(3)).toEqual({ step: "D", alter: 1 });
    expect(pitchOf(60, spelling(0))).toEqual({ step: "C", alter: 0, octave: 4 });
    expect(pitchOf(71, spelling(6, "major"))).toEqual({ step: "B", alter: 0, octave: 4 });
    expect(pitchOf(59, spelling(-1 + 12, "major")).octave).toBe(3);
  });
  it("names chords in the key, moved for the instrument", () => {
    const sp = spelling(5, "major");
    expect(chordName({ root: 10, quality: "", bass: null }, sp)).toBe("Bb");
    expect(chordName({ root: 2, quality: "m7", bass: null }, sp)).toBe("Dm7");
    expect(chordName({ root: 0, quality: "", bass: 4 }, sp)).toBe("C/E");
    expect(chordName({ root: 0, quality: "7", bass: null }, spelling(2, "major"), 2, true)).toBe("D7");
    expect(chordName({ root: 8, quality: "", bass: null }, spelling(3, "major"), 0, true)).toBe("A♭");
  });
});

describe("fallback", () => {
  it("gives a 4/4 grid at the song's tempo", () => {
    const s = fallbackScore(90, 10);
    expect(s.meter).toEqual([4, 4]);
    expect(s.beats[3]).toBeCloseTo(2);
    expect(fallbackScore(null, 5).tempo).toBe(100);
  });
});
