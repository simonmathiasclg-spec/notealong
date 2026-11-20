// Online version only: keeps the sign-in session fresh and decides which pages a signed-out visitor may open.
// Guests may browse Discover and play the built-in songs; everything private (My songs, setlists, the account,
// the owner's overview, uploads) sends them to the sign-in page first. This is only the front door: each route
// and every database query checks the user again, and row-level security keeps a guest away from every
// private row and file. In the local version (no Supabase settings) it lets everything through.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL, catalogFile } from "./lib/cloud/config";

const PUBLIC = ["/sign-in", "/auth/", "/terms", "/privacy", "/api/cloud/sign-in"];
/** Open to guests: Discover and the search. */
const GUEST_PAGES = ["/", "/browse"];

// The built-in songs' ids, from the public catalog index, kept for ten minutes.
let catalogIds: { ids: Set<string>; at: number } | null = null;
async function isCatalogSong(id: string): Promise<boolean> {
  if (!catalogIds || Date.now() - catalogIds.at > 10 * 60 * 1000) {
    try {
      const res = await fetch(catalogFile("index.json"), { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`catalog index ${res.status}`);
      const c = (await res.json()) as { songs: { id: string }[] };
      catalogIds = { ids: new Set(c.songs.map((s) => s.id)), at: Date.now() };
    } catch {
      // the index can't be read right now: the song page itself only ever shows a guest a built-in song
      // (an upload id finds nothing without its owner's session), so letting the page open is safe
      return true;
    }
  }
  return catalogIds.ids.has(id);
}

/** A page a guest may open: Discover, the search, and a built-in song's page or player. */
async function openToGuests(path: string): Promise<boolean> {
  if (GUEST_PAGES.includes(path)) return true;
  const m = path.match(/^\/songs?\/([a-z0-9][a-z0-9-]{0,120})(\/print)?\/?$/);
  return !!m && (await isCatalogSong(m[1]));
}

export async function proxy(request: NextRequest) {
  if (!CLOUD) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const open = PUBLIC.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));
  if (!data?.claims && !open && !path.startsWith("/api/") && !(await openToGuests(path))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // pages and the app's own API; not the static files, pictures or the instrument samples
  matcher: ["/((?!_next/static|_next/image|favicon.ico|instruments/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|json|txt)$).*)"],
};
