/**
 * Draws the sheet music with OpenSheetMusicDisplay (BSD-3-Clause, see catalog/LICENSES.md).
 *
 * The library is large, so it is only fetched when a sheet is first shown. It draws the same MusicXML the
 * app exports (lib/musicxml.ts), which keeps the screen, the printed page and the file identical.
 */
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { Sheet } from "./score";

export type SheetEngine = OpenSheetMusicDisplay;

/** Ticks in a whole note (24 to a quarter). */
const WHOLE = 96;

export async function createSheetEngine(host: HTMLElement, o: { print?: boolean } = {}): Promise<SheetEngine> {
  const { OpenSheetMusicDisplay: Osmd } = await import("opensheetmusicdisplay");
  const osmd = new Osmd(host, {
    backend: "svg",
    autoResize: false,
    autoBeam: true,
    disableCursor: true,
    drawTitle: !!o.print, drawComposer: !!o.print, drawSubtitle: false, drawLyricist: false, drawCredits: !!o.print,
    drawPartNames: false, drawPartAbbreviations: false,
    drawMeasureNumbers: true, drawMeasureNumbersOnlyAtSystemStart: true,
    autoGenerateMultipleRestMeasuresFromRestMeasures: false,
    defaultFontFamily: "Archivo Variable, Archivo, Arial Narrow, sans-serif",
    pageFormat: o.print ? "A4_P" : "Endless",
    drawingParameters: "default",
  });
  const r = osmd.EngravingRules;
  r.PageLeftMargin = o.print ? 6 : 0.6;
  r.PageRightMargin = o.print ? 6 : 0.6;
  r.PageTopMargin = o.print ? 6 : 1;
  r.PageBottomMargin = o.print ? 6 : 1;
  r.MinimumDistanceBetweenSystems = 5;
  r.MinSkyBottomDistBetweenSystems = 2.5;
  r.ChordSymbolTextHeight = 2.3;
  r.LyricsHeight = 2.1;
  // whole words sit under their first note, so long words need more room than the library's default gives them
  r.LyricsXPaddingFactorForLongLyrics = 1.35;
  r.HorizontalBetweenLyricsDistance = 0.5;
  return osmd;
}

/** Where one written note or rest was drawn, in pixels from the top left of `frame`. */
export type Anchor = {
  /** Index of the bar and of the piece in it (sheet.measures[m].pieces[i]). */
  m: number; i: number;
  /** Song seconds at which it starts and ends. */
  t: number; end: number;
  rest: boolean;
  id: string | null;
  /** Middle of the note head (or of the rest). */
  x: number; y: number;
  /** Height of the note head. */
  head: number;
  /** A half or whole note: the head is open. */
  open: boolean;
  /** Which line of music it is on, and that staff's top and height. */
  sys: number; top: number; height: number;
  el: Element | null;
};
export type SheetLayout = {
  anchors: Anchor[];
  /** For every line of music: where it ends on the page and in the song. */
  systems: { top: number; height: number; left: number; right: number; start: number; end: number }[];
  /** Pixels in one staff space. */
  unit: number;
};

type Box = { AbsolutePosition: { x: number; y: number }; Size: { width: number; height: number } };
type GNote = { getSVGGElement?: () => Element | null; getNoteheadSVGs?: () => Element[] };
type GEntry = { relInMeasureTimestamp?: { RealValue: number }; graphicalVoiceEntries?: { notes?: GNote[] }[] };
type GMeasure = { staffEntries: GEntry[]; PositionAndShape: Box; ParentMusicSystem?: object; parentMusicSystem?: object };

/**
 * After a render: finds every piece of the sheet in the drawing. Pieces are matched to what was drawn by
 * their place in the bar, so a piece the library left out (it never should) is skipped, not mismatched.
 */
export function measureSheet(osmd: SheetEngine, sheet: Sheet, frame: HTMLElement): SheetLayout {
  const svg = frame.querySelector("svg");
  const out: SheetLayout = { anchors: [], systems: [], unit: 10 * osmd.zoom };
  if (!svg) return out;
  const f = frame.getBoundingClientRect(), s = svg.getBoundingClientRect();
  const ox = s.left - f.left, oy = s.top - f.top, unit = out.unit;
  const list = (osmd.GraphicSheet?.MeasureList ?? []) as unknown as GMeasure[][];
  const sysIndex = new Map<object, number>();
  sheet.measures.forEach((bar, m) => {
    const gm = list[m]?.[0];
    if (!gm) return;
    const system = gm.ParentMusicSystem ?? gm.parentMusicSystem ?? gm;
    const box = gm.PositionAndShape;
    const left = ox + box.AbsolutePosition.x * unit, right = left + box.Size.width * unit;
    const top = oy + box.AbsolutePosition.y * unit, height = 4 * unit;
    const barEnd = sheet.grid.time(bar.start + bar.len);
    let sys = sysIndex.get(system);
    if (sys === undefined) {
      sys = out.systems.length; sysIndex.set(system, sys);
      out.systems.push({ top, height, left, right, start: sheet.grid.time(bar.start), end: barEnd });
    } else { out.systems[sys].right = right; out.systems[sys].end = barEnd; }
    const offset = bar.start - bar.bar;
    bar.pieces.forEach((p, i) => {
      const at = (p.start - offset) / WHOLE;
      const entry = gm.staffEntries.find((e) => Math.abs((e.relInMeasureTimestamp?.RealValue ?? -1) - at) < 0.5 / WHOLE);
      const gn = entry?.graphicalVoiceEntries?.[0]?.notes?.[0];
      let el: Element | null = null, headEl: Element | null = null;
      try { el = gn?.getSVGGElement?.() ?? null; headEl = (!p.rest && gn?.getNoteheadSVGs?.()[0]) || el; } catch { /* drawn without a group */ }
      const r = headEl?.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return;
      const written = p.tuplet ? (p.dur * 3) / 2 : p.dur;
      out.anchors.push({
        m, i, t: sheet.grid.time(bar.bar + p.start), end: sheet.grid.time(bar.bar + p.start + p.dur), rest: p.rest, id: p.id ?? null,
        x: r.left - f.left + r.width / 2, y: r.top - f.top + r.height / 2, head: p.rest ? unit : r.height, open: written >= 48,
        sys, top, height, el,
      });
    });
  });
  return out;
}

/** Index of the last anchor that has started at time t, or -1. */
export function anchorAt(anchors: Anchor[], t: number): number {
  let lo = 0, hi = anchors.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (anchors[mid].t <= t) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

/** Where the playback line stands at time t: which line of music and how far along it. */
export function cursorAt(layout: SheetLayout, t: number): { sys: number; x: number; at: number } | null {
  const { anchors, systems } = layout;
  if (!anchors.length) return null;
  const i = anchorAt(anchors, t);
  if (i < 0) { const a = anchors[0]; return { sys: a.sys, x: Math.max(systems[a.sys].left, a.x - Math.min(1, (a.t - t) / 2) * (a.x - systems[a.sys].left)), at: -1 }; }
  const a = anchors[i], next = anchors[i + 1];
  // to the next note on the same line, otherwise to the end of the line
  const [toT, toX] = next && next.sys === a.sys ? [next.t, next.x] : [systems[a.sys].end, systems[a.sys].right];
  const k = toT > a.t ? Math.max(0, Math.min(1, (t - a.t) / (toT - a.t))) : 0;
  return { sys: a.sys, x: a.x + (toX - a.x) * k, at: i };
}
