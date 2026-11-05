"use client";
import { useEffect, type RefObject } from "react";
import { sweepAt, type Knot } from "@/lib/timing";

type Bar = { start: number; end: number; fill: HTMLElement; last: number };

function offsetWithin(el: HTMLElement, container: HTMLElement): { left: number; top: number } {
  let left = 0, top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== container) {
    left += node.offsetLeft; top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top };
}

/** The sweeping line is found by id, next to the line it belongs to. */
export function needleId(root: HTMLElement | null): string { return `sweep-${root?.dataset.line ?? ""}`; }

/**
 * Drives the timing guide of the current line without re-rendering React:
 * every frame it fills each duration bar as far as the music has got and
 * moves the sweeping line. Positions come from the laid-out bars, so the line
 * always meets a bar's left edge exactly when its note starts.
 */
export function useSweep(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  getTime: () => number,
  beat: number,
  deps: unknown[],
) {
  useEffect(() => {
    const root = container.current;
    if (!active || !root) return;
    let bars: Bar[] = [];
    let knots: Knot[] = [];
    let lead = 40;
    let needleTop = 0, needleHeight = 0;
    const findNeedle = () => document.getElementById(needleId(root));

    const measure = () => {
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-bar]"));
      bars = [];
      knots = [];
      lead = parseFloat(getComputedStyle(root).fontSize) * 1.1;
      els.forEach((el, i) => {
        const start = Number(el.dataset.start), end = Number(el.dataset.end);
        const fill = el.firstElementChild as HTMLElement;
        const pos = offsetWithin(el, root);
        bars.push({ start, end, fill, last: -1 });
        knots.push({ t: start, x: pos.left });
        if (i === 0) {
          // hangs from just above the bar down into the space over the word, clear of the note letters
          const h = el.offsetHeight;
          needleTop = pos.top - h * 0.9;
          needleHeight = h * 5.2;
        }
        if (i === els.length - 1) knots.push({ t: Math.max(end, start + 0.01), x: pos.left + el.offsetWidth });
      });
      knots.sort((a, b) => a.t - b.t);
      const n = findNeedle();
      if (n) { n.style.top = `${needleTop}px`; n.style.height = `${needleHeight}px`; }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);

    let raf = 0;
    const tick = () => {
      const t = getTime();
      for (const b of bars) {
        const p = t <= b.start ? 0 : t >= b.end ? 1 : (t - b.start) / (b.end - b.start);
        if (p !== b.last) { b.fill.style.transform = `scaleX(${p.toFixed(4)})`; b.last = p; }
      }
      const n = findNeedle();
      if (n) {
        const s = sweepAt(knots, t, beat, lead);
        if (s) { n.style.opacity = String(s.opacity); n.style.transform = `translate3d(${s.x.toFixed(2)}px,0,0)`; }
        else n.style.opacity = "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const b of bars) b.fill.style.transform = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, beat, getTime, ...deps]);
}
