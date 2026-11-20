"use client";
// Online version: the two things a person who can't do something is shown instead of an error.
//  - SignInNudge: a guest tried to save something (a favourite, a setlist, a key that needs rendering).
//  - PaidPlansPanel: a free account has used its one song.
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "../Modal";

/** The sign-in page, coming back to where the person is now (or to `next`). */
export function signInHref(next?: string): string {
  const here = next ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
  return `/sign-in?next=${encodeURIComponent(here)}`;
}

export function SignInNudge({ message, onClose }: { message: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
          className="floating fixed bottom-24 left-1/2 z-[60] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">{message}</span>
          <Link href={signInHref()} className="btn btn-red btn-sm shrink-0" onClick={onClose}>Sign in</Link>
          <button className="btn btn-ghost btn-icon -mr-2 h-8 w-8 shrink-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** "Tell me when paid plans open": leaves the account's own email on the interest list. */
export function PaidInterestButton({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  if (state === "saved") return <p className={`flex items-center gap-2 text-sm text-muted ${className}`}><Check className="h-4 w-4 text-ok" /> You&apos;re on the list. We&apos;ll email you when paid plans open.</p>;
  return (
    <div className={className}>
      <button className="btn btn-red" disabled={state === "saving"}
        onClick={(e) => {
          e.stopPropagation();
          setState("saving");
          api.joinPaidInterest().then(() => setState("saved")).catch(() => setState("failed"));
        }}>
        {state === "saving" && <Loader2 className="h-4 w-4 animate-spin" />} Tell me when paid plans open
      </button>
      {state === "failed" && <p className="mt-2 text-sm text-danger">That didn&apos;t save. Try again in a minute.</p>}
    </div>
  );
}

export function PaidPlansCopy() {
  return (
    <p className="text-[15px] leading-relaxed text-muted">
      Your free song stays yours to play, change key, fix and add to setlists. Every built-in song is free to play too.
      To convert more of your own songs, paid plans are coming soon.
    </p>
  );
}

export function PaidPlansPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="You've used your free song. Paid plans are coming soon.">
      <PaidPlansCopy />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <PaidInterestButton />
        <Link href="/my-songs" className="btn" onClick={onClose}>My songs</Link>
      </div>
    </Modal>
  );
}
