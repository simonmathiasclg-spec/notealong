// Stops the processing of a song. The step that was running is marked failed; retry continues from there.
import type { Song } from "@/lib/types";
import { adminClient, HttpError, requireUser, route, userClient } from "@/lib/cloud/server";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const { data: row } = await (await userClient()).from("songs").select("data").eq("id", id).maybeSingle();
    if (!row) throw new HttpError(404, "Song not found");
    const db = adminClient();
    const { data: jobs } = await db.from("jobs").update({ status: "stopped", finished_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("song_id", id).in("status", ["queued", "running"]).select("id,result");
    const msg = "Stopped. Press retry to continue from where it left off.";
    const song = row.data as Song;
    const steps = { ...song.steps };
    for (const [k, st] of Object.entries(steps)) if (st.status === "running" || st.status === "pending") steps[k] = { ...st, status: st.status === "running" ? "failed" : "pending", error: st.status === "running" ? msg : null };
    await db.from("songs").update({ status: "failed", data: { ...song, status: "failed", error: msg, steps } }).eq("id", id).eq("user_id", user.id);
    const url = (process.env.PROCESSING_URL ?? "").replace(/\/$/, "");
    if (url && process.env.WORKER_SECRET) {
      await Promise.allSettled((jobs ?? []).map((j) => fetch(`${url}/jobs/${j.id}/cancel`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` }, signal: AbortSignal.timeout(5000),
      })));
    }
    return Response.json({ stopped: (jobs ?? []).length > 0 });
  });
}
