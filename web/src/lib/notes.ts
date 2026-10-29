/**
 * All pitch maths for the player.
 *
 *   written = concert + keyShift + instrument.transpose + 12 * octaveShift
 */
import { getInstrument, type Instrument } from "./instruments";
import type { Notation, OctaveMode, Note, KeyInfo } from "./types";

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// Movable-do solfège, chromatic syllables (ascending)
const SOLFEGE = ["Do", "Di", "Re", "Ri", "Mi", "Fa", "Fi", "So", "Si", "La", "Li", "Ti"];
// Sargam, chromatic (komal/tivra marked with lowercase as is common in Indian notation apps)
const SARGAM = ["Sa", "re", "Re", "ga", "Ga", "Ma", "ma'", "Pa", "dha", "Dha", "ni", "Ni"];

export type DisplaySettings = {
  instrument: string;
  keyShift: number;
  octave: OctaveMode;
  notation: Notation;
};

export function clampKeyShift(n: number): number {
  return Math.max(-6, Math.min(6, Math.round(n)));
}

/** Choose the whole-octave shift that keeps the most notes inside the instrument's range. */
export function autoOctaveShift(concertMidis: number[], instrument: Instrument, keyShift: number): number {
  if (concertMidis.length === 0) return 0;
  const [lo, hi] = instrument.range;
  let best = 0;
  let bestCount = -1;
  let bestDist = Infinity;
  const centre = (lo + hi) / 2;
  for (const shift of [-2, -1, 0, 1, 2]) {
    let count = 0;
    let dist = 0;
    for (const m of concertMidis) {
      const w = m + keyShift + instrument.transpose + 12 * shift;
      if (w >= lo && w <= hi) count++;
      dist += Math.abs(w - centre);
    }
    const avg = dist / concertMidis.length;
    // most notes in range wins; then the smallest shift (stay near the sung register); then closest to the middle
    const better =
      count > bestCount ||
      (count === bestCount && Math.abs(shift) < Math.abs(best)) ||
      (count === bestCount && Math.abs(shift) === Math.abs(best) && avg < bestDist);
    if (better) {
      best = shift;
      bestCount = count;
      bestDist = avg;
    }
  }
  return best;
}

export function resolveOctaveShift(mode: OctaveMode, concertMidis: number[], instrument: Instrument, keyShift: number): number {
  const auto = autoOctaveShift(concertMidis, instrument, keyShift);
  if (mode === "auto") return auto;
  return auto + (mode === "up" ? 1 : -1);
}

export function writtenMidi(concert: number, instrument: Instrument, keyShift: number, octaveShift: number): number {
  return concert + keyShift + instrument.transpose + 12 * octaveShift;
}

export type DisplayNote = {
  id: string;
  written: number;
  label: string;        // e.g. "C#", "Do", "Sa"
  octaveMark: "up" | "down" | null;
  outOfRange: boolean;
  outOfRangeReason: string | null;
  octaveNumber: number; // scientific pitch octave of the written note (C4 = middle C)
};

export function pitchClassLabel(written: number, notation: Notation, key: KeyInfo | null | undefined, keyShift: number, instrument: Instrument, octaveShift: number): string {
  const pc = ((written % 12) + 12) % 12;
  if (notation === "sharps") return SHARP_NAMES[pc];
  if (notation === "flats") return FLAT_NAMES[pc];
  // Relative systems: the tonic moves with the key shift and the instrument
  // transposition, exactly like the notes do.
  const tonicWritten = key ? (((key.tonic + keyShift + instrument.transpose) % 12) + 12) % 12 : 0;
  const rel = ((pc - tonicWritten) % 12 + 12) % 12;
  return notation === "solfege" ? SOLFEGE[rel] : SARGAM[rel];
}

export function describeNote(
  note: Pick<Note, "id" | "midi">,
  settings: DisplaySettings,
  key: KeyInfo | null | undefined,
  octaveShift: number,
): DisplayNote {
  const instrument = getInstrument(settings.instrument);
  const written = writtenMidi(note.midi, instrument, settings.keyShift, octaveShift);
  const [lo, hi] = instrument.range;
  const outOfRange = written < lo || written > hi;
  return {
    id: note.id,
    written,
    label: pitchClassLabel(written, settings.notation, key, settings.keyShift, instrument, octaveShift),
    octaveMark: written >= instrument.upperFrom ? "up" : written < instrument.lowerBelow ? "down" : null,
    outOfRange,
    outOfRangeReason: outOfRange
      ? written < lo
        ? `Too low for the ${instrument.name.toLowerCase()}. Try the octave control or a higher key.`
        : `Too high for the ${instrument.name.toLowerCase()}. Try the octave control or a lower key.`
      : null,
    octaveNumber: Math.floor(written / 12) - 1,
  };
}

export function keyName(key: KeyInfo | null | undefined, keyShift: number, notation: Notation = "sharps"): string {
  if (!key) return "Unknown";
  const tonic = (((key.tonic + keyShift) % 12) + 12) % 12;
  const names = notation === "flats" ? FLAT_NAMES : SHARP_NAMES;
  // Use the conventional spelling for keys (flats for flat keys)
  const conventional = key.mode === "major"
    ? ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    : ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  const n = notation === "sharps" || notation === "flats" ? conventional[tonic] : names[tonic];
  return `${n} ${key.mode}`;
}

/** Plain-words description of a key shift for the control label. */
export function keyShiftLabel(shift: number): string {
  if (shift === 0) return "Original key";
  const abs = Math.abs(shift);
  const dir = shift > 0 ? "higher" : "lower";
  return `${abs} ${abs === 1 ? "step" : "steps"} ${dir}`;
}

export function midiToName(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
