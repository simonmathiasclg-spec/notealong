"use client";
// The ring of songs at the top of Discover: portrait cards on a curved wall in perspective, the one in the
// middle facing you. Drag or swipe it, use the arrow keys or the round buttons, or click a card at the side to
// bring it round; click the one in the middle to play along. Spring physics throughout; the picture inside each
// card drifts a little against its turn (parallax). Reduced motion: it moves without animating.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ViewTransition, useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ArtImage, artField, artHint, artName, type TileSong } from "@/components/art/Art";
import { PlayGlyph } from "@/components/art/Glyphs";

const STEP = 24;          // degrees between cards
const VISIBLE = 3.6;      // cards shown either side of the middle

export type FlowSong = TileSong & { kind: string };

function wrapDelta(i: number, p: number, n: number): number {
  let d = (((i - p) % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

export function Coverflow({ songs, hint }: { songs: FlowSong[]; hint?: string }) {
  const n = songs.length;
  const pos = useMotionValue(0);
  const reduced = useReducedMotion();
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [index, setIndex] = useState(0);
  useMotionValueEvent(pos, "change", (v) => { const i = ((Math.round(v) % n) + n) % n; setIndex((c) => (c === i ? c : i)); });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const card = Math.round(Math.min(300, Math.max(190, width * 0.21)));
  const geo = { card, radius: Math.max(card * 2.5, Math.min(card * 2.9, width * 0.53)), depth: card * 3.4 };

  const go = useCallback((target: number) => {
    if (reduced) { pos.set(target); return; }
    animate(pos, target, { type: "spring", stiffness: 210, damping: 30, mass: 0.9 });
  }, [pos, reduced]);
  const step = useCallback((dir: number) => go(Math.round(pos.get()) + dir), [go, pos]);

  // drag / swipe
  const drag = useRef<{ x: number; p: number; moved: number; t: number; lastX: number; lastT: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pos.stop();
    drag.current = { x: e.clientX, p: pos.get(), moved: 0, t: performance.now(), lastX: e.clientX, lastT: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    d.moved = Math.max(d.moved, Math.abs(dx));
    if (d.moved > 6 && !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    d.lastT = performance.now(); d.lastX = e.clientX;
    pos.set(d.p - dx / (geo.card * 0.95));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved <= 6) return;
    const dt = Math.max(16, performance.now() - d.t);
    const v = (e.clientX - d.x) / dt;                         // px per ms over the whole drag
    const flick = Math.abs(v) > 0.5 ? -Math.sign(v) * Math.min(3, Math.abs(v) * 1.6) : 0;
    go(Math.round(pos.get() + flick));
    // the click that ends a drag must not open a song
    const stop = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); window.removeEventListener("click", stop, true); };
    window.addEventListener("click", stop, true);
    setTimeout(() => window.removeEventListener("click", stop, true), 0);
  };
  // trackpads: a sideways scroll turns the ring
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      wheelAcc.current += e.deltaX;
      if (Math.abs(wheelAcc.current) > 60) { step(Math.sign(wheelAcc.current)); wheelAcc.current = 0; }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [step]);

  const open = (s: FlowSong) => { artHint.set(s.id, { src: s.cover, colors: s.colors ?? null }); };
  const current = songs[index];
  if (!n) return null;
  return (
    <section aria-roledescription="carousel" aria-label="Songs to start with" className="relative select-none [overflow-x:clip] max-sm:-mx-5">
      <div
        ref={wrap}
        className="relative mx-auto touch-pan-y outline-none"
        style={{ height: geo.card * 1.56 + 40, perspective: 1500 }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
          if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
          if (e.key === "Enter" && current) { open(current); router.push(`/songs/${current.id}`); }
        }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; go(Math.round(pos.get())); }}
        aria-label={`${current?.title ?? ""}. Use the arrow keys to turn, Enter to play.`}
      >
        {songs.map((s, i) => (
          <FlowCard key={s.id} song={s} i={i} n={n} pos={pos} geo={geo} centre={i === index}
            onSide={() => go(Math.round(pos.get()) + wrapDelta(i, pos.get(), n))} onOpen={() => open(s)} />
        ))}
      </div>
      <div className="relative mt-6 flex items-center justify-center gap-6">
        {hint && <p className="absolute left-0 top-1/2 hidden max-w-[15rem] -translate-y-1/2 text-[12px] leading-snug text-faint lg:block">{hint}</p>}
        <button className="btn btn-round" onClick={() => step(-1)} aria-label="Previous song"><ChevronLeft className="h-4 w-4" strokeWidth={1.6} /></button>
        <span className="tabular min-w-[4.5rem] text-center text-[13px] tracking-[0.08em] text-muted" aria-live="polite"><b className="font-semibold text-fg">{String(index + 1).padStart(2, "0")}</b> / {String(n).padStart(2, "0")}</span>
        <button className="btn btn-round" onClick={() => step(1)} aria-label="Next song"><ChevronRight className="h-4 w-4" strokeWidth={1.6} /></button>
      </div>
    </section>
  );
}

