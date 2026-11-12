"use client";
// Playing a setlist straight through: a thin bar shows where you are, and when a song ends the next
// one starts after the setlist's gap (a countdown you can skip or stop).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ListMusic, X } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me";

export function setlistSongHref(setId: string, songs: string[], pos: number, autoplay = true) {
  return `/songs/${songs[pos]}?setlist=${setId}&pos=${pos}${autoplay ? "&autoplay=1" : ""}`;
}

export function SetlistBar({ songId, ended, ready, onAutoplay }: { songId: string; ended: number; ready: boolean; onAutoplay: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const { setlists } = useMe();
  const setId = params.get("setlist");
  const sl = setlists.find((s) => s.id === setId);
  const pos = Math.max(0, parseInt(params.get("pos") ?? "0", 10) || 0);
  const autoplay = params.get("autoplay") === "1";
  const [count, setCount] = useState<number | null>(null);
  const [nextTitle, setNextTitle] = useState<string | null>(null);
  const started = useRef(false);
  const [seenEnded, setSeenEnded] = useState(ended);

  const valid = !!sl && sl.songs[pos] === songId;
  const next = valid && pos + 1 < sl!.songs.length ? pos + 1 : null;
  const nextId = next !== null ? sl!.songs[next] : null;
  useEffect(() => {
    if (!nextId) return;
    let off = false;
    api.getSong(nextId).then((s) => { if (!off) setNextTitle(s.title); }).catch(() => undefined);
    return () => { off = true; };
  }, [nextId]);

  // start this song by itself when it was reached by playing the setlist through
  useEffect(() => {
    if (valid && autoplay && ready && !started.current) { started.current = true; onAutoplay(); }
  }, [valid, autoplay, ready, onAutoplay]);

  // the song ended: count down the gap, then go on
  if (ended !== seenEnded) {
    setSeenEnded(ended);
    if (valid && next !== null) setCount(sl!.gap_seconds);
  }
  useEffect(() => {
    if (count === null) return;
    const t = setTimeout(() => {
      if (count <= 1) { setCount(null); router.push(setlistSongHref(sl!.id, sl!.songs, next!)); }
      else setCount(count - 1);
    }, count <= 0 ? 0 : 1000);
    return () => clearTimeout(t);
  }, [count, router, sl, next]);

  if (!valid) return null;
  return (
    <>
      <div className="no-print mx-3 flex items-center gap-2 border-y border-border px-1 py-1.5 text-[13px] sm:mx-6">
        <ListMusic className="h-4 w-4 text-accent" />
        <Link href={`/setlists/${sl!.id}`} className="truncate font-medium hover:underline">{sl!.name}</Link>
        <span className="text-muted">{pos + 1} of {sl!.songs.length}</span>
        <span className="flex-1" />
        <button className="btn btn-ghost btn-sm" disabled={pos === 0} onClick={() => router.push(setlistSongHref(sl!.id, sl!.songs, pos - 1))} aria-label="Previous song in the setlist"><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn btn-ghost btn-sm" disabled={next === null} onClick={() => router.push(setlistSongHref(sl!.id, sl!.songs, next!))} aria-label="Next song in the setlist">{nextTitle ? <span className="hidden max-w-[12rem] truncate sm:inline">Next: {nextTitle}</span> : null}<ChevronRight className="h-4 w-4" /></button>
      </div>
      {count !== null && (
        <div className="fixed inset-x-0 bottom-28 z-40 flex justify-center px-4" role="status" aria-live="polite">
          <div className="floating flex items-center gap-3 px-4 py-3 text-sm">
            <span>Next: <span className="font-semibold">{nextTitle ?? "the next song"}</span> in {count}</span>
            <button className="btn btn-primary btn-sm" onClick={() => { setCount(null); router.push(setlistSongHref(sl!.id, sl!.songs, next!)); }}>Play now</button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCount(null)} aria-label="Stop the setlist here"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </>
  );
}
