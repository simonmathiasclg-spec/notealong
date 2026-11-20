"use client";
// "Add to setlist": a small menu of your setlists, with a way to start a new one.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ListMusic, Plus } from "lucide-react";
import { useMe } from "@/lib/me";

export function AddToSetlistButton({ songId, title, variant = "icon" }: { songId: string; title: string; variant?: "icon" | "button" }) {
  const { setlists, addToSetlist, createSetlist, signedIn, nudge } = useMe();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setNaming(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setNaming(false); } };
    window.addEventListener("mousedown", close); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = () => { if (signedIn === false) { nudge("Sign in to make setlists."); return; } setOpen((o) => !o); };
  const add = (id: string, setName: string) => { addToSetlist(id, songId); setDone(setName); setTimeout(() => { setOpen(false); setDone(null); }, 900); };
  const create = async () => {
    const n = name.trim() || "My setlist";
    const s = await createSetlist(n, [songId]);
    if (s) { setDone(s.name); setName(""); setNaming(false); setTimeout(() => { setOpen(false); setDone(null); }, 900); }
  };
  return (
    <div ref={box} className="relative">
      {variant === "icon"
        ? <button className="btn btn-ghost btn-icon" onClick={toggle} aria-expanded={open} aria-label={`Add ${title} to a setlist`} data-tip="Add to a setlist" data-tip-pos="below"><ListMusic className="h-[18px] w-[18px]" /></button>
        : <button className="btn" onClick={toggle} aria-expanded={open}><ListMusic className="h-4 w-4" /> Add to setlist</button>}
      {open && (
        <div className="floating absolute right-0 top-full z-50 mt-2 w-64 p-1.5 text-sm" role="menu">
          {done ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-muted" role="status"><Check className="h-4 w-4 text-accent" /> Added to {done}</div>
          ) : (
            <>
              {setlists.length === 0 && !naming && <div className="px-3 py-2 text-muted">No setlists yet.</div>}
              {setlists.map((s) => {
                const has = s.songs.includes(songId);
                return (
                  <button key={s.id} role="menuitem" disabled={has} onClick={() => add(s.id, s.name)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover disabled:opacity-60">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-faint">{has ? "Already in" : `${s.songs.length} songs`}</span>
                  </button>
                );
              })}
              <div className="my-1 border-t border-border" />
              {naming ? (
                <form className="flex gap-1.5 p-1.5" onSubmit={(e) => { e.preventDefault(); create(); }}>
                  <input autoFocus className="field h-9 min-w-0 flex-1 text-sm" placeholder="Name, e.g. Sunday gig" value={name} onChange={(e) => setName(e.target.value)} />
                  <button className="btn btn-primary btn-sm" type="submit">Create</button>
                </form>
              ) : (
                <button role="menuitem" onClick={() => setNaming(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover"><Plus className="h-4 w-4" /> New setlist</button>
              )}
              <Link href="/setlists" className="block rounded-lg px-3 py-2 text-xs text-muted hover:bg-hover hover:text-fg">Manage setlists</Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
