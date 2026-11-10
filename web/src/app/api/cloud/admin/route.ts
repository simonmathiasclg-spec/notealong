// The owner's overview (only for ADMIN_EMAIL): users, uploads, jobs, failures, processing time this month,
// and the beta list. It shows counts and error messages, never anyone's song titles or files.
import { adminClient, HttpError, isAdmin, requireUser, route } from "@/lib/cloud/server";

const GPU_DOLLARS_PER_SECOND = Number(process.env.GPU_DOLLARS_PER_SECOND ?? 0.000164);   // Modal T4
const CPU_DOLLARS_PER_SECOND = Number(process.env.CPU_DOLLARS_PER_SECOND ?? 0.0000329);  // Modal, 2 cores + 3 GiB

async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new HttpError(403, "This page is for the site's owner.");
  return user;
}

export async function GET() {
  return route(async () => {
    await requireAdmin();
    const db = adminClient();
    const month = new Date();
    month.setUTCDate(1);
    month.setUTCHours(0, 0, 0, 0);
    const [users, songs, jobs, failures, allow, wait, usage] = await Promise.all([
      db.auth.admin.listUsers({ perPage: 1000 }),
      db.from("songs").select("user_id,status"),
      db.from("jobs").select("user_id,kind,status,gpu_seconds,processing_seconds,params").gte("created_at", month.toISOString()),
      db.from("jobs").select("created_at,kind,error,user_id").eq("status", "failed").order("created_at", { ascending: false }).limit(25),
      db.from("allowlist").select("email,note,added_at").order("added_at", { ascending: false }),
      db.from("waitlist").select("email,note,created_at").order("created_at", { ascending: false }).limit(200),
      db.from("usage_monthly").select("*").order("month", { ascending: false }).limit(6),
    ]);
    const emails = new Map((users.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
    const per = new Map<string, { uploads: number; ready: number; jobs: number; failed: number; gpu: number }>();
    const row = (id: string) => per.get(id) ?? per.set(id, { uploads: 0, ready: 0, jobs: 0, failed: 0, gpu: 0 }).get(id)!;
    for (const s of songs.data ?? []) { const r = row(s.user_id); r.uploads++; if (s.status === "ready") r.ready++; }
    let gpu = 0, cpu = 0, newUploads = 0, failed = 0;
    for (const j of jobs.data ?? []) {
      const r = row(j.user_id);
      r.jobs++;
      if (j.status === "failed") { r.failed++; failed++; }
      r.gpu += j.gpu_seconds ?? 0;
      gpu += j.gpu_seconds ?? 0;
      if (!j.gpu_seconds) cpu += j.processing_seconds ?? 0;
      if ((j.params as { new?: boolean })?.new) newUploads++;
    }
    // the monthly totals have no names in them and survive deleted accounts, so they are the true bill
    const m = (usage.data ?? []).find((u) => u.month === month.toISOString().slice(0, 10));
    if (m) {
      gpu = m.gpu_seconds; cpu = m.cpu_seconds; newUploads = m.uploads; failed = m.failures;
    }
    const dollars = gpu * GPU_DOLLARS_PER_SECOND + cpu * CPU_DOLLARS_PER_SECOND;
    return Response.json({
      month: month.toISOString().slice(0, 7),
      totals: {
        users: emails.size, jobs: m ? m.jobs : (jobs.data ?? []).length, failed, uploads: newUploads,
        gpu_seconds: Math.round(gpu), cpu_seconds: Math.round(cpu),
        dollars: +dollars.toFixed(2), dollars_per_upload: newUploads ? +(dollars / newUploads).toFixed(3) : null,
      },
      months: usage.data ?? [],
      users: (users.data?.users ?? []).map((u) => ({
        email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, ...(per.get(u.id) ?? { uploads: 0, ready: 0, jobs: 0, failed: 0, gpu: 0 }),
      })),
      failures: (failures.data ?? []).map((f) => ({ at: f.created_at, kind: f.kind, error: f.error, email: emails.get(f.user_id) ?? "(deleted account)" })),
      allowlist: allow.data ?? [],
      waitlist: wait.data ?? [],
    });
  });
}

export async function POST(req: Request) {
  return route(async () => {
    await requireAdmin();
    const body = (await req.json()) as { action?: string; email?: string; note?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "That doesn't look like an email address.");
    const db = adminClient();
    if (body.action === "invite") {
      const { error } = await db.from("allowlist").upsert({ email, note: body.note ?? null });
      if (error) throw error;
    } else if (body.action === "uninvite") {
      await db.from("allowlist").delete().eq("email", email);
    } else throw new HttpError(400, "Unknown action");
    return Response.json({ ok: true });
  });
}
