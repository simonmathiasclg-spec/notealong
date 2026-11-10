// Supabase on the server (route handlers and server components). `userClient` acts as the signed-in user
// (row-level security applies); `adminClient` uses the service role and must always filter by user itself.
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a server component, where cookies are read-only; the proxy refreshes the session
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  if (!admin) admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function currentUser(): Promise<User | null> {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export function isAdmin(user: User | null): boolean {
  const admins = (process.env.ADMIN_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!user?.email && admins.includes(user.email.toLowerCase());
}

/** A JSON error the browser shows as it is (`detail`, like the local service's errors). */
export function fail(status: number, detail: string): Response {
  return Response.json({ detail }, { status, headers: { "Cache-Control": "no-store" } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Runs a route body; an HttpError becomes its message, anything else a plain "something went wrong". */
export async function route(fn: () => Promise<Response>): Promise<Response> {
  if (!CLOUD) return fail(404, "Not found");
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    console.error(e);
    return fail(500, "Something went wrong on the server. Try again in a minute.");
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "You are signed out. Sign in again to continue.");
  return user;
}
