"use client";
// Online version, owner only (ADMIN_EMAIL): who is in the beta, what they added, what failed, and what the
// processing cost this month. Song titles and files are private to each user and never shown here.
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";

type Stats = {
  month: string;
  totals: { users: number; jobs: number; failed: number; uploads: number; gpu_seconds: number; cpu_seconds: number; dollars: number; dollars_per_upload: number | null };
  users: { email: string; created_at: string; last_sign_in_at: string | null; uploads: number; ready: number; jobs: number; failed: number; gpu: number }[];
  failures: { at: string; kind: string; error: string | null; email: string }[];
  allowlist: { email: string; note: string | null; added_at: string }[];
  waitlist: { email: string; note: string | null; kind?: "beta" | "paid"; created_at: string }[];
};

const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "never");
const mins = (s: number) => (s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const load = useCallback(() => {
    fetch("/api/cloud/admin", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "This page is for the site's owner.");
      setStats(await r.json());
    }).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (action: "invite" | "uninvite", who: string) => {
    const r = await fetch("/api/cloud/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, email: who }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).detail ?? "That didn't work.");
    else { setEmail(""); load(); }
  };

  const tiles: [string, string | number][] = stats ? [
    ["Users", stats.totals.users], ["New songs", stats.totals.uploads], ["Jobs", stats.totals.jobs], ["Failed", stats.totals.failed],
    ["GPU time", mins(stats.totals.gpu_seconds)], ["CPU time", mins(stats.totals.cpu_seconds)], ["Processing cost", `$${stats.totals.dollars.toFixed(2)}`],
    ["Per new song", stats.totals.dollars_per_upload == null ? "–" : `$${stats.totals.dollars_per_upload.toFixed(3)}`],
  ] : [];

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-20 sm:px-8">
        <h1 className="display-hero text-[clamp(3rem,8vw,6.5rem)]">Owner&apos;s overview</h1>
        {error && <p className="mt-4 text-danger">{error}</p>}
        {!stats ? (!error && <div className="skel mt-6 h-40 w-full" />) : (
          <div className="mt-6 space-y-8">
            <section>
              <h2 className="font-semibold">This month ({stats.month})</h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {tiles.map(([k, v]) => (
                  <div key={k} className="border-t border-border pt-4"><dt className="text-[12px] text-muted">{k}</dt><dd className="mt-2 font-display text-[2.1rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{v}</dd></div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-faint">Cost is estimated from Modal&apos;s prices (T4 GPU, 2-core CPU); Modal&apos;s own bill is the final word.</p>
            </section>

            <section>
              <h2 className="font-semibold">Users</h2>
              <div className="mt-3 overflow-x-auto border-t border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-elev text-muted"><tr>{["Email", "Joined", "Last sign-in", "Songs", "Jobs this month", "Failed", "GPU"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {stats.users.map((u) => (
                      <tr key={u.email}>
                        <td className="px-3 py-2">{u.email}</td><td className="px-3 py-2">{day(u.created_at)}</td><td className="px-3 py-2">{day(u.last_sign_in_at)}</td>
                        <td className="px-3 py-2 tabular-nums">{u.uploads}</td><td className="px-3 py-2 tabular-nums">{u.jobs}</td><td className="px-3 py-2 tabular-nums">{u.failed}</td><td className="px-3 py-2 tabular-nums">{mins(u.gpu)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-semibold">Recent failures</h2>
              {stats.failures.length === 0 ? <p className="mt-2 text-sm text-muted">None.</p> : (
                <ul className="mt-3 space-y-2">
                  {stats.failures.map((f, i) => <li key={i} className="border-b border-border py-3 text-sm"><span className="text-muted">{day(f.at)}, {f.kind}, {f.email}:</span> {f.error}</li>)}
                </ul>
              )}
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div>
                <h2 className="font-semibold">Testers ({stats.allowlist.length})</h2>
                <p className="mt-1 text-sm text-muted">10 new songs a day instead of one free song.</p>
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); act("invite", email); }}>
                  <input className="field min-w-0 flex-1" type="email" required placeholder="Make an email a tester" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button className="btn btn-primary" type="submit">Invite</button>
                </form>
                <p className="mt-2 text-xs text-faint">Invited people sign in on the sign-in page with this email. Nothing is sent until they do.</p>
                <ul className="mt-3 divide-y divide-border border-y border-border">
                  {stats.allowlist.map((a) => (
                    <li key={a.email} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="truncate">{a.email}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => act("uninvite", a.email)}>Remove</button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="font-semibold">Interested in paid plans ({stats.waitlist.filter((w) => w.kind === "paid").length}) and the old waitlist ({stats.waitlist.filter((w) => w.kind !== "paid").length})</h2>
                <ul className="mt-3 divide-y divide-border border-y border-border">
                  {stats.waitlist.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nobody yet.</li>}
                  {stats.waitlist.map((w) => (
                    <li key={`${w.kind}:${w.email}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0"><span className="block truncate">{w.email}</span><span className="block truncate text-muted">{w.kind === "paid" ? "Paid plans" : "Beta waitlist"}{w.note ? `: ${w.note}` : ""}</span></span>
                      <button className="btn btn-sm" onClick={() => act("invite", w.email)}>Make tester</button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
