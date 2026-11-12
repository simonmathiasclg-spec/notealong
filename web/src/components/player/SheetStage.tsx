"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import type { DisplayNote } from "@/lib/notes";
import type { Sheet } from "@/lib/score";
import { createSheetEngine, cursorAt, measureSheet, type SheetEngine, type SheetLayout } from "@/lib/osmd";

export const ZOOM_MIN = 0.7, ZOOM_MAX = 2.2, ZOOM_STEP = 0.15;
export function clampZoom(z: number) { return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1)) * 100) / 100; }

type Props = {
  sheet: Sheet;
  /** The same MusicXML the export writes (without the title). */
  xml: string;
  /** Still waiting for the beats and chords from the service. */
  pending: boolean;
  noteInfo: Map<string, DisplayNote>;
  getTime: () => number;
  editing: boolean;
  /** The reader's zoom, 1 being the size that suits the window. */
  zoom: number;
  setZoom: (z: number) => void;
  /** Dark ink on a warm page, whatever the theme. */
  paper: boolean;
  /** Letter names inside the note heads. */
  letters: boolean;
  onSeek: (seconds: number) => void;
  onNoteClick?: (noteId: string, el: HTMLElement) => void;
};

/**
 * The song as a lead sheet: melody on a staff for the chosen instrument, words under the notes, chords above.
 * A line moves through the music in time, the note being played lights up, and the page scrolls so the line
 * being played stays near the top with what comes next below it.
 */
