// Starts processing for one of the user's uploads: a new upload, a re-run of a step, a trim, or pasted lyrics.
// The job is recorded in `jobs` and handed to the processing service; the song page follows its progress.
import type { Song } from "@/lib/types";
import { createJob, dispatch, fileNames, isCatalogId } from "@/lib/cloud/jobs";
import { adminClient, HttpError, requireUser, route, userClient } from "@/lib/cloud/server";
import { snapshotFromSong, STEPS, stepsFor } from "@/lib/cloud/songdata";

type Body = { kind?: string; new?: boolean; step?: string; detail_level?: string; language?: string; hold_across_words?: boolean; start?: number; end?: number | null; text?: string };

// a key change or a trim can wait for the processing service (up to about two and a half minutes)
export const maxDuration = 180;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = (await req.json()) as Body;
    if (await isCatalogId(id)) throw new HttpError(400, "Built-in songs are already checked by hand and can't be processed again.");
    const { data: row } = await (await userClient()).from("songs").select("status,data").eq("id", id).maybeSingle();
    if (!row) throw new HttpError(404, "Song not found");
    const db = adminClient();
    const song = row.data as Song;
    // a job is live while it waits (up to 15 minutes) or runs (up to 45); older ones never finished and are closed
    const { data: open } = await db.from("jobs").select("id,status,created_at,started_at").eq("user_id", user.id).eq("song_id", id)
      .eq("kind", "process").in("status", ["queued", "running"]);
    const age = (s: string | null) => (Date.now() - Date.parse(s ?? "")) / 60000;
    const live = (open ?? []).filter((j) => (j.status === "queued" ? age(j.created_at) < 15 : age(j.started_at ?? j.created_at) < 45));
    const stale = (open ?? []).filter((j) => !live.includes(j)).map((j) => j.id);
    if (stale.length) {
      await db.from("jobs").update({ status: "failed", error: "Processing didn't finish.", finished_at: new Date().toISOString() }).in("id", stale);
    }
    const processing = live.length > 0;

    if (body.kind === "process") {
      if (processing) throw new HttpError(409, "This song is already being processed.");
      let steps: string[];
      const stepParams: Record<string, Record<string, unknown>> = {};
      const next: Song = { ...song, settings: { ...song.settings, cleanup: { ...song.settings.cleanup } }, language: { ...song.language }, steps: { ...song.steps } };
      if (body.new) {
        if (row.status !== "uploading") throw new HttpError(409, "This song was already started.");
        const files = await fileNames(`${user.id}/${id}`);
        if (!files.has(song.files.original)) throw new HttpError(400, "The file didn't arrive. Try adding it again.");
        steps = STEPS.map((s) => s.id);
      } else {
        const s = stepsFor(body.step ?? "", song);
        if (!s) throw new HttpError(400, "Unknown step");
        steps = s;
        if (steps.includes("cleanup")) stepParams.cleanup = { detail_level: body.detail_level ?? null, overrides: null };
        if (steps.includes("lyrics") && body.language !== undefined) {
          stepParams.lyrics = { language: body.language || null };
          next.language.override = body.language || null;
        }
        if (steps.includes("melody") && body.detail_level) next.settings.detail_level = body.detail_level;
        if (body.hold_across_words !== undefined) next.settings.cleanup.hold_across_words = !!body.hold_across_words;
      }
      next.status = "processing";
      next.error = null;
      for (const st of steps) if (STEPS.some((x) => x.id === st)) next.steps[st] = { status: "pending", progress: 0 };
      await db.from("songs").update({ status: "processing", data: next }).eq("id", id).eq("user_id", user.id);
      const jobId = await createJob(user.id, id, "process", { new: !!body.new, steps, step_params: stepParams, retry: body.step === "retry" });
      await dispatch(jobId);
      return Response.json({ song: next, snapshot: { ...snapshotFromSong(next, true), status: "processing" } });
    }

    if (body.kind === "trim" || body.kind === "lyrics") {
      if (processing || row.status !== "ready") throw new HttpError(409, "The song is still being processed. Try again when it is ready.");
      const params = body.kind === "trim" ? { start: Number(body.start ?? 0), end: body.end == null ? null : Number(body.end) } : { text: String(body.text ?? "").slice(0, 20000) };
      if (body.kind === "trim" && song.duration && (params as { start: number }).start < 0.05 && (!params.end || song.duration - (params.end as number) < 0.05)) {
        return Response.json({ song });
      }
      const jobId = await createJob(user.id, id, body.kind, params);
      const status = await dispatch(jobId, { wait: true });
      const { data: job } = await db.from("jobs").select("status,error").eq("id", jobId).maybeSingle();
      if ((job?.status ?? status) !== "done") {
        throw new HttpError(500, job?.error ?? (body.kind === "trim" ? "The song could not be trimmed. Try again." : "The lyrics could not be lined up. Try again."));
      }
      const { data: fresh } = await db.from("songs").select("data").eq("id", id).eq("user_id", user.id).maybeSingle();
      return Response.json({ song: fresh?.data ?? song });
    }
    throw new HttpError(400, "Unknown job");
  });
}
