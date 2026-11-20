"use client";
// What the current person may upload. On this computer: no limits. Online: a guest uploads nothing, a free
// account converts one song of its own (for good), testers and the owner have a daily limit. The database
// decides (supabase/migrations, public.my_allowance); this only shows it.
import { useMe } from "./me";
import type { Entitlements } from "./types";

export const LOCAL_PLAN: Entitlements = { plan: "local", uploads: { used: 0, limit: null, remaining: null }, catalog: "free" };

/** null while it is being checked. It refreshes itself after uploads (lib/uploads.tsx). */
export function useEntitlements(): Entitlements | null {
  return useMe().allowance;
}

/** True when an upload would be turned away: a guest, or a free account whose song is used. */
export function cannotUpload(e: Entitlements | null): "guest" | "used" | null {
  if (!e) return null;
  if (e.plan === "guest") return "guest";
  if (e.plan === "free" && (e.uploads.remaining ?? 0) <= 0) return "used";
  return null;
}

export function uploadsLeftText(e: Entitlements | null): string | null {
  if (!e || e.uploads.limit === null || e.plan === "guest") return null;
  const n = e.uploads.remaining ?? 0;
  if (e.plan === "free") return n > 0 ? "1 free song to convert" : "You've used your free song. Built-in songs are always free";
  return n === 0 ? `You've added ${e.uploads.limit} songs in the last 24 hours. You can add more tomorrow` : `${n} of ${e.uploads.limit} songs left today`;
}
