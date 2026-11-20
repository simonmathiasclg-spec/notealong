"use client";
// Cloudflare Turnstile, the check against automated sign-ups. Shown only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
// set (its secret goes in Supabase: Authentication, Attack Protection). It works on any domain listed for the key,
// a *.vercel.app address included, so no custom domain is needed.
import { useEffect, useRef } from "react";

type TurnstileApi = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"))));
    s.addEventListener("error", () => reject(new Error("turnstile did not load")));
  });
}

/** Calls `onToken` with a fresh token (and with "" when it expires). `resetKey` changes to ask for a new one. */
export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; }, [onToken]);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let alive = true;
    loadScript().then((t) => {
      if (!alive || !box.current) return;
      widget.current = t.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY, theme: "auto", size: "flexible",
        callback: (token: string) => cb.current(token), "expired-callback": () => cb.current(""), "error-callback": () => cb.current(""),
      });
    }).catch(() => undefined);
    return () => { alive = false; if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; };
  }, []);
  useEffect(() => { if (resetKey && widget.current) { window.turnstile?.reset(widget.current); cb.current(""); } }, [resetKey]);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="min-h-[65px]" />;
}
