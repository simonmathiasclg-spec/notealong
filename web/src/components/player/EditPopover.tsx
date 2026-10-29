"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export type Anchor = { el: HTMLElement } | null;

function usePosition(anchor: Anchor) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!anchor) return setPos(null);
    const r = anchor.el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(window.innerWidth - 180, r.left + r.width / 2 - 85)), top: r.bottom + 8 });
  }, [anchor]);
  return pos;
}

export function NotePopover({ anchor, label, onUp, onDown, onDelete, onClose }: { anchor: Anchor; label: string; onUp: () => void; onDown: () => void; onDelete: () => void; onClose: () => void }) {
  const pos = usePosition(anchor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor.el.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); onUp(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); onDown(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDelete(); }
      else if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [anchor, onUp, onDown, onDelete, onClose]);
  if (!anchor || !pos) return null;
  return (
    <div ref={ref} className="card fixed z-40 flex items-center gap-1 p-1.5" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Edit note">
      <span className="px-2 font-display text-sm font-bold">{label}</span>
      <button className="btn btn-ghost btn-icon" onClick={onUp} title="Higher (↑)"><ArrowUp className="h-4 w-4" /></button>
      <button className="btn btn-ghost btn-icon" onClick={onDown} title="Lower (↓)"><ArrowDown className="h-4 w-4" /></button>
      <button className="btn btn-ghost btn-icon text-danger" onClick={onDelete} title="Remove (Delete)"><Trash2 className="h-4 w-4" /></button>
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
      className="card fixed z-40 flex items-center gap-2 p-1.5" style={{ left: pos.left, top: pos.top }}
      onSubmit={(e) => { e.preventDefault(); onSave(text.trim() || value); onClose(); }}
    >
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="w-36 rounded-lg border border-border bg-elev px-2 py-1 font-display text-sm font-bold" aria-label="Word text" />
      <button type="submit" className="btn btn-primary py-1 text-xs">Save</button>
      <button type="button" className="btn py-1 text-xs" onClick={() => { onAddNote(); onClose(); }} title="Add another note to this word"><Plus className="h-3.5 w-3.5" /> Note</button>
    </form>
  );
}
