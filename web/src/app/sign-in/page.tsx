"use client";
// Online version: sign in with a link by email (invited people only), or join the waitlist.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Loader2, Mail } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/AppHeader";
import { supabase } from "@/lib/cloud/browser";
import { CLOUD } from "@/lib/cloud/config";

function SignIn() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const expired = params.get("link") === "expired";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [wEmail, setWEmail] = useState("");
  const [wNote, setWNote] = useState("");
  const [wState, setWState] = useState<"idle" | "saving" | "saved">("idle");
  const [wError, setWError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/cloud/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, next }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "The link could not be sent. Try again.");
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  const google = async () => {
    await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` } });
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setWError(null);
    setWState("saving");
    const { error: err } = await supabase().from("waitlist").insert({ email: wEmail.trim(), note: wNote.trim() || null });
    // the same email twice is fine: it is already on the list
    if (err && err.code !== "23505") { setWError("That didn't save. Check the email address and try again."); setWState("idle"); return; }
    setWState("saved");
  };

  if (!CLOUD) {
    return <p className="text-muted">This copy of NoteAlong runs on your own computer and needs no sign-in. <Link className="underline" href="/">Go to Discover</Link>.</p>;
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <section>
        <h1 className="display-xl text-[2.6rem] leading-[1.02] sm:text-[3.4rem]">See the note for every word, while the band plays.</h1>
        <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-muted">
          NoteAlong turns a song into a part you can play on sax, flute, trumpet or violin. The beta is open to invited players only.
        </p>
      </section>

      <section className="space-y-6">
        <div className="panel p-6 sm:p-7">
          <h2 className="display-md text-[1.45rem]">Sign in</h2>
          {expired && <p className="mt-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">That sign-in link has expired or was already used. Ask for a new one below.</p>}
          {state === "sent" ? (
            <div className="mt-4 flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Mail className="h-4 w-4" /></span>
              <div>
                <p className="font-medium">Check your email</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">If {email} is on the beta list, a sign-in link is on its way. It works once, within an hour, on any device.</p>
                <button className="btn btn-ghost btn-sm mt-3 -ml-3" onClick={() => setState("idle")}>Use another email</button>
              </div>
            </div>
          ) : (
            <form onSubmit={send} className="mt-4 space-y-3">
              <label className="block text-sm text-muted" htmlFor="email">The email you were invited with</label>
              <input id="email" type="email" required autoComplete="email" inputMode="email" className="field w-full" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button className="btn btn-primary w-full" type="submit" disabled={state === "sending"}>
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Email me a sign-in link
              </button>
              {process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1" && (
                <button type="button" className="btn w-full" onClick={google}>Continue with Google</button>
              )}
            </form>
          )}
        </div>

        <div className="rounded-[1.25rem] border border-dashed border-border-strong p-6 sm:p-7">
          <h2 className="display-md text-[1.2rem]">Not invited yet?</h2>
          {wState === "saved" ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Check className="h-4 w-4 text-ok" /> You&apos;re on the waitlist. We&apos;ll email you when there&apos;s room.</p>
          ) : (
            <form onSubmit={join} className="mt-3 space-y-3">
              <p className="text-sm leading-relaxed text-muted">Leave your email and we&apos;ll let you know when there&apos;s a place in the beta.</p>
              <input type="email" required autoComplete="email" className="field w-full" placeholder="you@example.com" aria-label="Email for the waitlist" value={wEmail} onChange={(e) => setWEmail(e.target.value)} />
              <input className="field w-full" maxLength={300} placeholder="What do you play? (optional)" aria-label="What you play" value={wNote} onChange={(e) => setWNote(e.target.value)} />
              {wError && <p className="text-sm text-danger">{wError}</p>}
              <button className="btn" type="submit" disabled={wState === "saving"}>Join the waitlist</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8"><Logo /><ThemeToggle /></header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-6 sm:px-8 sm:pt-14">
        <Suspense><SignIn /></Suspense>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl gap-5 px-5 pb-8 text-sm text-faint sm:px-8">
        <Link href="/terms" className="hover:text-fg">Terms</Link>
        <Link href="/privacy" className="hover:text-fg">Privacy</Link>
      </footer>
    </div>
  );
}
