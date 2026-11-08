"use client";
// The one search box: on every page, searching built-in songs and your own together. Typing anywhere
// opens /browse; on /browse it updates the results as you type. "/" focuses it.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export function HeaderSearch({ className = "" }: { className?: string }) {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const onBrowse = path === "/browse";
  const urlQ = onBrowse ? params.get("q") ?? "" : "";
  const [value, setValue] = useState(urlQ);
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) { setLastUrlQ(urlQ); setValue(urlQ); }   // follow back/forward and "Clear"
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (v: string) => {
    setValue(v);
    const p = onBrowse ? new URLSearchParams(params.toString()) : new URLSearchParams();
    if (v.trim()) p.set("q", v); else p.delete("q");
    const url = `/browse${p.toString() ? `?${p}` : ""}`;
    if (onBrowse) router.replace(url, { scroll: false });
    else if (v.trim()) router.push(url);
  };
  return (
    <label className={`relative block ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        ref={input} value={value} onChange={(e) => update(e.target.value)} autoFocus={onBrowse && !!urlQ}
        placeholder="Search songs, artists, words" aria-label="Search all songs" className="field w-full pl-10 pr-9"
        onKeyDown={(e) => { if (e.key === "Enter" && !onBrowse) update(value); if (e.key === "Escape") update(""); }}
      />
      {value && <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-fg" onClick={() => update("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
    </label>
  );
}
