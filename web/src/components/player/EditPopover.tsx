"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Flag, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Link2, Plus, Scissors, Trash2 } from "lucide-react";

export type Anchor = { el: HTMLElement } | null;

function usePosition(anchor: Anchor) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!anchor) return setPos(null);
    const r = anchor.el.getBoundingClientRect();
    // above the chip, so the word under it stays readable
    setPos({ left: Math.max(8, Math.min(window.innerWidth - 200, r.left + r.width / 2 - 95)), top: Math.max(8, r.top - 58) });
  }, [anchor]);
  return pos;
}

export type NoteTiming = { start: number; end: number; prevEnd: number | null; nextStart: number | null };

/** A strip showing the note between its neighbours, with handles to drag its start and end. */
function TimingStrip({ t, onRetime }: { t: NoteTiming; onRetime: (start: number, end: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const lo = Math.min(t.prevEnd ?? t.start - 0.6, t.start - 0.3);
  const hi = Math.max(t.nextStart ?? t.end + 0.6, t.end + 0.3);
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const drag = (which: "start" | "end" | "both") => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const x0 = e.clientX;
    const s0 = t.start, e0 = t.end;
    const move = (ev: PointerEvent) => {
      const dt = Math.round((((ev.clientX - x0) / box.width) * (hi - lo)) * 100) / 100;   // 10 ms steps
      if (which === "start") onRetime(Math.min(s0 + dt, e0 - 0.05), e0);
      else if (which === "end") onRetime(s0, Math.max(e0 + dt, s0 + 0.05));
      else onRetime(s0 + dt, e0 + dt);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={ref} className="relative mx-1 h-7 w-full select-none rounded-lg bg-sunken" aria-label="Timing: drag the ends to change when the note starts and stops">
      {t.prevEnd !== null && <div className="absolute inset-y-2 left-0 rounded bg-border" style={{ width: x(t.prevEnd) }} />}
      {t.nextStart !== null && <div className="absolute inset-y-2 right-0 rounded bg-border" style={{ left: x(t.nextStart) }} />}
      <div className="absolute inset-y-1 cursor-grab rounded-md bg-accent/70" style={{ left: x(t.start), width: `calc(${x(t.end)} - ${x(t.start)})` }} onPointerDown={drag("both")} />
      <div role="slider" aria-label="Note start" aria-valuenow={Math.round(t.start * 100) / 100} tabIndex={0}
        className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-accent" style={{ left: x(t.start) }} onPointerDown={drag("start")} />
      <div role="slider" aria-label="Note end" aria-valuenow={Math.round(t.end * 100) / 100} tabIndex={0}
        className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded bg-accent" style={{ left: x(t.end) }} onPointerDown={drag("end")} />
    </div>
  );
}

export function NotePopover({ anchor, label, timing, onUp, onDown, onDelete, onClose, onRetime, onNudge, onSplit, onJoin, onShiftLine, flagged, onFlag }: {
  anchor: Anchor; label: string; timing?: NoteTiming | null; onUp: () => void; onDown: () => void; onDelete: () => void; onClose: () => void;
  onRetime?: (start: number, end: number) => void; onNudge?: (delta: number) => void; onSplit?: () => void; onJoin?: () => void; onShiftLine?: (delta: number) => void; flagged?: boolean; onFlag?: () => void;
}) {
  const pos = usePosition(anchor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor.el.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); onUp(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); onDown(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onNudge?.(e.shiftKey ? -0.01 : -0.05); }
      else if (e.key === "ArrowRight") { e.preventDefault(); onNudge?.(e.shiftKey ? 0.01 : 0.05); }
      else if (e.key === "[") { e.preventDefault(); onShiftLine?.(-0.05); }
      else if (e.key === "]") { e.preventDefault(); onShiftLine?.(0.05); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); onSplit?.(); }
      else if (e.key === "j" || e.key === "J") { e.preventDefault(); onJoin?.(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDelete(); }
      else if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [anchor, onUp, onDown, onDelete, onClose, onNudge, onShiftLine, onSplit, onJoin]);
  if (!anchor || !pos) return null;
  return (
    <div ref={ref} className="floating fixed z-40 w-[19rem] p-1.5" style={{ left: Math.min(pos.left, window.innerWidth - 320), top: Math.max(8, pos.top - 74) }} role="dialog" aria-label="Change this note">
      <div className="flex items-center gap-1">
        <span className="px-2.5 text-sm font-bold">{label}</span>
        <button className="btn btn-ghost btn-icon" onClick={onUp} data-tip="Higher (↑)" aria-label="Higher"><ArrowUp className="h-4 w-4" /></button>
        <button className="btn btn-ghost btn-icon" onClick={onDown} data-tip="Lower (↓)" aria-label="Lower"><ArrowDown className="h-4 w-4" /></button>
        {onSplit && <button className="btn btn-ghost btn-icon" onClick={onSplit} data-tip="Split in two (S)" aria-label="Split in two"><Scissors className="h-4 w-4" /></button>}
        {onJoin && <button className="btn btn-ghost btn-icon" onClick={onJoin} data-tip="Join with the next note (J)" aria-label="Join with the next note"><Link2 className="h-4 w-4" /></button>}
        <span className="flex-1" />
        {onFlag && <button className={`btn btn-ghost btn-icon ${flagged ? "text-danger" : ""}`} onClick={onFlag} aria-pressed={!!flagged} data-tip={flagged ? "Marked as sounding wrong (W to undo)" : "This note sounds wrong (W)"} aria-label="This note sounds wrong"><Flag className="h-4 w-4" /></button>}
        <button className="btn btn-ghost btn-icon text-danger" onClick={onDelete} data-tip="Remove (Delete)" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
      </div>
      {timing && onRetime && (
        <div className="mt-1.5 space-y-1.5 px-1 pb-1">
          <TimingStrip t={timing} onRetime={onRetime} />
          <div className="flex items-center justify-between gap-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <button className="btn btn-ghost btn-sm h-7 px-2" onClick={() => onNudge?.(-0.05)} data-tip="Earlier (←)" aria-label="Note earlier"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="tabular">{(timing.end - timing.start).toFixed(2)} s</span>
              <button className="btn btn-ghost btn-sm h-7 px-2" onClick={() => onNudge?.(0.05)} data-tip="Later (→)" aria-label="Note later"><ChevronRight className="h-3.5 w-3.5" /></button>
            </span>
            {onShiftLine && (
              <span className="flex items-center gap-1">
                <span>Line</span>
                <button className="btn btn-ghost btn-sm h-7 px-2" onClick={() => onShiftLine(-0.05)} data-tip="Whole line earlier ([)" aria-label="Whole line earlier"><ChevronsLeft className="h-3.5 w-3.5" /></button>
                <button className="btn btn-ghost btn-sm h-7 px-2" onClick={() => onShiftLine(0.05)} data-tip="Whole line later (])" aria-label="Whole line later"><ChevronsRight className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Outside "fix notes": a tap on a note offers one thing, to mark it as sounding wrong. */
export function FlagPopover({ anchor, flagged, onFlag, onClose }: { anchor: Anchor; flagged: boolean; onFlag: () => void; onClose: () => void }) {
  const pos = usePosition(anchor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor.el.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [anchor, onClose]);
  if (!anchor || !pos) return null;
  return (
    <div ref={ref} role="dialog" aria-label="Mark this note" className="floating fixed z-50 p-1.5" style={{ left: pos.left, top: pos.top + 8 }}>
      <button className="btn btn-ghost btn-sm gap-2" onClick={onFlag} autoFocus>
        <Flag className={`h-4 w-4 ${flagged ? "text-danger" : ""}`} />
        {flagged ? "Remove the mark" : "This note sounds wrong"}
      </button>
    </div>
  );
}

export function WordPopover({ anchor, value, onSave, onAddNote, onClose }: { anchor: Anchor; value: string; onSave: (text: string) => void; onAddNote: () => void; onClose: () => void }) {
  const pos = usePosition(anchor);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => setText(value), [value, anchor]);
  useEffect(() => {
    if (!anchor) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor.el.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [anchor, onClose]);
  if (!anchor || !pos) return null;
  return (
    <form
      ref={ref}
      className="floating fixed z-40 flex items-center gap-2 p-1.5" style={{ left: pos.left, top: pos.top }}
      onSubmit={(e) => { e.preventDefault(); onSave(text.trim() || value); onClose(); }}
      aria-label="Fix this word"
    >
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="field h-9 w-40 rounded-xl text-sm font-medium" aria-label="Word" />
      <button type="submit" className="btn btn-primary btn-sm">Save</button>
      <button type="button" className="btn btn-sm" onClick={() => { onAddNote(); onClose(); }} data-tip="Add another note to this word"><Plus className="h-3.5 w-3.5" /> Note</button>
    </form>
  );
}
