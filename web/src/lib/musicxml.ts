/**
 * MusicXML for a song: the same written music the Sheet music view shows (lib/score.ts), so what is on the
 * screen, the PDF and the exported file agree. Pitches are written for the instrument, with a <transpose>
 * element so notation programs know the concert pitch.
 */
import { getInstrument } from "./instruments";
import { writtenMidi } from "./notes";
import { buildSheet, fallbackScore, pitchOf, spelling, TPQ, type Chord, type Piece, type ScoreData, type Sheet, type Spelling } from "./score";
import type { KeyInfo, Song, Word } from "./types";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TYPES: Record<number, [string, number]> = {
  3: ["32nd", 0], 6: ["16th", 0], 12: ["eighth", 0], 18: ["eighth", 1], 24: ["quarter", 0], 36: ["quarter", 1],
  48: ["half", 0], 72: ["half", 1], 96: ["whole", 0],
};
const KINDS: Record<string, string> = {
  "": "major", m: "minor", "7": "dominant", m7: "minor-seventh", maj7: "major-seventh", dim: "diminished", aug: "augmented",
  "6": "major-sixth", m6: "minor-sixth", m7b5: "half-diminished", "9": "dominant-ninth", sus4: "suspended-fourth", sus2: "suspended-second",
};

export type SheetXmlOptions = {
  title: string;
  artist?: string | null;
  instrumentId: string;
  keyShift: number;
  octaveShift: number;
  key?: KeyInfo | null;
  /** Leave out the title, composer and tempo mark (the player shows those itself). */
  bare?: boolean;
  chords?: boolean;
  lyrics?: boolean;
};

/** The key the instrument reads in. */
export function writtenSpelling(key: KeyInfo | null | undefined, instrumentId: string, keyShift: number): Spelling {
  const inst = getInstrument(instrumentId);
  return spelling(key ? key.tonic + keyShift + inst.transpose : null, key?.mode ?? "major");
}

/** Notes mostly below the treble staff are easier to read in bass clef. */
export function clefFor(written: number[]): "treble" | "bass" {
  if (!written.length) return "treble";
  const sorted = [...written].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] < 53 ? "bass" : "treble";
}

