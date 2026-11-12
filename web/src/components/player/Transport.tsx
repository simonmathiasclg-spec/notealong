"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Repeat } from "lucide-react";
import { PauseGlyph, PlayGlyph, SkipBackGlyph, SkipForwardGlyph } from "../art/Glyphs";
import { motion } from "framer-motion";
import { formatTime } from "@/lib/api";
import type { DisplayLine } from "@/lib/display";
import type { Instrument } from "@/lib/instruments";
import type { SamplerState } from "@/lib/sampler";
import { InstrumentIcon } from "../InstrumentIcon";

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
  /** "Hear it played": the melody on a sampled instrument along with the song. */
  hear: boolean;
  hearState: SamplerState;
  onHear: () => void;
  instrument: Instrument;
};

const SPEEDS = [1, 0.75, 0.5];

/** The bottom of the stage: a thin "string" of progress with line marks, and the controls under it. */
export function Transport({ playing, countingIn, loading, duration, getTime, lines, loop, speed, onToggle, onSeek, onSkip, onLoop, onLoopLine, onSpeed, focus, hear, hearState, onHear, instrument }: Props) {
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
    <div className={`no-print mx-auto w-full max-w-6xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-10 ${focus ? "pt-2" : "pt-0"}`}>
      {!focus && (
        <div className="flex items-center gap-4">
          <span className="tabular w-11 shrink-0 text-[12px] tracking-[0.04em] text-muted" ref={timeRef}>0:00</span>
          <div
            ref={barRef}
            className="group relative h-8 flex-1 cursor-pointer touch-none select-none"
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
          <span className="tabular w-11 shrink-0 text-right text-[12px] tracking-[0.04em] text-muted">{formatTime(duration)}</span>
        </div>
      )}
      <div className="relative mt-1 flex items-center justify-center gap-1 sm:gap-2">
        {!focus && (
          <div className="flex items-center gap-1 max-sm:mr-auto sm:absolute sm:left-0">
            <button className={`btn btn-ghost btn-icon ${loop ? "!bg-[var(--accent-soft)] !text-accent" : ""}`} onClick={loop ? () => onLoop(null) : onLoopLine} aria-pressed={!!loop} aria-label={loop ? "Stop looping" : "Loop this line"} data-tip={loop ? `Looping ${formatTime(loop[0])} to ${formatTime(loop[1])}. Click to stop` : "Loop this line (L)"}>
              <Repeat className="h-[17px] w-[17px]" strokeWidth={1.6} />
            </button>
            <button className={`btn btn-ghost tabular px-3 ${speed < 1 ? "!text-accent" : ""}`} onClick={nextSpeed} aria-pressed={speed < 1} aria-label={`Speed ${Math.round(speed * 100)} percent, click to change`} data-tip={speed < 1 ? "Click for the next speed" : "Slow the song down without changing the notes"}>
              {speed < 1 ? `${Math.round(speed * 100)}%` : "Slower"}
            </button>
          </div>
        )}
        {!focus && <button className="btn btn-ghost btn-icon" onClick={() => onSkip(-1)} aria-label="Previous line" data-tip="Previous line (←)"><SkipBackGlyph className="h-[18px] w-[18px]" /></button>}
        <PlayRing playing={playing} countingIn={countingIn} loading={loading} onToggle={onToggle} getTime={getTime} duration={duration} />
        {!focus && <button className="btn btn-ghost btn-icon" onClick={() => onSkip(1)} aria-label="Next line" data-tip="Next line (→)"><SkipForwardGlyph className="h-[18px] w-[18px]" /></button>}
        {!focus && (
          <button
            className={`btn max-sm:ml-auto sm:absolute sm:right-0 ${hear ? "!bg-[var(--accent)] !text-[var(--accent-fg)]" : "btn-outline"}`}
            onClick={onHear} aria-pressed={hear}
            aria-label={`Hear it played on the ${instrument.name.toLowerCase()}`}
            data-tip={hear ? (hearState === "loading" ? "Loading the sound…" : `Playing the notes on the ${instrument.name.toLowerCase()}. Click to stop (H)`) : `Hear how the notes sound on the ${instrument.name.toLowerCase()}, along with the song (H)`}
          >
            {hear && hearState === "loading" ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <InstrumentIcon icon={instrument.icon} className="h-[17px] w-[17px]" />}
            <span className="hidden md:inline">Hear it played</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The play button inside a ring that fills as the song goes on (the round widget's progress arc). The ring
 * breathes while counting in.
 */
function PlayRing({ playing, countingIn, loading, onToggle, getTime, duration }: { playing: boolean; countingIn: boolean; loading: boolean; onToggle: () => void; getTime: () => number; duration: number }) {
  const arc = useRef<SVGCircleElement>(null);
  const C = 2 * Math.PI * 37;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = duration ? Math.min(1, getTime() / duration) : 0;
      if (arc.current) arc.current.style.strokeDashoffset = String(C * (1 - p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, duration, C]);
  return (
    <motion.button
      onClick={onToggle}
      disabled={loading}
      aria-label={playing ? "Pause" : "Play"}
      whileTap={{ scale: 0.93 }}
      className="relative mx-2 grid h-[5.25rem] w-[5.25rem] shrink-0 place-items-center rounded-full disabled:opacity-50"
    >
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r="37" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
        <circle ref={arc} cx="40" cy="40" r="37" fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} />
      </svg>
      {countingIn && <span className="absolute inset-[7px] animate-ping rounded-full bg-[var(--accent-soft)]" aria-hidden="true" />}
      <span className="relative grid h-[4.1rem] w-[4.1rem] place-items-center rounded-full bg-fg text-bg transition-transform duration-300 ease-out hover:scale-[1.04]">
        {playing ? <PauseGlyph className="h-6 w-6" /> : <PlayGlyph className="ml-1 h-6 w-6" />}
      </span>
    </motion.button>
  );
}
