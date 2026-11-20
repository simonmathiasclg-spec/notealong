// The link in the sign-in email lands here: it signs the user in on this device and opens the app.
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/cloud/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  // `back` (from the email): the address the sign-in was asked from, whose own `next` is where to go afterwards
  let raw = url.searchParams.get("next") ?? "/";
  const back = url.searchParams.get("back");
  if (back) {
    try { raw = new URL(back).searchParams.get("next") ?? "/"; } catch { raw = "/"; }
  }
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const sb = await userClient();
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  let ok = false;
  if (tokenHash) {
    const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
    ok = !(await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  }
  return NextResponse.redirect(new URL(ok ? next : "/sign-in?link=expired", url.origin));
}