export function SheetStage(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLDivElement>(null);
  const engine = useRef<SheetEngine | null>(null);
  const layout = useRef<SheetLayout | null>(null);
  const [width, setWidth] = useState(0);
  const [drawn, setDrawn] = useState(0);
  const [failed, setFailed] = useState(false);
  const empty = p.sheet.measures.length === 0;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => { if (t) clearTimeout(t); t = setTimeout(() => setWidth(Math.round(el.clientWidth)), 140); });
    ro.observe(el);
    setWidth(Math.round(el.clientWidth));
    return () => { ro.disconnect(); if (t) clearTimeout(t); };
  }, []);

  // A phone gets a smaller staff than a desk, a desk smaller than a wide screen read from a music stand.
  const scale = Math.max(0.8, Math.min(1.65, width / 760)) * p.zoom;

  // ---- draw -------------------------------------------------------------
  const sheetRef = useRef(p.sheet);
  useEffect(() => { sheetRef.current = p.sheet; }, [p.sheet]);
  useEffect(() => {
    if (!width || !host.current || empty) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (!engine.current) {
          await document.fonts?.ready;
          if (cancelled || !host.current) return;
          engine.current = await createSheetEngine(host.current);
        }
        const osmd = engine.current;
        await osmd.load(p.xml);
        if (cancelled || !frame.current) return;
        osmd.zoom = scale;
        osmd.render();
        // the library paints its drawing black; let it take the ink colour of the page instead
        host.current?.querySelectorAll<SVGElement>("svg").forEach((el) => el.style.removeProperty("fill"));
        layout.current = measureSheet(osmd, sheetRef.current, frame.current);
        setFailed(false);
        setDrawn((n) => n + 1);
      } catch (e) {
        console.error("sheet music", e);
        if (!cancelled) setFailed(true);
      }
    }, engine.current ? 60 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [p.xml, width, scale, empty]);

  // ---- letter names in the note heads -----------------------------------
  useEffect(() => {
    const box = names.current, lay = layout.current;
    if (!box) return;
    box.replaceChildren();
    if (!p.letters || !lay) return;
    for (const a of lay.anchors) {
      if (a.rest || !a.id) continue;
      const piece = sheetRef.current.measures[a.m]?.pieces[a.i];
      if (piece?.tieStop) continue;
      const info = p.noteInfo.get(a.id);
      if (!info) continue;
      const s = document.createElement("span");
      s.textContent = info.label;
      s.dataset.open = a.open ? "1" : "0";
      s.style.left = `${a.x}px`; s.style.top = `${a.y}px`;
      s.style.fontSize = `${(a.head * (info.label.length > 1 ? 0.66 : 0.86)).toFixed(1)}px`;
      box.appendChild(s);
    }
  }, [drawn, p.letters, p.noteInfo]);

  // ---- follow the music ---------------------------------------------------
  const getTime = p.getTime;
  useEffect(() => {
    let raf = 0, lastAt = -2, lastSys = -1, lit: Element | null = null;
    const tick = () => {
      const lay = layout.current, bar = line.current, halo = glow.current, sc = scroller.current;
      if (lay && bar && halo && sc) {
        const c = cursorAt(lay, getTime());
        if (c) {
          const sys = lay.systems[c.sys];
          bar.style.opacity = "1";
          bar.style.transform = `translate(${c.x.toFixed(1)}px, ${(sys.top - lay.unit * 1.5).toFixed(1)}px)`;
          bar.style.height = `${(sys.height + lay.unit * 3).toFixed(1)}px`;
          if (c.at !== lastAt) {
            lastAt = c.at;
            lit?.classList.remove("is-now");
            const a = c.at >= 0 ? lay.anchors[c.at] : null;
            lit = a && !a.rest ? a.el : null;
            lit?.classList.add("is-now");
            if (a && !a.rest) {
              halo.style.opacity = "1";
              halo.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
              halo.style.width = halo.style.height = `${(lay.unit * 3.4).toFixed(1)}px`;
            } else halo.style.opacity = "0";
          }
          if (c.sys !== lastSys) {
            lastSys = c.sys;
            // the line being played sits at the top, with room for its chords; everything below is what comes next
            const top = Math.max(0, sys.top - lay.unit * 6);
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            sc.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); lit?.classList.remove("is-now"); };
  }, [getTime, drawn]);

  // ---- click: go there, or (while fixing) change that note ----------------
  const onClick = (e: React.MouseEvent) => {
    const lay = layout.current, fr = frame.current;
    if (!lay || !fr || !lay.anchors.length) return;
    const r = fr.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let sys = 0, best = Infinity;
    lay.systems.forEach((s, i) => { const d = Math.abs(y - (s.top + s.height / 2)); if (d < best) { best = d; sys = i; } });
    if (best > lay.unit * 9) return;
    const row = lay.anchors.filter((a) => a.sys === sys);
    if (p.editing) {
      let hit = null as (typeof row)[number] | null, near = lay.unit * 1.6;
      for (const a of row) { const d = Math.abs(a.x - x); if (!a.rest && a.id && a.el && d < near) { near = d; hit = a; } }
      if (hit?.id && hit.el) p.onNoteClick?.(hit.id, hit.el as unknown as HTMLElement);
      return;
    }
    // the note at or just before the click
    let at = row[0];
    for (const a of row) if (a.x <= x + lay.unit * 0.8) at = a;
    if (at) p.onSeek(Math.max(0, at.t));
  };

  const zoomBy = (d: number) => p.setZoom(clampZoom(p.zoom + d));
  return (
    <div className="relative h-full">
      <div ref={scroller} className="sheet-scroll h-full overflow-y-auto overflow-x-hidden px-2 pb-24 pt-2 sm:px-6">
        <div ref={frame} className={`sheet relative mx-auto ${p.paper ? "is-paper" : ""} ${p.editing ? "is-editing" : ""}`} onClick={onClick}
          role="img" aria-label="Sheet music for this song. The Letters view has the same notes as text.">
          <div ref={glow} className="sheet-glow" aria-hidden="true" />
          <div ref={host} className="sheet-host" />
          <div ref={names} className="sheet-names" aria-hidden="true" />
          <div ref={line} className="sheet-line" aria-hidden="true" />
          {empty && <div className="px-6 py-16 text-center text-muted">There are no notes to write out for this song yet.</div>}
        </div>
      </div>
      {(drawn === 0 || p.pending) && !empty && !failed && (
        <div className="floating pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 px-4 py-2 text-sm" role="status">
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {p.pending ? "Finding the beat and the chords…" : "Writing out the music…"}</span>
        </div>
      )}
      {failed && <div className="floating absolute left-1/2 top-1/3 -translate-x-1/2 px-4 py-2 text-sm text-danger" role="alert">The sheet music could not be drawn. The Letters view still works.</div>}
      <div className="no-print floating absolute bottom-3 right-3 flex items-center gap-0.5 rounded-full p-1 opacity-60 transition-opacity focus-within:opacity-100 hover:opacity-100 sm:right-5">
        <button className="btn btn-ghost btn-icon" onClick={() => zoomBy(-ZOOM_STEP)} disabled={p.zoom <= ZOOM_MIN} aria-label="Smaller notes" data-tip="Smaller"><Minus className="h-4 w-4" strokeWidth={1.8} /></button>
        <button className="tabular min-w-[3.1rem] rounded-full px-1 text-center text-[13px] font-medium text-muted hover:text-fg" onClick={() => p.setZoom(1)} aria-label="Back to the normal size" data-tip="Normal size">{Math.round(p.zoom * 100)}%</button>
        <button className="btn btn-ghost btn-icon" onClick={() => zoomBy(ZOOM_STEP)} disabled={p.zoom >= ZOOM_MAX} aria-label="Bigger notes" data-tip="Bigger"><Plus className="h-4 w-4" strokeWidth={1.8} /></button>
      </div>
    </div>
  );
}
