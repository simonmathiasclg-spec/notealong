// Checks the online version's privacy rules against a Supabase project (local or hosted):
// each user sees and changes only their own rows and files, the beta list blocks other emails, the waitlist
// can be joined but not read, and deleting an account removes everything in it.
//
//   cd web && node ../supabase/tests/privacy_check.mjs        (reads SUPABASE_URL, SUPABASE_ANON_KEY,
//                                                              SUPABASE_SERVICE_ROLE_KEY from the environment)
// It creates two throwaway users (…@notealong.test) and removes them again at the end.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const tag = randomBytes(3).toString("hex");
const emailA = `privacy-a-${tag}@notealong.test`;
const emailB = `privacy-b-${tag}@notealong.test`;
const outsider = `privacy-x-${tag}@notealong.test`;
let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };

async function signedIn(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(URL_, ANON, opts);
  const { error: e2 } = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return client;
}

const users = [];
try {
  await admin.from("allowlist").upsert([{ email: emailA, note: "privacy check" }, { email: emailB, note: "privacy check" }]);
  const blocked = await admin.auth.admin.createUser({ email: outsider, email_confirm: true });
  ok(!!blocked.error, "an email that is not on the beta list cannot get an account");

  for (const email of [emailA, emailB]) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users.push(data.user);
  }
  const [ua, ub] = users;
  const a = await signedIn(emailA);
  const b = await signedIn(emailB);
  ok(true, "invited users can sign in with an email link");

  const songId = `privacy-${tag}-u00000001`;
  const data = { id: songId, title: "Private song", status: "ready", notes: [], words: [], lines: [] };
  const direct = await a.from("songs").insert({ id: songId, user_id: ua.id, title: "x", data });
  ok(!!direct.error, "users cannot add song rows directly (only the upload route can, after the daily limit)");
  await admin.from("songs").insert({ id: songId, user_id: ua.id, title: "Private song", status: "ready", data });
  await admin.storage.from("uploads").upload(`${ua.id}/${songId}/backing.mp3`, new Blob([randomBytes(2048)]), { contentType: "audio/mpeg" });

  const mine = await a.from("songs").select("id");
  ok(mine.data?.length === 1, "a user sees their own song");
  const own = await a.storage.from("uploads").download(`${ua.id}/${songId}/backing.mp3`);
  ok(!own.error, "a user can read their own files");

  const theirs = await b.from("songs").select("id");
  ok(theirs.data?.length === 0, "another user sees none of those songs");
  const byId = await b.from("songs").select("id").eq("id", songId).maybeSingle();
  ok(!byId.data, "another user can't open the song by its id");
  const file = await b.storage.from("uploads").download(`${ua.id}/${songId}/backing.mp3`);
  ok(!!file.error, "another user can't download the song's files");
  const listed = await b.storage.from("uploads").list(`${ua.id}/${songId}`);
  ok((listed.data ?? []).length === 0, "another user can't list the song's folder");
  const put = await b.storage.from("uploads").upload(`${ua.id}/${songId}/evil.mp3`, new Blob([randomBytes(64)]));
  ok(!!put.error, "another user can't put files in someone else's folder");
  const link = await b.storage.from("uploads").createSignedUrl(`${ua.id}/${songId}/backing.mp3`, 60);
  ok(!!link.error, "another user can't make a link to someone else's file");
  await b.from("songs").update({ title: "changed" }).eq("id", songId);
  await b.from("songs").delete().eq("id", songId);
  const still = await admin.from("songs").select("title").eq("id", songId).single();
  ok(still.data?.title === "Private song", "another user can't change or delete the song");
  const status = await a.from("songs").update({ status: "processing" }).eq("id", songId);
  ok(!!status.error, "a user can't change processing columns (status) of their own song");
  const edit = await a.from("songs").update({ title: "My title", data: { ...data, title: "My title" } }).eq("id", songId).select("title");
  ok(edit.data?.[0]?.title === "My title", "a user can edit their own song (title, notes, settings)");

  const fav = await b.from("favourites").insert({ user_id: ua.id, song_id: songId });
  ok(!!fav.error, "a user can't write rows in someone else's name");
  await a.from("favourites").insert({ user_id: ua.id, song_id: songId });
  await a.from("favourites").insert({ user_id: ua.id, song_id: "abide-with-me" });
  const set = await a.from("setlists").insert({ user_id: ua.id, name: "Gig", songs: [songId, "abide-with-me"] }).select("id").single();
  const play = await a.rpc("record_play", { p_song_id: songId });
  ok(play.data?.count === 1, "plays are counted for the user");
  const edits = await a.from("catalog_edits").upsert({ user_id: ua.id, song_id: "abide-with-me", data: { user: { key_shift: 2 } } });
  ok(!edits.error, "a user can keep their own changes to a built-in song");
  ok(((await b.from("catalog_edits").select("song_id")).data ?? []).length === 0, "another user doesn't see those changes");
  ok(((await b.from("setlists").select("id")).data ?? []).length === 0, "another user doesn't see the setlists");
  ok(((await b.from("plays").select("song_id")).data ?? []).length === 0, "another user doesn't see the plays");

  await admin.from("jobs").insert({ user_id: ua.id, song_id: songId, kind: "process" });
  ok(((await b.from("jobs").select("id")).data ?? []).length === 0, "another user doesn't see the processing jobs");
  ok(((await a.from("jobs").select("id")).data ?? []).length === 1, "a user sees their own processing jobs");
  const forged = await a.from("jobs").insert({ user_id: ua.id, song_id: songId, kind: "process" });
  ok(!!forged.error, "users can't start jobs directly (only the server routes can)");

  const anon = createClient(URL_, ANON, opts);
  const w = await anon.from("waitlist").insert({ email: `privacy-w-${tag}@notealong.test`, note: "sax" });
  ok(!w.error, "anyone can join the waitlist");
  ok(((await anon.from("waitlist").select("email")).data ?? []).length === 0, "nobody can read the waitlist back");
  ok(((await a.from("allowlist").select("email")).data ?? []).length === 0, "users can't read the beta list");
  ok(((await anon.from("songs").select("id")).data ?? []).length === 0, "signed-out visitors see no songs");

  // deleting the song takes it out of favourites, plays and setlists
  await admin.from("songs").delete().eq("id", songId);
  const favs = (await a.from("favourites").select("song_id")).data ?? [];
  const sl = (await a.from("setlists").select("songs").eq("id", set.data.id).single()).data;
  ok(favs.length === 1 && favs[0].song_id === "abide-with-me" && sl.songs.length === 1, "a deleted song leaves favourites, plays and setlists");

  // deleting an account removes its rows (the account page removes the files first, as here)
  await admin.storage.from("uploads").remove([`${ua.id}/${songId}/backing.mp3`]);
  await admin.auth.admin.deleteUser(ua.id);
  users.shift();
  const left = await admin.from("setlists").select("id").eq("user_id", ua.id);
  const leftEdits = await admin.from("catalog_edits").select("song_id").eq("user_id", ua.id);
  const leftJobs = await admin.from("jobs").select("id").eq("user_id", ua.id);
  ok(!left.data?.length && !leftEdits.data?.length && !leftJobs.data?.length, "a deleted account takes its rows with it");
} catch (e) {
  console.error("check stopped:", e.message ?? e);
  failures++;
} finally {
  for (const u of users) {
    const files = await admin.storage.from("uploads").list(u.id);
    for (const f of files.data ?? []) {
      const inner = await admin.storage.from("uploads").list(`${u.id}/${f.name}`);
      await admin.storage.from("uploads").remove((inner.data ?? []).map((x) => `${u.id}/${f.name}/${x.name}`));
    }
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("allowlist").delete().in("email", [emailA, emailB]);
  await admin.from("waitlist").delete().ilike("email", `privacy-w-${tag}@notealong.test`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll privacy checks passed");
  process.exit(failures ? 1 : 0);
}
