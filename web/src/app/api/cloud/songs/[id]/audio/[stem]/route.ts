// The audio of a song: a short-lived private link for the user's own uploads, the public file for built-in
// songs. `shift` (semitones, -6..6) returns the song in another key, rendered on first request (both stems at
// once, so the second stem is ready when it is asked for) and kept for next time.
import type { NextRequest } from "next/server";
import type { Song } from "@/lib/types";
import { catalogFile } from "@/lib/cloud/config";
import { createJob, dispatch, fileNames, isCatalogId, publicExists, signedUrl, waitForJob } from "@/lib/cloud/jobs";
import { adminClient, HttpError, requireUser, route, userClient } from "@/lib/cloud/server";

const STEMS = ["backing", "vocals", "original"] as const;

function go(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}

/** Renders the key if no one is rendering it yet; otherwise waits for that render. */
async function ensureRender(userId: string, songId: string, shift: number, catalog: boolean, have: () => Promise<boolean>): Promise<void> {
  if (await have()) return;
  const db = adminClient();
  const { data: running } = await db.from("jobs").select("id,params").eq("song_id", songId).eq("kind", "render").in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 3 * 60 * 1000).toISOString()).eq(catalog ? "song_id" : "user_id", catalog ? songId : userId);
  const same = (running ?? []).find((j) => ((j.params as { targets?: { shift: number; fine?: boolean }[] }).targets ?? []).some((t) => t.shift === shift && !t.fine));
  if (same) await waitForJob(same.id);
  if (await have()) return;
  const targets = (["backing", "vocals"] as const).map((stem) => ({ stem, shift, fine: false }));
  const jobId = await createJob(userId, songId, "render", { targets, catalog });
  await dispatch(jobId, { wait: true });
  if (!(await have())) throw new HttpError(503, "That key could not be made just now. Try again in a moment.");
}

// a key change or a trim can wait for the processing service (up to about two and a half minutes)
export const maxDuration = 180;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; stem: string }> }) {
  return route(async () => {
    const { id, stem } = await ctx.params;
    if (!STEMS.includes(stem as (typeof STEMS)[number])) throw new HttpError(404, "Unknown stem");
    const user = await requireUser();
    const shift = Math.max(-6, Math.min(6, Math.round(Number(req.nextUrl.searchParams.get("shift") ?? 0) || 0)));
    const name = (s: number) => `shift_${stem}_${s > 0 ? "+" : ""}${s}.mp3`;

    if (await isCatalogId(id)) {
      if (stem === "original") throw new HttpError(404, "Unknown stem");
      if (shift === 0) return go(catalogFile(`${id}/${stem}.mp3`));
      const path = `renders/${id}/${name(shift)}`;
      await ensureRender(user.id, id, shift, true, () => publicExists(path));
      return go(catalogFile(path));
    }

    const { data: row } = await (await userClient()).from("songs").select("data").eq("id", id).maybeSingle();
    if (!row) throw new HttpError(404, "Song not found");
    const song = row.data as Song;
    const folder = `${user.id}/${id}`;
    if (stem === "original") return go(await signedUrl(`${folder}/${song.files.original}`));
    if (shift === 0) return go(await signedUrl(`${folder}/${stem}.mp3`));
    await ensureRender(user.id, id, shift, false, async () => (await fileNames(`${folder}/renders`)).has(name(shift)));
    return go(await signedUrl(`${folder}/renders/${name(shift)}`));
  });
}
