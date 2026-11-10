// Server side of the online version: processing jobs, the catalog index and file links.
// Used only by the route handlers under app/api/cloud (they run on the server with the service role).
import type { Song } from "../types";
import { catalogFile } from "./config";
import { adminClient, HttpError } from "./server";
import { SIGNED_URL_SECONDS } from "./songdata";

export type JobKind = "process" | "trim" | "lyrics" | "render";
export type JobRow = { id: string; status: string; kind: JobKind; params: Record<string, unknown>; snapshot: unknown; error: string | null; created_at: string };

export async function createJob(userId: string, songId: string, kind: JobKind, params: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from("jobs").insert({ user_id: userId, song_id: songId, kind, params }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function markUnreachable(jobId: string, message: string): Promise<void> {
  const db = adminClient();
  const { data: job } = await db.from("jobs").update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", jobId).eq("status", "queued").select("user_id,song_id,kind").maybeSingle();
  if (job?.kind === "process") {
    const { data: row } = await db.from("songs").select("data").eq("id", job.song_id).eq("user_id", job.user_id).maybeSingle();
    if (row) {
      const data = { ...(row.data as Song), status: "failed", error: message };
      await db.from("songs").update({ status: "failed", data }).eq("id", job.song_id).eq("user_id", job.user_id);
    }
  }
}

/** Hands a queued job to the processing service. `wait` keeps the request open until it is done (key changes). */
export async function dispatch(jobId: string, opts: { wait?: boolean } = {}): Promise<string> {
  const url = (process.env.PROCESSING_URL ?? "").replace(/\/$/, "");
  const secret = process.env.WORKER_SECRET ?? "";
  if (!url || !secret) {
    const msg = "Processing isn't switched on for this site yet. Try again later.";
    await markUnreachable(jobId, msg);
    throw new HttpError(503, msg);
  }
  try {
    const res = await fetch(`${url}/jobs/${jobId}${opts.wait ? "/wait" : ""}`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store",
      signal: AbortSignal.timeout(opts.wait ? 150_000 : 30_000),
    });
    if (!res.ok) throw new Error(`dispatch answered ${res.status}`);
    const body = (await res.json()) as { status?: string };
    return body.status ?? "queued";
  } catch (e) {
    console.error("dispatch failed", e);
    const msg = "The processing service could not be reached. Press retry in a minute.";
    await markUnreachable(jobId, msg);
    throw new HttpError(503, msg);
  }
}

/** Waits for a job another request started (two requests for the same key change share one render). */
export async function waitForJob(jobId: string, timeoutMs = 120_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { data } = await adminClient().from("jobs").select("status").eq("id", jobId).maybeSingle();
    if (!data || !["queued", "running"].includes(data.status)) return data?.status ?? "failed";
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "running";
}

// ---- the catalog --------------------------------------------------------------------------------
let catalogCache: { at: number; ids: Set<string> } | null = null;

export async function isCatalogId(id: string): Promise<boolean> {
  if (!catalogCache || Date.now() - catalogCache.at > 5 * 60 * 1000) {
    const res = await fetch(catalogFile("index.json"), { cache: "no-store" });
    if (!res.ok) return false;
    const c = (await res.json()) as { songs: { id: string }[] };
    catalogCache = { at: Date.now(), ids: new Set(c.songs.map((s) => s.id)) };
  }
  return catalogCache.ids.has(id);
}

// ---- files ----------------------------------------------------------------------------------------
export async function signedUrl(path: string, seconds = SIGNED_URL_SECONDS): Promise<string> {
  const { data, error } = await adminClient().storage.from("uploads").createSignedUrl(path, seconds);
  if (error || !data) throw new HttpError(404, "This file is not ready yet.");
  return data.signedUrl;
}

export async function fileNames(folder: string): Promise<Set<string>> {
  const { data } = await adminClient().storage.from("uploads").list(folder, { limit: 1000 });
  return new Set((data ?? []).filter((f) => f.id).map((f) => f.name));
}

/** Every file under a folder of the private bucket, in all its sub-folders. */
export async function allFiles(bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await adminClient().storage.from(bucket).list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data ?? []) {
      const p = `${folder}/${f.name}`;
      if (f.id) out.push(p);
      else out.push(...(await allFiles(bucket, p)));
    }
    if (!data || data.length < 1000) return out;
    offset += 1000;
  }
}

export async function removeFiles(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await adminClient().storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function publicExists(path: string): Promise<boolean> {
  const res = await fetch(catalogFile(path), { method: "HEAD", cache: "no-store" });
  return res.ok;
}
