import { describe, expect, it } from "vitest";
import { chance, gainFor, pickZone, rateFor, zonesFor, type Zone } from "../sampler";
import { phrase } from "../hear";

// every semitone from 60 to 63, soft and loud, two takes of each (as the alto sax is built)
const layered: Zone[] = [60, 61, 62, 63].flatMap((midi) =>
  [0, 1].flatMap((layer) => [0, 1].map((rr) => ({ midi, tune: 0, file: `${midi}_${layer ? "f" : "p"}${rr + 1}.flac`, layer, rr }))));
// a plain instrument: one recording every three semitones
const plain: Zone[] = [57, 60, 63].map((midi) => ({ midi, tune: 0, file: `${midi}.flac` }));

describe("choosing a recording", () => {
  it("takes the wanted loudness and take of the right note", () => {
    expect(pickZone(layered, 62, { layer: 1, rr: 1 }).file).toBe("62_f2.flac");
    expect(pickZone(layered, 62, { layer: 0, rr: 0 }).file).toBe("62_p1.flac");
  });
  it("prefers the right note in the other loudness to the right loudness a semitone away", () => {
    const loaded = (z: Zone) => !(z.midi === 62 && z.layer === 1);
    expect(pickZone(layered, 62, { layer: 1, rr: 0 }, loaded).file).toBe("62_p1.flac");
  });
  it("falls back to another take that is loaded", () => {
    const loaded = (z: Zone) => z.rr === 0;
    expect(pickZone(layered, 61, { layer: 1, rr: 1 }, loaded).file).toBe("61_f1.flac");
  });
  it("still works for instruments without layers", () => {
    expect(pickZone(plain, 61, { layer: 1, rr: 1 }).midi).toBe(60);
    expect(rateFor(pickZone(plain, 61), 61)).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });
  it("lists only the recordings a song needs", () => {
    const need = zonesFor(layered, [60, 62]);
    expect(need).toHaveLength(8);
    expect(new Set(need.map((z) => z.midi))).toEqual(new Set([60, 62]));
    expect(zonesFor(plain, [58, 59]).map((z) => z.midi).sort()).toEqual([57, 60]);
  });
});

describe("loudness", () => {
  it("leaves a medium note alone and spans about 18 dB from nothing to full", () => {
    expect(gainFor(0.7)).toBeCloseTo(1, 6);
    expect(20 * Math.log10(gainFor(1) / gainFor(0))).toBeCloseTo(18, 6);
    expect(gainFor(0.9)).toBeGreaterThan(gainFor(0.5));
  });
  it("gives a note the same luck every time", () => {
    expect(chance("n12", 1)).toBe(chance("n12", 1));
    expect(chance("n12", 1)).not.toBe(chance("n13", 1));
    for (const id of ["a", "b", "n1", "n2"]) { expect(chance(id)).toBeGreaterThanOrEqual(0); expect(chance(id)).toBeLessThan(1); }
  });
});

describe("phrasing a melody", () => {
  const n = (id: string, start: number, end: number, pitch: number, word?: string) => ({ id, start, end, pitch, word });
  it("starts a phrase after a silence and runs notes on when they touch", () => {
    const out = phrase([n("a", 0, 0.5, 60), n("b", 0.5, 1, 62), n("c", 1.6, 2, 64)]);
    expect(out[0].phrase).toBe(true);
    expect(out[1].phrase).toBeUndefined();
    expect(out[1].attack).toBe("soft");
    expect(out[1].from).toBe(60);
    expect(out[2].phrase).toBe(true);
    expect(out[2].attack).toBeUndefined();
  });
  it("slurs a quick step inside one word, and nothing else", () => {
    const out = phrase([n("a", 0, 0.15, 60, "glo-"), n("b", 0.15, 0.3, 62, "glo-"), n("c", 0.3, 0.45, 64, "ri"), n("d", 0.45, 1.2, 72, "ri")]);
    expect(out[1].attack).toBe("slur");
    expect(out[2].attack).toBe("soft");      // a new word is tongued
    expect(out[3].attack).toBe("soft");      // a leap is tongued
  });
  it("tongues a note that follows a small gap", () => {
    const out = phrase([n("a", 0, 0.4, 60), n("b", 0.5, 0.9, 62)]);
    expect(out[1].attack).toBeUndefined();
    expect(out[1].phrase).toBeUndefined();
  });
  it("shapes loudness from the melody: higher is stronger, within a playable range", () => {
    const out = phrase([n("a", 0, 0.4, 60), n("b", 0.4, 0.8, 72), n("c", 0.8, 1.2, 60)]);
    expect(out[1].level!).toBeGreaterThan(out[0].level!);
    for (const o of out) { expect(o.level!).toBeGreaterThanOrEqual(0.4); expect(o.level!).toBeLessThanOrEqual(0.95); }
  });
  it("follows the singer where the song has one", () => {
    const out = phrase([n("a", 0, 0.4, 60), n("b", 0.4, 0.8, 72)], { a: 0.9, b: 0.45 });
    expect(out[0].level).toBe(0.9);
    expect(out[1].level).toBe(0.45);
  });
  it("keeps the notes' timing untouched", () => {
    const notes = [n("a", 0.123, 0.456, 60), n("b", 0.5, 0.789, 62)];
    expect(phrase(notes).map((o) => [o.start, o.end, o.pitch])).toEqual(notes.map((o) => [o.start, o.end, o.pitch]));
  });
});
