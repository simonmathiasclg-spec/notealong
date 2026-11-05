import { describe, expect, it } from "vitest";
import { beatSeconds, cueAt, layoutCells, sweepAt } from "../timing";
import { SmoothClock } from "../clock";

const N = (id: string, start: number, end: number) => ({ id, start, end });

describe("beatSeconds", () => {
  it("uses the song tempo", () => { expect(beatSeconds(120)).toBeCloseTo(0.5); expect(beatSeconds(80)).toBeCloseTo(0.75); });
  it("counts very fast songs in half time and very slow ones in double time", () => {
    expect(beatSeconds(180)).toBeCloseTo(0.667, 2);
    expect(beatSeconds(50)).toBeCloseTo(0.6);
  });
  it("falls back to 100 bpm", () => { expect(beatSeconds(null)).toBeCloseTo(0.6); });
});

describe("cueAt", () => {
  const notes = [N("a", 4, 5), N("b", 5, 5.5), N("c", 9, 10)];
  it("cues the next note one beat ahead", () => {
    expect(cueAt(notes, 3.2, 0.5).cue).toBeNull();
    expect(cueAt(notes, 3.6, 0.5).cue).toBe("a");
    expect(cueAt(notes, 4.7, 0.5).cue).toBe("b");
  });
  it("counts 3, 2, 1 into an entry after a long rest", () => {
    expect(cueAt(notes, 2.0, 0.5).count).toBeNull();      // 4 beats away
    expect(cueAt(notes, 2.6, 0.5)).toMatchObject({ countNote: "a", count: 3 });
    expect(cueAt(notes, 3.1, 0.5).count).toBe(2);
    expect(cueAt(notes, 3.6, 0.5).count).toBe(1);
    expect(cueAt(notes, 8.9, 0.5)).toMatchObject({ countNote: "c", count: 1 });
  });
  it("does not count into notes that follow closely", () => {
    expect(cueAt(notes, 4.9, 0.5).count).toBeNull();
    expect(cueAt([N("a", 0, 1), N("b", 2.5, 3)], 2.2, 0.5).count).toBeNull(); // rest of 1.5 s
  });
  it("is quiet after the last note", () => { expect(cueAt(notes, 11, 0.5)).toEqual({ cue: null, countNote: null, count: null }); });
});

describe("layoutCells", () => {
  it("makes held notes wider than quick ones", () => {
    const { cells } = layoutCells([N("a", 0, 0.25), N("b", 0.25, 0.5), N("c", 0.5, 2.5)]);
    expect(cells[2].width).toBeGreaterThan(cells[0].width * 4);
    expect(cells[0].width).toBeCloseTo(cells[1].width);
  });
  it("shows the silence after a short note as empty space", () => {
    const { cells } = layoutCells([N("a", 0, 0.25), N("b", 1, 1.5)]);
    expect(cells[0].fill).toBeCloseTo(0.25);
    expect(cells[1].fill).toBe(1);
  });
  it("squeezes long lines and never exceeds the cap", () => {
    const many = Array.from({ length: 12 }, (_, i) => N(`n${i}`, i * 1.5, i * 1.5 + 1.5));
    const { cells, emPerSecond } = layoutCells(many);
    expect(emPerSecond).toBeLessThan(1.45);
    expect(cells.reduce((a, c) => a + c.width, 0)).toBeLessThanOrEqual(12 * 1.5 * 0.56);
    const { cells: one } = layoutCells([N("x", 0, 30)]);
    expect(one[0].width).toBeLessThanOrEqual(3.2 * 1.45 + 1e-9);
  });
  it("respects a minimum width", () => {
    expect(layoutCells([N("a", 0, 0.1)], 1.2).cells[0].width).toBe(1.2);
  });
});

describe("sweepAt", () => {
  const knots = [{ t: 10, x: 100 }, { t: 11, x: 200 }, { t: 13, x: 260 }];
  it("moves linearly between note starts", () => {
    expect(sweepAt(knots, 10.5, 0.5, 40)).toEqual({ x: 150, opacity: 1 });
    expect(sweepAt(knots, 12, 0.5, 40)).toEqual({ x: 230, opacity: 1 });
  });
  it("glides in over the beat before the first note and is hidden earlier", () => {
    expect(sweepAt(knots, 9.4, 0.5, 40)).toBeNull();
    const s = sweepAt(knots, 9.75, 0.5, 40)!;
    expect(s.x).toBeCloseTo(80);
    expect(s.opacity).toBeGreaterThan(0.9);
  });
  it("fades out after the last note", () => {
    expect(sweepAt(knots, 13.1, 0.5, 40)!.x).toBe(260);
    expect(sweepAt(knots, 13.5, 0.5, 40)).toBeNull();
  });
});

describe("SmoothClock", () => {
  it("runs smoothly between coarse media clock updates without drifting", () => {
    const c = new SmoothClock();
    let media = 5;
    let worst = 0;
    let last = -1;
    // media clock refreshes every 40 ms; we read every 16.7 ms for 60 s at half speed
    for (let ms = 0; ms <= 60000; ms += 16.7) {
      media = 5 + (Math.floor(ms / 40) * 40) / 1000 * 0.5;
      const t = c.read(media, ms, 0.5, true);
      const truth = 5 + (ms / 1000) * 0.5;
      worst = Math.max(worst, Math.abs(t - truth));
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    expect(worst).toBeLessThan(0.025);
  });
  it("jumps on a seek and stops when paused", () => {
    const c = new SmoothClock();
    c.read(1, 0, 1, true);
    expect(c.read(1.016, 16, 1, true)).toBeCloseTo(1.016, 2);
    expect(c.read(30, 32, 1, true)).toBe(30);
    expect(c.read(30.2, 500, 1, false)).toBe(30.2);
  });
});
