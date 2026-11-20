// Renders the keys one step up and down from `shift` in the background (fast versions first, then the fine
// ones of all three), so the next key change is instant.
import type { NextRequest } from "next/server";
import { createJob, dispatch, isCatalogId } from "@/lib/cloud/jobs";
import { adminClient, currentUser, HttpError, route, userClient } from "@/lib/cloud/server";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!user) return Response.json({ queued: 0 });          // guests use the keys that are already made
    const shift = Math.max(-6, Math.min(6, Math.round(Number(req.nextUrl.searchParams.get("shift") ?? 0) || 0)));
    const catalog = await isCatalogId(id);
    if (!catalog) {
      const { data: row } = await (await userClient()).from("songs").select("id,status").eq("id", id).maybeSingle();
      if (!row) throw new HttpError(404, "Song not found");
      if (row.status !== "ready") return Response.json({ queued: 0 });
    }
    const db = adminClient();
    // one background render per song at a time is plenty
    const { data: running } = await db.from("jobs").select("id").eq("song_id", id).eq("kind", "render").eq("params->>prepare", "true")
      .in("status", ["queued", "running"]).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()).eq(catalog ? "song_id" : "user_id", catalog ? id : user.id).limit(1);
    if ((running ?? []).length) return Response.json({ queued: 0 });
    const shifts = [shift, shift + 1, shift - 1].filter((s) => s !== 0 && s >= -6 && s <= 6);
    const targets = [
      ...shifts.slice(1).flatMap((s) => (["backing", "vocals"] as const).map((stem) => ({ stem, shift: s, fine: false }))),
      ...shifts.flatMap((s) => (["backing", "vocals"] as const).map((stem) => ({ stem, shift: s, fine: true }))),
    ];
    if (!targets.length) return Response.json({ queued: 0 });
    const jobId = await createJob(user.id, id, "render", { targets, catalog, prepare: true });
    await dispatch(jobId).catch(() => {});      // a missed warm-up only means the next key change waits a little
    return Response.json({ queued: targets.length });
  });
}
