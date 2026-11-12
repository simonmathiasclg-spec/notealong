import { describe, expect, it } from "vitest";
import { firstAt, phrase, plan, type HearNote } from "../hear";
import { pickZone, rateFor, resolveInstrument, zonePitch, type Manifest } from "../sampler";
import { SmoothClock } from "../clock";

const N = (id: string, start: number, end: number, pitch = 60): HearNote => ({ id, start, end, pitch });

describe("plan", () => {
  const notes = [N("a", 1, 1.5), N("b", 1.5, 2), N("c", 4, 5)];
  it("books notes inside the lookahead at their exact delay", () => {
    const { bookings, next } = plan(notes, 0, 0.9, 1, 0.2);
    expect(bookings.map((b) => b.note.id)).toEqual(["a"]);
    expect(bookings[0].delay).toBeCloseTo(0.1);
    expect(bookings[0].duration).toBeCloseTo(0.5);
    expect(next).toBe(1);
  });
  it("scales delay and length with the speed", () => {
    const { bookings } = plan(notes, 0, 0.95, 0.5, 0.2);
    expect(bookings[0].delay).toBeCloseTo(0.1);      // 0.05 s of song takes 0.1 s at half speed
    expect(bookings[0].duration).toBeCloseTo(1.0);
  });
  it("never books a note twice", () => {
    const first = plan(notes, 0, 0.9, 1, 0.2);
    const second = plan(notes, first.next, 0.925, 1, 0.2);
    expect(second.bookings).toEqual([]);
  });
  it("joins a long note that is already under way, but not the tail end of one", () => {
    expect(plan(notes, firstAt(notes, 4.3), 4.3, 1).bookings[0]).toMatchObject({ delay: 0, duration: expect.closeTo(0.7) });
    expect(plan(notes, firstAt(notes, 4.9), 4.9, 1).bookings).toEqual([]);
  });
  it("skips notes that are still sounding", () => {
    expect(plan(notes, 0, 0.9, 1, 0.2, (id) => id === "a").bookings).toEqual([]);
  });
});

describe("firstAt", () => {
  const notes = [N("a", 1, 1.5), N("b", 1.5, 2), N("c", 4, 5)];
  it("finds the note at or after a position", () => {
    expect(firstAt(notes, 0)).toBe(0);
    expect(firstAt(notes, 1.7)).toBe(1);
    expect(firstAt(notes, 3)).toBe(2);
    expect(firstAt(notes, 9)).toBe(3);
  });
});

describe("no drift", () => {
  // A whole song at full and at half speed, with a media clock that only refreshes every 40 ms and
  // a scheduler that wakes at uneven times: every note must land where the song really is.
  for (const rate of [1, 0.5]) {
    it(`keeps every note within 15 ms over a 4 minute song at ${rate}x`, () => {
      const notes: HearNote[] = [];
      for (let t = 2; t < 240; t += 0.37) notes.push(N(`n${notes.length}`, t, t + 0.3));
      const clock = new SmoothClock();
      let next = 0;
      let worst = 0;
      let booked = 0;
      let seed = 7;
      const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let wall = 0; wall < (240 / rate) * 1000; wall += 18 + rand() * 20) {
        const truth = (wall / 1000) * rate;
        const media = Math.floor(truth / (0.04 * rate)) * (0.04 * rate);   // coarse media clock
        const t = clock.read(media, wall, rate, true);
        const res = plan(notes, next, t, rate);
        next = res.next;
        for (const b of res.bookings) {
          booked++;
          const songWhenHeard = truth + b.delay * rate;                     // where the song really is when the note sounds
          worst = Math.max(worst, Math.abs(songWhenHeard - b.note.start) / rate);
        }
      }
      expect(booked).toBe(notes.length);
      expect(worst).toBeLessThan(0.015);
    });
  }
});

