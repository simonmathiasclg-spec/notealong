"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Scales a single-line element down (never up) so it fits its container.
 * The element must be `width: max-content` (so its offsetWidth is its natural
 * width) and should size its text with `calc(var(--fit, 1) * <base>)`.
 */
export function useFitText<T extends HTMLElement>(deps: unknown[], minScale = 0.5) {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const measure = () => {
      el.style.setProperty("--fit", "1");
      const natural = el.offsetWidth;
      const avail = parent.clientWidth;
      const s = natural > avail ? Math.max(minScale, avail / natural) : 1;
      el.style.setProperty("--fit", String(s));
      setScale(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    // the display face may arrive after the first measure: measure again once it has
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    let live = true;
    fonts?.ready.then(() => { if (live) measure(); });
    fonts?.addEventListener?.("loadingdone", measure);
    return () => { live = false; ro.disconnect(); fonts?.removeEventListener?.("loadingdone", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, scale };
}
