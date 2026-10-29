"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, X } from "lucide-react";
import { formatTime } from "@/lib/api";
import type { DisplayLine } from "@/lib/display";

type Props = {
  playing: boolean;
  loading: boolean;
  duration: number;
  getTime: () => number;
  lines: DisplayLine[];
  loop: [number, number] | null;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onLoop: (loop: [number, number] | null) => void;
  focus: boolean;
};

export function Transport({ playing, loading, duration, getTime, lines, loop, onToggle, onSeek, onLoop, focus }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragState = useRef<{ startX: number; startT: number; moved: boolean } | null>(null);

  // Cheap DOM updates every frame, no React re-render.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = getTime();
      if (fillRef.current && duration) fillRef.current.style.width = `${(t / duration) * 100}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, duration]);

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startT: timeAt(e.clientX), moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) > 8) d.moved = true;
    if (d.moved) setDrag({ from: d.startT, to: timeAt(e.clientX) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragState.current;
    dragState.current = null;
    if (!d) return;
    if (d.moved) {
      const a = Math.min(d.startT, timeAt(e.clientX));
      const b = Math.max(d.startT, timeAt(e.clientX));
      setDrag(null);
      if (b - a > 0.5) { onLoop([a, b]); onSeek(a); }
    } else {
      onSeek(d.startT);
    }
  };

  const sel = drag ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] : loop;

  return (
    <div className={`no-print mx-auto w-full max-w-5xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-8`}>
      <div className="flex items-center gap-4">
        <button
          onClick={onToggle}
          disabled={loading}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent text-accent-fg shadow-card transition hover:bg-accent-strong active:scale-95 disabled:opacity-60"
        >
          {playing ? <Pause className="h-7 w-7" fill="currentColor" /> : <Play className="ml-1 h-7 w-7" fill="currentColor" />}
        </button>
        {!focus && (
          <>
            <span ref={timeRef} className="w-12 text-right text-sm tabular-nums text-muted">0:00</span>
            <div
              ref={barRef}
              className="group relative h-10 flex-1 cursor-pointer touch-none select-none"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragState.current = null; setDrag(null); }}
              title="Click to jump. Drag to loop a section."
            >
              <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-sunken">
                <div ref={fillRef} className="h-full rounded-full bg-accent/70" style={{ width: 0 }} />
              </div>
              {sel && duration > 0 && (
                <div className="pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 rounded-md border-2 border-accent bg-accent/25"
                  style={{ left: `${(sel[0] / duration) * 100}%`, width: `${((sel[1] - sel[0]) / duration) * 100}%` }} />
              )}
              {duration > 0 && lines.filter((l) => l.kind === "lyric").map((l) => (
                <span key={l.index} className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg/30" style={{ left: `${(l.start / duration) * 100}%` }} />
              ))}
            </div>
            <span className="w-12 text-sm tabular-nums text-muted">{formatTime(duration)}</span>
            {loop && (
              <button className="btn btn-ghost text-xs" onClick={() => onLoop(null)} title="Stop looping">
                <Repeat className="h-4 w-4 text-accent" /> {formatTime(loop[0])}–{formatTime(loop[1])} <X className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
