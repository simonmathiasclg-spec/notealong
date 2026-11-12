"use client";
// The song that keeps playing while you browse, as a small widget in the corner: its artwork as the surface,
// the title scrolling like a marquee, the artist small underneath, a round play button and a hairline of
// progress. Click it to go back to the song (the same audio carries on); the cross stops it.
import { useRouter, usePathname } from "next/navigation";
import { ViewTransition, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { artField, artHint, artName } from "@/components/art/Art";
import { PauseGlyph, PlayGlyph, WaveGlyph } from "@/components/art/Glyphs";
import { nowPlaying, useNowPlaying, type Parked } from "@/lib/nowPlaying";
import type { EngineState } from "@/lib/audio";

export function MiniPlayer() {
  const p = useNowPlaying();
  const path = usePathname();
  const hidden = !p || path === `/songs/${p.id}` || path.startsWith(`/songs/${p.id}/`);
  return (
    <AnimatePresence>
      {p && !hidden && <Widget key={p.id} p={p} />}
    </AnimatePresence>
  );
}

/** `p` is the song as it was when the widget appeared, so it can still animate out after the song moves on. */
function Widget({ p }: { p: Parked }) {
  const router = useRouter();
  const [state, setState] = useState<EngineState | null>(null);
  const [morph, setMorph] = useState(false);
  const fill = useRef<HTMLSpanElement>(null);
  const titleBox = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  useEffect(() => { const el = titleBox.current; if (el) setLong(el.scrollWidth > el.clientWidth + 1); }, [p.title]);
  const head = useRef<HTMLSpanElement>(null);
  useEffect(() => p.engine.subscribe(setState), [p.engine]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pct = p.duration ? Math.min(100, (p.engine.currentTime / p.duration) * 100) : 0;
      if (fill.current) fill.current.style.width = `${pct}%`;
      if (head.current) head.current.style.left = `${pct}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p]);
  const playing = !!state?.playing;
  const open = () => {
    artHint.set(p.id, { src: p.cover, colors: p.colors });
    flushSync(() => setMorph(true));
    router.push(`/songs/${p.id}`);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="no-print fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-40 w-[calc(100%-1.5rem)] max-w-[22rem] sm:bottom-6 sm:right-6"
      role="region" aria-label={`Now playing: ${p.title}`}
    >
      <div className="art-surface grain squircle h-[8.25rem] w-full shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)]" style={{ background: artField(p.colors) }}>
        <ViewTransition name={morph ? artName(p.id) : "mini-art"} share="art-morph" default="none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.cover} alt="" className="art squircle" style={{ filter: "blur(2px) saturate(1.1)" }} />
        </ViewTransition>
        <button className="absolute inset-0 z-[1] cursor-pointer" onClick={open} aria-label={`Back to ${p.title}`} />
        <div className="pointer-events-none relative z-[2] flex h-full flex-col p-5 pb-4">
          <div className="flex items-start gap-3">
            <WaveGlyph on={playing} className="mt-0.5 text-[13px]" />
            <span className="ml-auto" />
          </div>
          <div className="mt-auto flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <span ref={titleBox} className="marquee block text-[15px] font-medium leading-tight" data-run={playing && long ? "1" : "0"} style={{ "--marquee-s": "11s" } as React.CSSProperties}>
                <span>{p.title}{long && <span aria-hidden="true" className="pl-[2.5em]">{p.title}</span>}</span>
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] uppercase tracking-[0.08em] text-white/65">{p.artist}</span>
            </div>
          </div>
          <div className="relative mt-3 h-px w-full bg-white/30">
            <span ref={fill} className="absolute left-0 top-0 h-px bg-white" />
            <span ref={head} className="absolute -top-[7px] h-[8px] w-px bg-white" />
          </div>
        </div>
        <button onClick={() => (playing ? p.engine.pause() : p.engine.play())} aria-label={playing ? "Pause" : "Play"}
          className="absolute right-5 top-1/2 z-[3] grid h-12 w-12 -translate-y-[62%] place-items-center rounded-full bg-white/85 transition hover:scale-105" style={{ color: p.colors?.deep ?? "#111" }}>
          {playing ? <PauseGlyph className="h-[18px] w-[18px]" /> : <PlayGlyph className="ml-0.5 h-[18px] w-[18px]" />}
        </button>
        <button onClick={() => nowPlaying.stop()} aria-label="Stop and close"
          className="absolute right-3 top-3 z-[3] grid h-7 w-7 place-items-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </motion.div>
  );
}
