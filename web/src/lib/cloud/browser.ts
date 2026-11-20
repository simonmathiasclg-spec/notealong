// The Supabase client in the browser. It carries the signed-in user's session, so every query it makes is
// limited by row-level security to that user's own rows and files.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/** Whether someone is signed in in this browser (guests can browse and play the built-in songs). */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase().auth.getSession();
  return !!data.session;
}

/** The signed-in user's id (from the session kept in this browser). */
export async function userId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("You are signed out. Sign in again to continue.");
  return id;
}
