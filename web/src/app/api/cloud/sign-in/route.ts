// Sends a sign-in link, but only to emails on the beta list. The answer is the same either way, so this page
// can't be used to find out who is invited.
import { adminClient, HttpError, route, userClient } from "@/lib/cloud/server";

export async function POST(req: Request) {
  return route(async () => {
    const body = (await req.json()) as { email?: string; next?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) throw new HttpError(400, "That doesn't look like an email address.");
    const next = typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/";
    const { data: invited } = await adminClient().from("allowlist").select("email").eq("email", email).maybeSingle();
    if (invited) {
      const origin = new URL(req.url).origin;
      const { error } = await (await userClient()).auth.signInWithOtp({
        email, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        console.error("sign-in email failed", error.message);
        if (/rate|seconds/i.test(error.message)) throw new HttpError(429, "A link was sent a moment ago. Check your email, or try again in a minute.");
        throw new HttpError(500, "The sign-in email could not be sent. Try again in a minute.");
      }
    }
    return Response.json({ ok: true });
  });
}
