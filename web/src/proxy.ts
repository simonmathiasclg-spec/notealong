// Online version only: keeps the sign-in session fresh and sends signed-out visitors to the sign-in page.
// (Each route and every database query checks the user again; this is just the front door.)
// In the local version (no Supabase settings) it lets everything through.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL } from "./lib/cloud/config";

const PUBLIC = ["/sign-in", "/auth/", "/terms", "/privacy", "/api/cloud/sign-in"];

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
  if (!data?.claims && !open && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // pages and the app's own API; not the static files, pictures or the instrument samples
  matcher: ["/((?!_next/static|_next/image|favicon.ico|instruments/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|json|txt)$).*)"],
};
