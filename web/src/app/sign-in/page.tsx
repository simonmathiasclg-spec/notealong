"use client";
// Online version: sign in, or create a free account, with Google (the main way) or a link by email.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail, Play } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/AppHeader";
import { TURNSTILE_SITE_KEY, Turnstile } from "@/components/cloud/Turnstile";
import { supabase } from "@/lib/cloud/browser";
import { CLOUD, TRY_SONG_ID } from "@/lib/cloud/config";
import { api } from "@/lib/api";

const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function SignIn() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const expired = params.get("link") === "expired";
  const forUpload = next.startsWith("/my-songs");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(!GOOGLE);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/cloud/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, next, captchaToken: captcha }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "The link could not be sent. Try again.");
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
      setCaptchaReset((n) => n + 1);       // a captcha token works once
    }
  };

  const google = async () => {
    setGoogleBusy(true);
    const { error: err } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` } });
    if (err) { setError("Google sign-in isn't available right now. Use the email link instead."); setShowEmail(true); setGoogleBusy(false); }
  };

  if (!CLOUD) {
    return <p className="text-muted">This copy of NoteAlong runs on your own computer and needs no sign-in. <Link className="underline" href="/">Go to Discover</Link>.</p>;
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <section>
        <h1 className="display-hero text-red text-[clamp(4rem,11vw,8.5rem)]">Play along</h1>
        <p className="display-wide mt-4 text-[clamp(0.85rem,1.5vw,1.1rem)]">The note for every word</p>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
          NoteAlong turns a song into a part you can play on sax, flute, trumpet or violin, with the note above every word while the band plays.
        </p>
        <div className="mt-8">
          <Link href={`/songs/${TRY_SONG_ID}`} className="btn btn-lg">Try it: no sign-in needed <Play className="h-4 w-4 fill-current" strokeWidth={0} /></Link>
          <p className="mt-2 text-[13px] text-muted">Opens a song in the player. Every built-in song is free to play.</p>
        </div>
        <div className="relative mt-12 hidden h-64 w-full max-w-md sm:block" aria-hidden="true">
          {["the-water-is-wide", "las-mananitas", "silent-night"].map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={api.coverUrl(id)} alt="" className="absolute top-0 h-64 w-44 rounded-[20px] object-cover shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)]"
              style={{ left: `${i * 26}%`, transform: `perspective(900px) rotateY(${(i - 1) * -22}deg) scale(${i === 1 ? 1 : 0.88})`, zIndex: i === 1 ? 2 : 1, background: "var(--art-deep)" }} />
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="border-t border-border pt-6">
          <h2 className="display-lg text-[2rem]">{forUpload ? "Sign up free to convert your song" : "Sign in or sign up free"}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">A free account converts one song of your own, for good. It also keeps your favourites, setlists and note fixes.</p>
          {expired && <p className="mt-3 text-sm text-danger">That sign-in link has expired or was already used. Ask for a new one below.</p>}

          {GOOGLE && (
            <button type="button" className="btn btn-lg mt-5 w-full gap-3 bg-[var(--fg)] text-[var(--bg)] hover:opacity-90" onClick={google} disabled={googleBusy}>
              {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />} Continue with Google
            </button>
          )}

          {state === "sent" ? (
            <div className="mt-5 flex gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--pill)] text-[var(--pill-fg)]"><Mail className="h-4 w-4" strokeWidth={1.8} /></span>
              <div>
                <p className="font-medium">Check your email</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">A sign-in link is on its way to {email}. It works once, within an hour, on any device. No email after a few minutes? Look in spam{GOOGLE ? ", or continue with Google" : ""}.</p>
                <button className="btn btn-ghost btn-sm mt-3 -ml-3" onClick={() => setState("idle")}>Use another email</button>
              </div>
            </div>
          ) : !showEmail ? (
            <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setShowEmail(true)}><Mail className="h-4 w-4" strokeWidth={1.8} /> Use an email link instead</button>
          ) : (
            <form onSubmit={send} className="mt-5 space-y-3">
              {GOOGLE && <p className="text-center text-xs text-faint">or get a sign-in link by email</p>}
              <label className="block text-sm text-muted" htmlFor="email">Your email</label>
              <input id="email" type="email" required autoComplete="email" inputMode="email" className="field w-full" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={GOOGLE} />
              <Turnstile onToken={setCaptcha} resetKey={captchaReset} />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button className={`btn btn-lg w-full ${GOOGLE ? "" : "btn-red"}`} type="submit" disabled={state === "sending" || (!!TURNSTILE_SITE_KEY && !captcha)}>
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Email me a sign-in link
              </button>
            </form>
          )}
          <p className="mt-6 text-xs leading-relaxed text-faint">By continuing you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-fg">Terms</Link> and the <Link href="/privacy" className="underline underline-offset-2 hover:text-fg">Privacy</Link> notes.</p>
        </div>
      </section>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-5 py-4 sm:px-8 lg:px-12"><Logo /><ThemeToggle /></header>
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-5 pb-16 pt-6 sm:px-8 sm:pt-12 lg:px-12">
        <Suspense><SignIn /></Suspense>
      </main>
      <footer className="mx-auto flex w-full max-w-[90rem] gap-5 px-5 pb-8 text-sm text-faint sm:px-8 lg:px-12">
        <Link href="/terms" className="hover:text-fg">Terms</Link>
        <Link href="/privacy" className="hover:text-fg">Privacy</Link>
      </footer>
    </div>
  );
}
