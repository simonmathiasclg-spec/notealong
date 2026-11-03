"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Repeat } from "lucide-react";
import { motion } from "framer-motion";
import { formatTime } from "@/lib/api";
import type { DisplayLine } from "@/lib/display";

type Props = {
  playing: boolean;
  countingIn: boolean;
  loading: boolean;
  duration: number;
  getTime: () => number;
  lines: DisplayLine[];
  loop: [number, number] | null;
  speed: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSkip: (dir: 1 | -1) => void;
  onLoop: (loop: [number, number] | null) => void;
  onLoopLine: () => void;
  onSpeed: (speed: number) => void;
  focus: boolean;
};

const SPEEDS = [1, 0.75, 0.5];

/** The bottom of the stage: a thin "string" of progress with line marks, and the controls under it. */
export function Transport({ playing, countingIn, loading, duration, getTime, lines, loop, speed, onToggle, onSeek, onSkip, onLoop, onLoopLine, onSpeed, focus }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragState = useRef<{ startX: number; startT: number; moved: boolean } | null>(null);

  // Cheap DOM updates every frame, no React re-render.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = getTime();
      const pct = duration ? (t / duration) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (headRef.current) headRef.current.style.left = `${pct}%`;
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
  const nextSpeed = () => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1);

  return (
    <div className={`no-print mx-auto w-full max-w-6xl px-5 pb-[max(1.1rem,env(safe-area-inset-bottom))] sm:px-10 ${focus ? "pt-2" : "pt-1"}`}>
      {!focus && (
        <div
          ref={barRef}
          className="group relative h-8 cursor-pointer touch-none select-none"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragState.current = null; setDrag(null); }}
          role="slider" aria-label="Position in the song. Drag to loop a part." aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(getTime())}
          data-tip="Click to jump · drag to loop a part"
        >
          <div className="string absolute inset-x-0 top-1/2 -translate-y-1/2">
            <div ref={fillRef} className="fill" style={{ width: 0 }} />
            {duration > 0 && lines.filter((l) => l.kind === "lyric").map((l) => (
              <span key={l.index} className="tick" style={{ left: `${(l.start / duration) * 100}%` }} />
            ))}
            {sel && duration > 0 && (
              <div className="loop" style={{ left: `${(sel[0] / duration) * 100}%`, width: `${((sel[1] - sel[0]) / duration) * 100}%` }} />
            )}
            <div ref={headRef} className="head" style={{ left: 0 }} />
          </div>
        </div>
      )}
      <div className="relative flex items-center justify-center gap-2 sm:gap-3">
        {!focus && <span ref={timeRef} className="tabular absolute left-0 text-[13px] text-muted">0:00</span>}
        {!focus && (
          <div className="flex w-[8.5rem] items-center justify-end gap-1">
            <button className={`btn btn-ghost btn-icon ${loop ? "text-accent" : ""}`} onClick={loop ? () => onLoop(null) : onLoopLine} aria-pressed={!!loop} aria-label={loop ? "Stop looping" : "Loop this line"} data-tip={loop ? `Looping ${formatTime(loop[0])} to ${formatTime(loop[1])}. Click to stop` : "Loop this line (L)"}>
              <Repeat className="h-[18px] w-[18px]" />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => onSkip(-1)} aria-label="Previous line" data-tip="Previous line (←)"><ChevronLeft className="h-5 w-5" /></button>
          </div>
        )}
        <motion.button
          onClick={onToggle}
          disabled={loading}
          aria-label={playing ? "Pause" : "Play"}
          whileTap={{ scale: 0.94 }}
          className="relative grid h-[4.25rem] w-[4.25rem] shrink-0 place-items-center rounded-full bg-fg text-bg shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition hover:scale-[1.03] disabled:opacity-50"
        >
          {countingIn && <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" aria-hidden="true" />}
          {playing ? <Pause className="h-7 w-7" fill="currentColor" strokeWidth={0} /> : <Play className="ml-1 h-7 w-7" fill="currentColor" strokeWidth={0} />}
        </motion.button>
        {!focus && (
          <div className="flex w-[8.5rem] items-center justify-start gap-1">
            <button className="btn btn-ghost btn-icon" onClick={() => onSkip(1)} aria-label="Next line" data-tip="Next line (→)"><ChevronRight className="h-5 w-5" /></button>
            <button className={`btn btn-ghost tabular min-w-[4.6rem] ${speed < 1 ? "text-accent" : ""}`} onClick={nextSpeed} aria-pressed={speed < 1} aria-label={`Speed ${Math.round(speed * 100)} percent, click to change`} data-tip={speed < 1 ? "Click for the next speed" : "Slow the song down without changing the notes"}>
              {speed < 1 ? `${Math.round(speed * 100)}% speed` : "Slower"}
            </button>
          </div>
        )}
        {!focus && <span className="tabular absolute right-0 text-[13px] text-muted">{formatTime(duration)}</span>}
      </div>
    </div>
  );
}
