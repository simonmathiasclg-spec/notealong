// The link in the sign-in email lands here: it signs the user in on this device and opens the app.
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/cloud/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const raw = url.searchParams.get("next") ?? "/";
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