function FlowCard({ song, i, n, pos, geo, centre, onSide, onOpen }: { song: FlowSong; i: number; n: number; pos: MotionValue<number>; geo: { card: number; radius: number; depth: number }; centre: boolean; onSide: () => void; onOpen: () => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [morph, setMorph] = useState(false);
  const d = useTransform(pos, (p) => wrapDelta(i, p, n));
  const transform = useTransform(d, (v) => {
    const a = (v * STEP * Math.PI) / 180;
    const x = geo.radius * Math.sin(a);
    const z = -geo.depth * (1 - Math.cos(a));
    return `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${(v * STEP).toFixed(2)}deg)`;
  });
  const opacity = useTransform(d, (v) => Math.max(0, Math.min(1, VISIBLE + 0.6 - Math.abs(v))));
  const zIndex = useTransform(d, (v) => 100 - Math.round(Math.abs(v) * 10));
  const shift = useTransform(d, (v) => `${(-v * 7).toFixed(2)}%`);       // the picture drifts against the turn
  const shade = useTransform(d, (v) => Math.min(0.55, Math.abs(v) * 0.16));
  const visibility = useTransform(d, (v) => (Math.abs(v) > VISIBLE + 0.6 ? "hidden" : "visible"));
  const w = geo.card, h = Math.round(geo.card * 1.56);
  return (
    <motion.div className="absolute left-1/2 top-0 [transform-style:preserve-3d]" style={{ width: w, height: h, marginLeft: -w / 2, transform, opacity, zIndex, visibility }}>
      <Link
        href={`/songs/${song.id}`}
        draggable={false}
        tabIndex={centre ? 0 : -1}
        aria-label={`${song.title}${song.artist ? `, ${song.artist}` : ""}. Play along`}
        onClick={(e) => {
          if (!centre) { e.preventDefault(); onSide(); return; }
          onOpen(); flushSync(() => setMorph(true));
        }}
        className="art-surface grain block h-full w-full overflow-hidden rounded-[22px] shadow-[0_30px_60px_-20px_rgba(0,0,0,.75)]"
        style={{ background: artField(song.colors) }}
      >
        <ViewTransition name={morph ? artName(song.id) : `flow-${uid}`} share="art-morph" default="none">
          <motion.div className="absolute inset-0 -z-10 overflow-hidden" style={{ x: shift, scale: 1.16 }}>
            <ArtImage src={song.cover} eager={Math.abs(i) < 4} className="!static h-full w-full object-cover" />
          </motion.div>
        </ViewTransition>
        <motion.span className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: shade }} aria-hidden="true" />
        <span className="numeral absolute inset-x-0 top-4 text-center text-white/85">{String(i + 1).padStart(2, "0")}{centre ? ` · ${song.kind}` : ""}</span>
        <span className={`absolute inset-x-4 text-center transition-[bottom] duration-300 ${centre ? "bottom-[84px]" : "bottom-11"}`}>
          <span className="block font-display text-[clamp(1.1rem,1.9vw,1.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">{song.title}</span>
          {song.artist && <span className="mt-1.5 block truncate text-[12px] text-white/70">{song.artist}</span>}
        </span>
        <span className={`absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-4 py-2.5 text-[12px] font-semibold text-[#111] transition duration-300 ${centre ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`} aria-hidden="true">
          <PlayGlyph className="h-3 w-3" /> Play along
        </span>
      </Link>
    </motion.div>
  );
}
