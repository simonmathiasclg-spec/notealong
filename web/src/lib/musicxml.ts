/**
 * MusicXML export. We do not know the rhythm, so note lengths are approximated
 * from their real duration at the song's tempo and quantized to 16ths in 4/4.
 * Written pitches are used, with a <transpose> element so MuseScore knows the
 * concert pitch.
 */
import { getInstrument } from "./instruments";
import { writtenMidi } from "./notes";
import type { Note, Song } from "./types";

const STEP = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const DIVISIONS = 4; // per quarter note

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function typeFor(dur: number): string {
  if (dur >= 16) return "whole";
  if (dur >= 8) return "half";
  if (dur >= 4) return "quarter";
  if (dur >= 2) return "eighth";
  return "16th";
}

export function songToMusicXml(song: Song, instrumentId: string, keyShift: number, octaveShift: number): string {
  const inst = getInstrument(instrumentId);
  const bpm = song.tempo_bpm && song.tempo_bpm > 0 ? song.tempo_bpm : 100;
  const secPerDiv = 60 / bpm / DIVISIONS;
  const wordText = new Map(song.words.map((w) => [w.id, w.text]));
  const notes = [...song.notes].sort((a, b) => a.start - b.start);
  const measureLen = 16; // divisions per 4/4 bar

  // Build a timeline of events (rest or note) in divisions.
  type Ev = { kind: "note" | "rest"; dur: number; note?: Note };
  const events: Ev[] = [];
  let cursor = 0;
  for (const n of notes) {
    const start = Math.round(n.start / secPerDiv);
    const end = Math.max(start + 1, Math.round(n.end / secPerDiv));
    if (start > cursor) events.push({ kind: "rest", dur: start - cursor });
    if (start < cursor) continue; // overlapping (should not happen after cleanup)
    events.push({ kind: "note", dur: end - start, note: n });
    cursor = end;
  }

  // Split events across bar lines.
  const measures: string[][] = [];
  let bar: string[] = [];
  let pos = 0;
  const push = (ev: Ev, dur: number, tieStart: boolean, tieStop: boolean) => {
    if (ev.kind === "rest") {
      bar.push(`<note><rest/><duration>${dur}</duration><type>${typeFor(dur)}</type></note>`);
      return;
    }
    const n = ev.note!;
    const w = writtenMidi(n.midi, inst, keyShift, octaveShift);
    const pc = ((w % 12) + 12) % 12;
    const octave = Math.floor(w / 12) - 1;
    const lyric = !tieStop && n.word && wordText.get(n.word) ? `<lyric><syllabic>single</syllabic><text>${esc(wordText.get(n.word)!)}</text></lyric>` : "";
    const ties = `${tieStart ? "<tie type=\"start\"/>" : ""}${tieStop ? "<tie type=\"stop\"/>" : ""}`;
    const notations = tieStart || tieStop ? `<notations>${tieStart ? "<tied type=\"start\"/>" : ""}${tieStop ? "<tied type=\"stop\"/>" : ""}</notations>` : "";
    bar.push(`<note><pitch><step>${STEP[pc]}</step>${ALTER[pc] ? `<alter>${ALTER[pc]}</alter>` : ""}<octave>${octave}</octave></pitch><duration>${dur}</duration>${ties}<type>${typeFor(dur)}</type>${notations}${lyric}</note>`);
  };
  for (const ev of events) {
    let remaining = ev.dur;
    let first = true;
    while (remaining > 0) {
      const space = measureLen - pos;
      const take = Math.min(space, remaining);
      const tieStop = ev.kind === "note" && !first;
      const tieStart = ev.kind === "note" && remaining > take;
      push(ev, take, tieStart, tieStop);
      remaining -= take;
      pos += take;
      first = false;
      if (pos >= measureLen) { measures.push(bar); bar = []; pos = 0; }
    }
  }
  if (bar.length) { if (pos < measureLen) bar.push(`<note><rest/><duration>${measureLen - pos}</duration><type>${typeFor(measureLen - pos)}</type></note>`); measures.push(bar); }
  if (!measures.length) measures.push([`<note><rest/><duration>16</duration><type>whole</type></note>`]);

  const fifthsTable = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
  const keyTonic = song.key ? (((song.key.tonic + keyShift + inst.transpose) % 12) + 12) % 12 : 0;
  const fifths = song.key ? fifthsTable[song.key.mode === "minor" ? (keyTonic + 3) % 12 : keyTonic] : 0;
  const transposeXml = inst.transpose !== 0 ? `<transpose><diatonic>${Math.round(-inst.transpose * 7 / 12)}</diatonic><chromatic>${-inst.transpose}</chromatic>${inst.transpose === -12 ? "<octave-change>1</octave-change>" : ""}</transpose>` : "";

  const body = measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${song.key?.mode ?? "major"}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${transposeXml}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>` : ""}${m.join("")}</measure>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${esc(song.title)}</work-title></work>
<identification>${song.artist ? `<creator type="composer">${esc(song.artist)}</creator>` : ""}<encoding><software>NoteAlong</software></encoding></identification>
<part-list><score-part id="P1"><part-name>${esc(inst.name)}</part-name></score-part></part-list>
<part id="P1">
${body}
</part>
</score-partwise>
`;
}

export function downloadText(filename: string, text: string, type = "application/octet-stream") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