export function sheetToMusicXml(sheet: Sheet, o: SheetXmlOptions): string {
  const inst = getInstrument(o.instrumentId);
  const sp = writtenSpelling(o.key, o.instrumentId, o.keyShift);
  const shift = o.keyShift + inst.transpose;
  const w = (midi: number) => writtenMidi(midi, inst, o.keyShift, o.octaveShift);
  const clef = clefFor(sheet.measures.flatMap((m) => m.pieces.filter((p) => !p.rest).map((p) => w(p.midi!))));
  const [n, d] = sheet.meter;

  const harmony = (c: Chord) => {
    const part = (tag: string, pc: number) => { const s = sp.of(pc + shift); return `<${tag}><${tag}-step>${s.step}</${tag}-step>${s.alter ? `<${tag}-alter>${s.alter}</${tag}-alter>` : ""}</${tag}>`; };
    const bass = c.bass !== null && (c.bass - c.root) % 12 !== 0 ? part("bass", c.bass) : "";
    return `<harmony>${part("root", c.root)}<kind text="${esc(c.quality)}">${KINDS[c.quality] ?? "major"}</kind>${bass}</harmony>`;
  };
  const note = (p: Piece) => {
    const third = !!p.tuplet;
    const [type, dots] = TYPES[third ? (p.dur * 3) / 2 : p.dur] ?? ["quarter", 0];
    const head = p.rest
      ? `<rest${p.whole ? ' measure="yes"' : ""}/>`
      : (() => { const s = pitchOf(w(p.midi!), sp); return `<pitch><step>${s.step}</step>${s.alter ? `<alter>${s.alter}</alter>` : ""}<octave>${s.octave}</octave></pitch>`; })();
    const ties = `${p.tieStop ? '<tie type="stop"/>' : ""}${p.tieStart ? '<tie type="start"/>' : ""}`;
    const notations = `${p.tieStop ? '<tied type="stop"/>' : ""}${p.tieStart ? '<tied type="start"/>' : ""}${p.tuplet === "start" ? '<tuplet type="start" bracket="yes"/>' : p.tuplet === "stop" ? '<tuplet type="stop"/>' : ""}`;
    const lyric = p.lyric && o.lyrics !== false ? `<lyric number="1"><syllabic>${p.lyric.syllabic}</syllabic><text>${esc(p.lyric.text)}</text></lyric>` : "";
    return `${p.chord && o.chords !== false ? harmony(p.chord) : ""}<note>${head}<duration>${p.dur}</duration>${ties}<voice>1</voice>${p.whole ? "" : `<type>${type}</type>${"<dot/>".repeat(dots)}`}${third ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : ""}${notations ? `<notations>${notations}</notations>` : ""}${lyric}</note>`;
  };

  const transposeXml = inst.transpose !== 0 ? `<transpose><diatonic>${Math.round(-inst.transpose * 7 / 12)}</diatonic><chromatic>${-inst.transpose}</chromatic>${inst.transpose === -12 ? "<octave-change>1</octave-change>" : ""}</transpose>` : "";
  const compound = sheet.grid.compound;
  const perMinute = Math.round(compound ? sheet.tempo / 3 : (sheet.tempo * 4) / d);
  const tempo = o.bare ? "" : `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>${compound ? "<beat-unit-dot/>" : ""}<per-minute>${perMinute}</per-minute></metronome></direction-type><sound tempo="${Math.round(compound ? perMinute * 1.5 : perMinute)}"/></direction>`;
  const intro = !o.bare && sheet.introBars > 0 ? `<direction placement="above"><direction-type><words>${sheet.introBars} ${sheet.introBars === 1 ? "bar" : "bars"} intro</words></direction-type></direction>` : "";
  const attributes = `<attributes><divisions>${TPQ}</divisions><key><fifths>${sp.fifths}</fifths><mode>${sp.mode}</mode></key><time><beats>${n}</beats><beat-type>${d}</beat-type></time><clef>${clef === "bass" ? "<sign>F</sign><line>4</line>" : "<sign>G</sign><line>2</line>"}</clef>${transposeXml}</attributes>`;

  const measures = sheet.measures.length ? sheet.measures : [{ start: 0, bar: 0, len: sheet.grid.barTicks, pickup: false, pieces: [{ start: 0, dur: sheet.grid.barTicks, rest: true, whole: true } as Piece] }];
  const pickup = measures[0].pickup;
  const body = measures.map((m, i) =>
    `<measure number="${pickup ? i : i + 1}"${m.pickup ? ' implicit="yes"' : ""}>${i === 0 ? attributes + tempo + intro : ""}${m.pieces.map(note).join("")}</measure>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
${o.bare ? "" : `<work><work-title>${esc(o.title)}</work-title></work>\n<identification>${o.artist ? `<creator type="composer">${esc(o.artist)}</creator>` : ""}<encoding><software>NoteAlong</software></encoding></identification>\n`}<part-list><score-part id="P1"><part-name>${esc(inst.name)}</part-name></score-part></part-list>
<part id="P1">
${body}
</part>
</score-partwise>
`;
}

/** The song as MusicXML. Without a score from the service the rhythm is worked out from the tempo, in 4/4. */
export function songToMusicXml(song: Song, instrumentId: string, keyShift: number, octaveShift: number, score?: ScoreData | null, wordText?: (w: Word) => string): string {
  const sheet = buildSheet(song, score ?? fallbackScore(song.tempo_bpm, song.duration), wordText);
  return sheetToMusicXml(sheet, { title: song.title, artist: song.artist, instrumentId, keyShift, octaveShift, key: song.key });
}

export function downloadText(filename: string, text: string, type = "application/octet-stream") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
