// The signed-in user's account. GET: who is signed in. DELETE: removes the account and everything in it
// (songs, files, edits, favourites, setlists, jobs, the invitation), then signs out.
import { allFiles, removeFiles } from "@/lib/cloud/jobs";
import { adminClient, isAdmin, requireUser, route, userClient } from "@/lib/cloud/server";

export async function GET() {
  return route(async () => {
    const user = await requireUser();
    return Response.json({ email: user.email, admin: isAdmin(user), created_at: user.created_at });
  });
}

export async function DELETE() {
  return route(async () => {
    const user = await requireUser();
    const db = adminClient();
    await db.from("jobs").update({ status: "stopped", finished_at: new Date().toISOString() }).eq("user_id", user.id).in("status", ["queued", "running"]);
    await removeFiles("uploads", await allFiles("uploads", user.id));
    if (user.email) {
      await db.from("waitlist").delete().ilike("email", user.email);
      await db.from("allowlist").delete().eq("email", user.email.toLowerCase());
    }
    // the rows (songs, edits, favourites, plays, setlists, jobs) go with the account: they cascade from auth.users
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw error;
    await (await userClient()).auth.signOut({ scope: "local" }).catch(() => {});
    return Response.json({ ok: true });
  });
}
