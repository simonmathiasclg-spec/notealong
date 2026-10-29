/**
 * Standard saxophone fingerings by WRITTEN pitch (the same for every sax).
 * Keys: L1 L2 L3 (left hand), R1 R2 R3 (right hand), oct = octave key,
 * plus named extra keys. Written range covered: B♭3 (58) to F6 (89).
 */
export type Fingering = { l: [boolean, boolean, boolean]; r: [boolean, boolean, boolean]; oct: boolean; extra: string[] };

const ALL: [boolean, boolean, boolean] = [true, true, true];
const NONE: [boolean, boolean, boolean] = [false, false, false];

const BASE: Record<number, Fingering> = {
  58: { l: ALL, r: ALL, oct: false, extra: ["low B♭ key"] },
  59: { l: ALL, r: ALL, oct: false, extra: ["low B key"] },
  60: { l: ALL, r: ALL, oct: false, extra: ["low C key"] },
  61: { l: ALL, r: ALL, oct: false, extra: ["low C♯ key"] },
  62: { l: ALL, r: ALL, oct: false, extra: [] },
  63: { l: ALL, r: ALL, oct: false, extra: ["E♭ key"] },
  64: { l: ALL, r: [true, true, false], oct: false, extra: [] },
  65: { l: ALL, r: [true, false, false], oct: false, extra: [] },
  66: { l: ALL, r: [false, true, false], oct: false, extra: [] },
  67: { l: ALL, r: NONE, oct: false, extra: [] },
  68: { l: ALL, r: NONE, oct: false, extra: ["G♯ key"] },
  69: { l: [true, true, false], r: NONE, oct: false, extra: [] },
  70: { l: [true, false, false], r: [true, false, false], oct: false, extra: [] },
  71: { l: [true, false, false], r: NONE, oct: false, extra: [] },
  72: { l: [false, true, false], r: NONE, oct: false, extra: [] },
  73: { l: NONE, r: NONE, oct: false, extra: ["(open)"] },
};

export function saxFingering(written: number): Fingering | null {
  if (written >= 58 && written <= 73) return BASE[written];
  if (written >= 74 && written <= 85) {
    const b = BASE[written - 12];
    return { ...b, oct: true, extra: b.extra.filter((e) => e !== "(open)") };
  }
  if (written === 86) return { l: NONE, r: NONE, oct: true, extra: ["palm D"] };
  if (written === 87) return { l: NONE, r: NONE, oct: true, extra: ["palm D", "palm E♭"] };
  if (written === 88) return { l: NONE, r: NONE, oct: true, extra: ["palm D", "palm E♭", "palm F"] };
  if (written === 89) return { l: NONE, r: NONE, oct: true, extra: ["palm D", "palm E♭", "palm F", "side high F"] };
  return null;
}
