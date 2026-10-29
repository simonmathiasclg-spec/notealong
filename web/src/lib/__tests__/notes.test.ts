import { describe, expect, it } from "vitest";
import { autoOctaveShift, describeNote, keyName, pitchClassLabel, resolveOctaveShift, writtenMidi } from "../notes";
import { getInstrument, INSTRUMENTS } from "../instruments";

const alto = getInstrument("alto_sax");
const tenor = getInstrument("tenor_sax");
const flute = getInstrument("flute");
const recorder = getInstrument("recorder");

describe("transposition", () => {
  it("alto sax: concert C4 is written A4", () => {
    expect(writtenMidi(60, alto, 0, 0)).toBe(69);
  });
  it("tenor sax: concert C4 is written D5", () => {
    expect(writtenMidi(60, tenor, 0, 0)).toBe(74);
  });
  it("key shift adds to the written pitch", () => {
    expect(writtenMidi(60, flute, 2, 0)).toBe(62);
    expect(writtenMidi(60, alto, -3, 1)).toBe(60 - 3 + 9 + 12);
  });
  it("recorder is written an octave below where it sounds", () => {
    expect(writtenMidi(72, recorder, 0, 0)).toBe(60);
  });
  it("every instrument has a sane range", () => {
    for (const i of INSTRUMENTS) {
      expect(i.range[0]).toBeLessThan(i.range[1]);
      expect(i.lowerBelow).toBeGreaterThanOrEqual(i.range[0]);
      expect(i.upperFrom).toBeLessThanOrEqual(i.range[1]);
    }
  });
});

describe("range fitting", () => {
  it("shifts a low melody up an octave for alto sax", () => {
    // concert A2..A3 -> written F#3..F#4 (54..66); range starts at 58 so an octave up fits more
    const midis = [45, 47, 49, 50, 52, 54, 56, 57];
    expect(autoOctaveShift(midis, alto, 0)).toBe(1);
  });
  it("leaves a melody that already fits", () => {
    const midis = [60, 62, 64, 65, 67]; // written 69..76
    expect(autoOctaveShift(midis, alto, 0)).toBe(0);
  });
  it("shifts a high melody down", () => {
    const midis = [84, 86, 88]; // written 93..97 above 89
    expect(autoOctaveShift(midis, alto, 0)).toBe(-1);
  });
  it("manual override moves relative to auto", () => {
    const midis = [60, 62, 64];
    expect(resolveOctaveShift("up", midis, alto, 0)).toBe(1);
    expect(resolveOctaveShift("down", midis, alto, 0)).toBe(-1);
  });
  it("flags notes still out of range", () => {
    const d = describeNote({ id: "n1", midi: 30 }, { instrument: "alto_sax", keyShift: 0, octave: "auto", notation: "sharps" }, null, 0);
    expect(d.outOfRange).toBe(true);
    expect(d.outOfRangeReason).toMatch(/Too low/);
  });
});

describe("naming", () => {
  const key = { tonic: 7, mode: "major" as const, name: "G major", confidence: 0.9 };
  it("sharps and flats", () => {
    expect(pitchClassLabel(61, "sharps", null, 0, flute, 0)).toBe("C#");
    expect(pitchClassLabel(61, "flats", null, 0, flute, 0)).toBe("Db");
  });
  it("solfege is relative to the key including transposition", () => {
    // Song in G major, alto sax: written tonic is G+9 = E. Written E -> Do.
    expect(pitchClassLabel(64, "solfege", key, 0, alto, 0)).toBe("Do");
    expect(pitchClassLabel(66, "solfege", key, 0, alto, 0)).toBe("Re");
    // key shift +2 moves the tonic too
    expect(pitchClassLabel(66, "solfege", key, 2, alto, 0)).toBe("Do");
  });
  it("sargam", () => {
    expect(pitchClassLabel(67, "sargam", key, 0, flute, 0)).toBe("Sa");
    expect(pitchClassLabel(74, "sargam", key, 0, flute, 0)).toBe("Pa");
  });
  it("key name follows the key shift", () => {
    expect(keyName(key, 0)).toBe("G major");
    expect(keyName(key, 3)).toBe("Bb major");
    expect(keyName(key, -6)).toBe("Db major");
  });
  it("octave markers", () => {
    const s = { instrument: "alto_sax", keyShift: 0, octave: "auto" as const, notation: "sharps" as const };
    expect(describeNote({ id: "a", midi: 75 }, s, null, 0).octaveMark).toBe("up"); // written 84
    expect(describeNote({ id: "b", midi: 50 }, s, null, 0).octaveMark).toBe("down"); // written 59
    expect(describeNote({ id: "c", midi: 62 }, s, null, 0).octaveMark).toBe(null); // written 71
  });
});
