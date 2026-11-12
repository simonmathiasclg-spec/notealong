"use client";
// One tooltip for the whole app. Anything with data-tip="…" gets it on hover and on keyboard focus.
// It is drawn in a layer of its own on <body> and placed with Floating UI, so no window edge and no
// scrolling or clipped parent can cut it off: it flips to the other side and slides along the edge.
//   data-tip-pos="below" | "below-end" | "above" (default)   preferred side; it still flips when there's no room
//   data-tip-tap                                              also opens on a tap (for "i" marks on touch screens)
import { useEffect } from "react";
import { computePosition, flip, offset, shift, type Placement } from "@floating-ui/dom";

const OPEN_DELAY = 320;   // first tooltip: a short pause, so crossing the screen doesn't light everything up
const LEAVE_GRACE = 110;  // crossing the small gap between two buttons keeps the tooltip up
const WARM_FOR = 450;     // after one has shown, the next one in the row opens at once (no flicker)

export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true"); // the controls carry their own labels; this is the visible hint
    document.body.appendChild(tip);

    let anchor: HTMLElement | null = null;
    let pending: HTMLElement | null = null;
    let timer = 0;
    let leaving = 0;
    let watch = 0;
    let lastHidden = -1e9;
    let suppressed: HTMLElement | null = null; // just clicked: stay quiet until the pointer leaves it

    const place = () => {
      if (!anchor) return;
      const pos = anchor.dataset.tipPos;
      const placement: Placement = pos === "below" ? "bottom" : pos === "below-end" ? "bottom-end" : "top";
      computePosition(anchor, tip, { strategy: "fixed", placement, middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })] })
        .then(({ x, y, placement: used }) => {
          tip.style.left = `${Math.round(x)}px`;
          tip.style.top = `${Math.round(y)}px`;
          tip.dataset.side = used.split("-")[0];
        });
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      window.clearTimeout(timer); window.clearTimeout(leaving); pending = null;
      const moving = anchor !== null && anchor !== el;
      anchor = el;
      tip.textContent = text;
      tip.dataset.moving = moving ? "1" : "0";
      place();
      tip.dataset.open = "1";
      window.clearInterval(watch);
      // follow a label that changes under the pointer (Play/Pause, loop on/off) and leave with a control that goes away
      watch = window.setInterval(() => {
        if (!anchor) return;
        if (!anchor.isConnected || !anchor.dataset.tip) return hide();
        if (anchor.dataset.tip !== tip.textContent) { tip.textContent = anchor.dataset.tip; place(); }
      }, 200);
    };
    const hide = () => {
      window.clearTimeout(timer); window.clearTimeout(leaving); pending = null;
      window.clearInterval(watch);
      if (anchor) lastHidden = performance.now();
      anchor = null;
      tip.dataset.open = "0";
    };
    const tipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = tipOf(e.target);
      if (el && el === anchor) window.clearTimeout(leaving); // came back before it closed
      if (!el || el === anchor || el === pending || el === suppressed) return;
      window.clearTimeout(timer);
      if (anchor || performance.now() - lastHidden < WARM_FOR) return show(el);
      pending = el;
      timer = window.setTimeout(() => show(el), OPEN_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const el = tipOf(e.target);
      if (!el) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (to && el.contains(to)) return;
      if (el === suppressed) suppressed = null;
      if (el === pending) { window.clearTimeout(timer); pending = null; }
      if (el === anchor && !(el.matches(":focus-visible"))) {
        window.clearTimeout(leaving);
        leaving = window.setTimeout(hide, LEAVE_GRACE);
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = tipOf(e.target);
      if (e.pointerType === "touch") {
        // a tap opens the little "i" explanations; any other touch puts the tooltip away
        if (el && el.hasAttribute("data-tip-tap") && el !== anchor) return show(el);
        return hide();
      }
      suppressed = el;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tipOf(e.target);
      if (el && el === e.target && el.matches(":focus-visible")) show(el);
    };
    const onFocusOut = (e: FocusEvent) => { if (tipOf(e.target) === anchor) hide(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && anchor) hide(); };
    const onScroll = () => { if (anchor) hide(); };
    const onResize = () => { if (anchor) place(); };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer); window.clearTimeout(leaving); window.clearInterval(watch);
      tip.remove();
    };
  }, []);
  return null;
}
