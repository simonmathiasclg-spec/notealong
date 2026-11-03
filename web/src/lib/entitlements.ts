"use client";
// What the current user may do (plan, upload limit). No accounts yet: the
// service answers "local plan, no limits". See service/notealong/entitlements.py.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Entitlements } from "./types";

export const LOCAL_PLAN: Entitlements = { plan: "local", uploads: { used: 0, limit: null, remaining: null }, catalog: "free" };

export function useEntitlements(deps: unknown[] = []): Entitlements {
  const [e, setE] = useState<Entitlements>(LOCAL_PLAN);
  useEffect(() => {
    let alive = true;
    api.me().then((v) => { if (alive) setE(v); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return e;
}

export function uploadsLeftText(e: Entitlements): string | null {
  if (e.uploads.limit === null) return null;
  const n = e.uploads.remaining ?? 0;
  return n === 0 ? "You've used your free uploads. Built-in songs are always free." : `${n} free upload${n === 1 ? "" : "s"} left`;
}
