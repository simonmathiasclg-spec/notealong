// An upload's cover: the picture the user chose, else the one inside the file, else a generated one.
// Private like everything about an upload: a short-lived link, only for the song's owner.
import type { Song } from "@/lib/types";
import { fileNames, signedUrl } from "@/lib/cloud/jobs";
import { HttpError, requireUser, route, userClient } from "@/lib/cloud/server";

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#2b2a33"/><circle cx="300" cy="300" r="150" fill="none" stroke="#5c5a6b" stroke-width="18"/><circle cx="300" cy="300" r="34" fill="#5c5a6b"/></svg>`;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const { data: row } = await (await userClient()).from("songs").select("data").eq("id", id).maybeSingle();
    if (!row) throw new HttpError(404, "Song not found");
    const song = row.data as Song;
    const files = await fileNames(`${user.id}/${id}`);
    for (const name of ["cover_user.jpg", "cover_user.png", song.files.cover ?? "", "cover.svg"]) {
      if (name && files.has(name)) {
        return new Response(null, { status: 302, headers: { Location: await signedUrl(`${user.id}/${id}/${name}`, 3600), "Cache-Control": "private, max-age=60" } });
      }
    }
    return new Response(PLACEHOLDER, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=30" } });
  });
}
