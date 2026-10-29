/**
 * Instrument table. `transpose` is how many semitones to ADD to concert pitch to
 * get the written pitch the player reads. `range` is the practical WRITTEN range
 * (MIDI numbers) used for octave fitting and out-of-range colouring.
 *
 * Checked against standard orchestration references:
 *  - Alto/baritone sax (E♭): written a major 6th / major 13th above concert.
 *  - Tenor/soprano sax, clarinet, trumpet (B♭): written a major 9th / major 2nd above.
 *  - Horn in F: written a perfect 5th above concert.
 *  - Soprano recorder: sounds an octave HIGHER than written, so written = concert − 12.
 */
export type InstrumentFamily = "Saxophones" | "Woodwinds" | "Brass" | "Strings" | "Keys & voice";

export type Instrument = {
  id: string;
  name: string;
  family: InstrumentFamily;
  transpose: number;
  range: [number, number];
  /** Written note where the "upper register" marker starts (for the ▲ hint). */
  upperFrom: number;
  /** Written note below which the "lower register" marker shows (for the ▼ hint). */
  lowerBelow: number;
  icon: string; // key into the icon map in components/InstrumentIcon
  description: string;
};

export const INSTRUMENTS: Instrument[] = [
  { id: "alto_sax", name: "Alto sax", family: "Saxophones", transpose: 9, range: [58, 89], upperFrom: 82, lowerBelow: 62, icon: "sax", description: "E♭ alto saxophone" },
  { id: "tenor_sax", name: "Tenor sax", family: "Saxophones", transpose: 14, range: [58, 89], upperFrom: 82, lowerBelow: 62, icon: "sax", description: "B♭ tenor saxophone" },
  { id: "soprano_sax", name: "Soprano sax", family: "Saxophones", transpose: 2, range: [58, 89], upperFrom: 82, lowerBelow: 62, icon: "sax", description: "B♭ soprano saxophone" },
  { id: "baritone_sax", name: "Baritone sax", family: "Saxophones", transpose: 21, range: [58, 89], upperFrom: 82, lowerBelow: 62, icon: "sax", description: "E♭ baritone saxophone" },
  { id: "clarinet", name: "Clarinet", family: "Woodwinds", transpose: 2, range: [52, 91], upperFrom: 84, lowerBelow: 59, icon: "clarinet", description: "B♭ clarinet" },
  { id: "flute", name: "Flute", family: "Woodwinds", transpose: 0, range: [60, 96], upperFrom: 86, lowerBelow: 65, icon: "flute", description: "Concert flute" },
  { id: "oboe", name: "Oboe", family: "Woodwinds", transpose: 0, range: [58, 91], upperFrom: 84, lowerBelow: 62, icon: "oboe", description: "Oboe" },
  { id: "recorder", name: "Recorder", family: "Woodwinds", transpose: -12, range: [60, 86], upperFrom: 79, lowerBelow: 64, icon: "recorder", description: "Soprano (descant) recorder, written an octave below how it sounds" },
  { id: "trumpet", name: "Trumpet", family: "Brass", transpose: 2, range: [54, 84], upperFrom: 77, lowerBelow: 60, icon: "trumpet", description: "B♭ trumpet or cornet" },
  { id: "french_horn", name: "French horn", family: "Brass", transpose: 7, range: [54, 81], upperFrom: 76, lowerBelow: 60, icon: "horn", description: "Horn in F" },
  { id: "violin", name: "Violin", family: "Strings", transpose: 0, range: [55, 93], upperFrom: 84, lowerBelow: 62, icon: "violin", description: "Violin" },
  { id: "piano", name: "Keyboard / piano", family: "Keys & voice", transpose: 0, range: [21, 108], upperFrom: 84, lowerBelow: 60, icon: "piano", description: "Any keyboard" },
  { id: "voice", name: "Voice", family: "Keys & voice", transpose: 0, range: [36, 96], upperFrom: 79, lowerBelow: 55, icon: "voice", description: "Sing along, notes shown at real pitch" },
];

export const DEFAULT_INSTRUMENT = "alto_sax";

export function getInstrument(id: string): Instrument {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}

export const FAMILIES: InstrumentFamily[] = ["Saxophones", "Woodwinds", "Brass", "Strings", "Keys & voice"];
