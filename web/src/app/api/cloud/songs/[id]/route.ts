// Deletes one of the user's uploads: its files, its row, and any processing still running for it.
import { allFiles, removeFiles } from "@/lib/cloud/jobs";
import { adminClient, HttpError, requireUser, route, userClient } from "@/lib/cloud/server";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const { data: row } = await (await userClient()).from("songs").select("id").eq("id", id).maybeSingle();
    if (!row) throw new HttpError(404, "Song not found");
    const db = adminClient();
    await db.from("jobs").update({ status: "stopped", finished_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("song_id", id).in("status", ["queued", "running"]);
    await removeFiles("uploads", await allFiles("uploads", `${user.id}/${id}`));
    const { error } = await db.from("songs").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  });
}
