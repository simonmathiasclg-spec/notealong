// Starts an upload: checks the daily limit and the file, then hands the browser a one-time link to put the file
// straight into the user's private folder in storage (it never passes through this server).
import { AUDIO_EXT, MAX_UPLOAD_MB, PROTECTED_EXT, UPLOADS_PER_DAY, VIDEO_EXT } from "@/lib/cloud/config";
import { adminClient, HttpError, requireUser, route, userClient } from "@/lib/cloud/server";
import { guessTitle, newSongData, newSongId } from "@/lib/cloud/songdata";

export async function POST(req: Request) {
  return route(async () => {
    const user = await requireUser();
    const body = (await req.json()) as { filename?: string; size?: number; hash?: string; instrument?: string; detail_level?: string };
    const filename = String(body.filename ?? "song").slice(0, 300);
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    if (PROTECTED_EXT.includes(ext)) throw new HttpError(400, "That is a copy-protected file (Apple Music or an audiobook). Use a song you own as an MP3, M4A, WAV or FLAC.");
    if (!AUDIO_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) throw new HttpError(400, "That kind of file isn't supported. Use an audio file (MP3, M4A, WAV, FLAC, OGG) or a video (MP4, MOV, WEBM, MKV).");
    if (!body.size || body.size > MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(400, `That file is bigger than ${MAX_UPLOAD_MB} MB. Export the song as an MP3 or M4A, or trim a video to the song.`);
    const db = adminClient();
    const mine = await userClient();

    // the very same file again: open the song that is already there (only this user's songs are looked at)
    const hash = typeof body.hash === "string" && /^[0-9a-f]{64}$/.test(body.hash) ? body.hash : null;
    if (hash) {
      const { data: same } = await mine.from("songs").select("data").eq("content_hash", hash).eq("status", "ready").limit(1).maybeSingle();
      if (same) return Response.json({ song: same.data, duplicate_of: (same.data as { id: string }).id });
    }

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await db.from("jobs").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("kind", "process").eq("params->>new", "true").gte("created_at", since);
    const { count: pending } = await db.from("songs").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("status", "uploading").gte("created_at", since);
    if ((count ?? 0) + (pending ?? 0) >= UPLOADS_PER_DAY) {
      throw new HttpError(429, `You've added ${UPLOADS_PER_DAY} songs in the last 24 hours, the most the beta allows. You can add more tomorrow.`);
    }

    const { title, artist } = guessTitle(filename);
    const id = newSongId(title);
    const data = newSongData({ id, title, artist, filename, ext, instrument: body.instrument, detail_level: body.detail_level, titleFromName: true });
    const { error } = await db.from("songs").insert({ id, user_id: user.id, title, artist, status: "uploading", data, content_hash: hash });
    if (error) throw error;
    const { data: link, error: linkError } = await db.storage.from("uploads").createSignedUploadUrl(`${user.id}/${id}/original.${ext}`, { upsert: true });
    if (linkError || !link) throw linkError ?? new Error("no upload link");
    return Response.json({ song: data, upload: { url: link.signedUrl } });
  });
}