describe("sampler maths", () => {
  const zones = [{ midi: 57, tune: -2, file: "57.flac" }, { midi: 61, tune: 19, file: "61.flac" }, { midi: 65, tune: 0, file: "65.flac" }];
  const manifest: Manifest = {
    version: 1, sample_rate: 32000,
    instruments: {
      tenor_sax: { name: "Tenor sax", sustain: true, release: 0.1, vibrato: [5, 14, 0.5], tone: 6500, level: 1, zones },
      baritone_sax: { name: "Baritone sax", from: "tenor_sax", shift: -7 },
    },
  };
  it("picks the nearest recording", () => {
    expect(pickZone(zones, 58).midi).toBe(57);
    expect(pickZone(zones, 60).midi).toBe(61);
    expect(pickZone(zones, 90).midi).toBe(65);
  });
  it("corrects recordings that are out of tune", () => {
    // the 61 recording is 19 cents sharp: to sound an exact 61 it must be played slightly slower
    expect(zonePitch(zones[1])).toBeCloseTo(61.19);
    expect(rateFor(zones[1], 61)).toBeCloseTo(Math.pow(2, -0.19 / 12), 6);
    expect(rateFor(zones[2], 67)).toBeCloseTo(Math.pow(2, 2 / 12), 6);
  });
  it("lets the baritone borrow the tenor a fifth lower", () => {
    const r = resolveInstrument(manifest, "baritone_sax")!;
    expect(r.folder).toBe("tenor_sax");
    expect(r.shift).toBe(-7);
    // a low baritone note (50) uses the tenor recording a fifth above it, slowed down
    const z = pickZone(r.def.zones, 50 - r.shift);
    expect(z.midi).toBe(57);
    expect(rateFor(z, 50)).toBeCloseTo(Math.pow(2, (50 - 56.98) / 12), 6);
  });
  it("returns null for an unknown instrument", () => { expect(resolveInstrument(manifest, "kazoo")).toBeNull(); });
});

describe("legato phrasing (the sax-friendly melody)", () => {
  const n = (id: string, start: number, end: number, pitch: number, word: string | null, syl = 0) => ({ id, start, end, pitch, word, syl });

  it("holds each note up to the next one across a small gap, and keeps real rests silent", () => {
    const out = phrase([n("a", 0, 0.4, 64, "w0"), n("b", 0.5, 0.9, 62, "w1"), n("c", 1.6, 2.4, 60, "w2")], null, { legato: true });
    expect(out[0].end).toBe(0.5);
    expect(out[1].attack).toBe("soft");
    expect(out[1].end).toBe(0.9);
    expect(out[2].phrase).toBe(true);
    expect(out[2].attack).toBeUndefined();
  });

  it("tongues the same pitch again softly on a new syllable, with a breath between, so it is heard twice", () => {
    const out = phrase([n("a", 0, 0.5, 67, "w0"), n("b", 0.5, 1.0, 67, "w1"), n("c", 1.0, 1.5, 67, "w2", 0), n("d", 1.5, 2.0, 67, "w2", 1)], null, { legato: true });
    expect(out.slice(1).map((o) => o.attack)).toEqual(["soft", "soft", "soft"]);
    for (let i = 0; i < 3; i++) {
      expect(out[i].end).toBeLessThan(out[i + 1].start);
      expect(out[i + 1].start - out[i].end).toBeLessThan(0.05);
    }
  });

  it("slurs a second pitch on one syllable, however long it is", () => {
    const out = phrase([n("a", 0, 0.8, 64, "w0", 0), n("b", 0.8, 1.8, 62, "w0", 0), n("c", 1.8, 2.4, 60, "w0", 1)], null, { legato: true });
    expect(out[1].attack).toBe("slur");
    expect(out[1].from).toBe(64);
    expect(out[2].attack).toBe("soft");
  });

  it("leaves the old phrasing alone when legato is off", () => {
    const out = phrase([n("a", 0, 0.4, 64, "w0"), n("b", 0.5, 0.9, 62, "w1")]);
    expect(out[0].end).toBe(0.4);
    expect(out[1].attack).toBeUndefined();
  });
});
