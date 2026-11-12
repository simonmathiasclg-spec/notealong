"use client";
// Online version: the signed-in user's account: who they are, today's uploads, sign out, delete everything.
import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { CLOUD } from "@/lib/cloud/config";
import type { Entitlements } from "@/lib/types";

export default function AccountPage() {
  const [me, setMe] = useState<{ email: string; admin: boolean; created_at: string } | null>(null);
  const [plan, setPlan] = useState<Entitlements | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!CLOUD) return;
    fetch("/api/cloud/account", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => undefined);
    api.me().then(setPlan).catch(() => undefined);
  }, []);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    const res = await fetch("/api/cloud/account", { method: "DELETE" });
    if (res.ok) { window.location.replace(new URL("/sign-in", window.location.origin).href); return; }   // a full load: nothing of the old session stays in memory
    setError((await res.json().catch(() => ({}))).detail ?? "Your account could not be deleted. Try again.");
    setDeleting(false);
  };

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-10 sm:px-8">
        <h1 className="display-hero text-[clamp(3.4rem,9vw,7rem)]">Account</h1>
        {!CLOUD ? (
          <p className="mt-3 text-muted">This copy of NoteAlong runs on your own computer; there is no account to manage.</p>
        ) : (
          <div className="mt-10 space-y-10">
            <div className="border-t border-border">
              <div className="flex items-center justify-between gap-4 border-b border-border py-5">
                <div className="min-w-0">
                  <div className="text-sm text-muted">Signed in as</div>
                  <div className="truncate font-medium">{me?.email ?? "…"}</div>
                </div>
                <form action="/auth/sign-out" method="post"><button className="btn btn-outline" type="submit"><LogOut className="h-4 w-4" strokeWidth={1.7} /> Sign out</button></form>
              </div>
              <div className="border-b border-border py-5">
                <div className="text-sm text-muted">Songs added in the last 24 hours</div>
                <div className="font-display text-[1.6rem] font-extrabold tracking-[-0.02em]">{plan ? `${plan.uploads.used} of ${plan.uploads.limit}` : "…"}</div>
                <p className="mt-1 text-sm text-muted">The beta allows {plan?.uploads.limit ?? 10} new songs a day. Built-in songs are unlimited.</p>
              </div>
              {me?.admin && (
                <div className="border-b border-border py-5"><Link className="btn btn-outline" href="/admin"><ShieldCheck className="h-4 w-4" strokeWidth={1.7} /> Owner&apos;s overview</Link></div>
              )}
            </div>

            <div>
              <h2 className="display-md text-[1.5rem]">Delete my account</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">Removes your account and everything in it for good: your uploaded songs and their files, your note fixes, favourites, setlists and settings. This can&apos;t be undone.</p>
              <button className="btn btn-outline mt-4 !text-danger" onClick={() => setAsking(true)}><Trash2 className="h-4 w-4" strokeWidth={1.7} /> Delete my account</button>
            </div>
            <p className="flex gap-5 text-sm text-faint"><Link href="/terms" className="hover:text-fg">Terms</Link><Link href="/privacy" className="hover:text-fg">Privacy</Link></p>
          </div>
        )}
      </main>
      <Modal open={asking} onClose={() => !deleting && setAsking(false)} title="Delete your account?">
        <p className="text-sm leading-relaxed text-muted">Everything you added to NoteAlong goes, right away. Type <b className="text-fg">delete</b> to confirm.</p>
        <input className="field mt-4 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type delete to confirm" autoFocus />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={() => setAsking(false)} disabled={deleting}>Keep my account</button>
          <button className="btn btn-red" disabled={typed.trim().toLowerCase() !== "delete" || deleting} onClick={remove}>{deleting ? "Deleting…" : "Delete everything"}</button>
        </div>
      </Modal>
    </div>
  );
}
