// Sends a sign-in link by email. Anyone can create an account; the answer is the same whether or not the email
// already has one, so this page can't be used to find out who uses NoteAlong. Abuse protection: Supabase's own
// rate limits, and Cloudflare Turnstile when it is switched on (the browser's token is passed to Supabase,
// which checks it with the secret set in its captcha settings).
import { HttpError, route, userClient } from "@/lib/cloud/server";

export async function POST(req: Request) {
  return route(async () => {
    const body = (await req.json()) as { email?: string; next?: string; captchaToken?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) throw new HttpError(400, "That doesn't look like an email address.");
    const next = typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/";
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !body.captchaToken) throw new HttpError(400, "Please complete the check above the button, then try again.");
    const origin = new URL(req.url).origin;
    const { error } = await (await userClient()).auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        captchaToken: body.captchaToken || undefined,
      },
    });
    if (error) {
      console.error("sign-in email failed", error.message);
      // Supabase's built-in sender only mails the project's own team; until an email sender (or Google) is set up
      if (/not authori[sz]ed/i.test(error.message)) {
        throw new HttpError(503, process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1"
          ? "Sign-in by email isn't open yet. Continue with Google instead."
          : "New accounts aren't open just yet. Every built-in song is free to play in the meantime.");
      }
      if (/captcha/i.test(error.message)) throw new HttpError(400, "The check above the button didn't go through. Try it again.");
      if (/rate|seconds|limit/i.test(error.message)) {
        throw new HttpError(429, process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1"
          ? "Too many sign-in emails were sent just now. Continue with Google, or try the email link again later."
          : "Too many sign-in emails were sent just now. Try again in an hour. Every built-in song is free to play meanwhile.");
      }
      throw new HttpError(500, "The sign-in email could not be sent. Try again in a minute, or continue with Google.");
    }
    return Response.json({ ok: true });
  });
}
