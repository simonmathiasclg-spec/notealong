// Checks the online version's privacy rules against a Supabase project (local or hosted):
// each user sees and changes only their own rows and files, anyone can sign up, the waitlist can be joined but
// not read, deleting an account removes everything in it, a guest (the anon key) can write nothing, a free
// account gets exactly one new song for good, and a tester (allowlist) still gets 10 a day.
//
//   cd web && node ../supabase/tests/privacy_check.mjs        (reads SUPABASE_URL, SUPABASE_ANON_KEY,
//                                                              SUPABASE_SERVICE_ROLE_KEY from the environment;
//                                                              with WEB_URL set, also tries the upload route)
// It creates throwaway users (…@notealong.test) and removes them again at the end.
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
const newSong = (id, user) => ({ id, user_id: user, title: "Free song", status: "uploading", data: { id, title: "Free song", status: "uploading", notes: [], words: [], lines: [] } });
const failed = (r, code) => !!r.error && (!code || (r.error.message ?? "").includes(code));

// The access model: guests write nothing, a free account converts one song for good, testers get 10 a day.
async function freeTierChecks(ub, b) {
  // --- a guest (signed out: the anon key only) ---
  const guest = createClient(URL_, ANON, opts);
  ok(failed(await guest.rpc("record_play", { p_song_id: "abide-with-me" })), "a guest can't log plays");
  ok(failed(await guest.from("plays").insert({ user_id: ub.id, song_id: "abide-with-me", count: 1 })), "a guest can't write to plays");
  ok(failed(await guest.from("catalog_edits").insert({ user_id: ub.id, song_id: "abide-with-me", data: {} })), "a guest can't write note fixes (catalog_edits)");
  ok(failed(await guest.from("favourites").insert({ user_id: ub.id, song_id: "abide-with-me" })), "a guest can't write favourites");
  ok(failed(await guest.from("setlists").insert({ user_id: ub.id, name: "x" })), "a guest can't write setlists");
  ok(failed(await guest.from("jobs").insert({ user_id: ub.id, song_id: "abide-with-me", kind: "render" })), "a guest can't start jobs");
  ok(failed(await guest.rpc("my_allowance")) && failed(await guest.rpc("join_paid_interest")), "a guest can't ask for an allowance or join the paid list as someone");
  ok(((await guest.from("catalog_edits").select("song_id")).data ?? []).length === 0 && ((await guest.from("jobs").select("id")).data ?? []).length === 0
    && ((await guest.from("plays").select("song_id")).data ?? []).length === 0, "a guest reads no plays, edits or jobs (and gets no error)");

  // --- a free account: one new song, for good ---
  const emailF = `privacy-f-${tag}@notealong.test`;
  const f1 = (await admin.auth.admin.createUser({ email: emailF, email_confirm: true })).data.user;
  users.push(f1);
  const fc = await signedIn(emailF);
  const before = (await fc.rpc("my_allowance")).data;
  ok(before?.plan === "free" && before?.remaining === 1, "a new account has one free song");
  const s1 = `privacy-${tag}-free00001`;
  ok(failed(await fc.from("songs").insert(newSong(s1, f1.id))), "a free account can't create a song directly through Supabase");
  ok(!(await admin.from("songs").insert(newSong(s1, f1.id))).error, "the upload route can create the first song");
  ok(failed(await admin.from("songs").insert(newSong(`${s1}b`, f1.id)), "FREE_SONG_PENDING"), "a second file can't start while the free song is on its way");
  ok(!(await admin.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "process", params: { new: true } })).error, "processing the free song starts");
  ok(failed(await fc.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "process", params: { new: true } })), "a free account can't start a job directly through Supabase");
  ok((await fc.rpc("my_allowance")).data?.remaining === 0, "after that the free song is used");
  ok(failed(await admin.from("songs").insert(newSong(`${s1}c`, f1.id)), "FREE_SONG_USED"), "a second new song is refused (the route's insert, enforced by the database)");
  const again = await Promise.all([
    admin.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "process", params: { new: false, step: "retry" } }),
    admin.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "render", params: {} }),
    admin.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "trim", params: {} }),
    admin.from("jobs").insert({ user_id: f1.id, song_id: s1, kind: "lyrics", params: {} }),
  ]);
  ok(again.every((r) => !r.error), "retries, re-processing, key changes, trims and pasted lyrics on that song still work");
  ok(((await fc.from("upload_counts").select("new_songs")).data ?? [])[0]?.new_songs === 1, "and they use nothing up (the lifetime count stays 1)");
  ok(((await b.from("upload_counts").select("user_id")).data ?? []).length === 0, "another user can't see that count");
  await admin.from("songs").delete().eq("id", s1);
  ok(failed(await admin.from("songs").insert(newSong(`${s1}d`, f1.id)), "FREE_SONG_USED"), "deleting the free song does not give it back");

  // deleted and created again with the same email: still used (only a salted hash of the email is kept)
  await admin.auth.admin.deleteUser(f1.id);
  users.splice(users.indexOf(f1), 1);
  const leftCount = await admin.from("upload_counts").select("user_id").eq("user_id", f1.id);
  ok(!leftCount.data?.length, "deleting the account removes its count");
  const f2 = (await admin.auth.admin.createUser({ email: emailF, email_confirm: true })).data.user;
  users.push(f2);
  const fc2 = await signedIn(emailF);
  ok((await fc2.rpc("my_allowance")).data?.remaining === 0, "a new account with the same email has no free song");
  ok(failed(await admin.from("songs").insert(newSong(`${s1}e`, f2.id)), "FREE_SONG_USED"), "and can't create a new song");
  const caps = emailF.toUpperCase();
  const f3 = (await admin.auth.admin.createUser({ email: `x${caps}`.slice(1), email_confirm: true }));
  ok(!!f3.error || failed(await admin.from("songs").insert(newSong(`${s1}f`, f3.data.user.id)), "FREE_SONG_USED"), "the same email in capitals is the same email");
  if (f3.data?.user) users.push(f3.data.user);
  ok(failed(await fc2.rpc("upload_allowance", { p_user: ub.id })) && failed(await fc2.rpc("free_song_used", { p_user: ub.id })), "a user can't ask about another account's allowance");
  ok(failed(await fc2.from("settings").select("*")) && failed(await guest.schema("private").from("free_song_used").select("*")), "nobody can read the salt or the email hashes");
  ok(!(await fc2.rpc("join_paid_interest")).error && !(await fc2.rpc("join_paid_interest")).error, "a free account can join the paid-plan interest list (twice is fine)");
  const paid = await admin.from("waitlist").select("email,kind").eq("kind", "paid").ilike("email", emailF);
  ok(paid.data?.length === 1, "it is on the list once, with its own email");

  // --- a tester (on the allowlist): 10 new songs per 24 hours ---
  const tester = (await admin.auth.admin.createUser({ email: `privacy-t-${tag}@notealong.test`, email_confirm: true })).data.user;
  users.push(tester);
  await admin.from("allowlist").upsert({ email: `privacy-t-${tag}@notealong.test`, note: "privacy check" });
  let tenOk = true;
  for (let i = 0; i < 10; i++) {
    const id = `privacy-${tag}-test0000${i}`;
    tenOk = tenOk && !(await admin.from("songs").insert(newSong(id, tester.id))).error
      && !(await admin.from("jobs").insert({ user_id: tester.id, song_id: id, kind: "process", params: { new: true } })).error;
  }
  ok(tenOk, "a tester can add 10 new songs in a day");
  ok(failed(await admin.from("songs").insert(newSong(`privacy-${tag}-test00010`, tester.id)), "DAILY_LIMIT"), "the 11th in 24 hours is refused");
  const tc = await signedIn(`privacy-t-${tag}@notealong.test`);
  const ta = (await tc.rpc("my_allowance")).data;
  ok(ta?.plan === "beta" && ta?.limit === 10 && ta?.remaining === 0, "a tester sees the daily limit, not the free song");
  await admin.from("allowlist").delete().eq("email", `privacy-t-${tag}@notealong.test`);

  // --- the upload route itself (with WEB_URL: a web server running against this Supabase) ---
  if (process.env.WEB_URL) await routeChecks();
}

/** A cookie header for a signed-in client, as @supabase/ssr reads it (chunked like the browser does). */
async function cookieFor(client) {
  const { data } = await client.auth.getSession();
  const name = `sb-${new globalThis.URL(URL_).hostname.split(".")[0]}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const parts = value.match(/.{1,3180}/g);
  return parts.length === 1 ? `${name}=${value}` : parts.map((p, i) => `${name}.${i}=${p}`).join("; ");
}

async function routeChecks() {
  const web = process.env.WEB_URL.replace(/\/$/, "");
  const email = `privacy-r-${tag}@notealong.test`;
  const u = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user;
  users.push(u);
  const cookie = await cookieFor(await signedIn(email));
  const post = (path, body) => fetch(`${web}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
  const first = await post("/api/cloud/uploads", { filename: "song.mp3", size: 1000, hash: "a".repeat(64) });
  const started = await first.json();
  ok(first.ok && !!started.upload?.url, "route: a free account can start its first upload");
  await admin.storage.from("uploads").upload(`${u.id}/${started.song.id}/original.mp3`, new Blob([randomBytes(1000)]), { contentType: "audio/mpeg" });
  const pending = await post("/api/cloud/uploads", { filename: "other.mp3", size: 1000, hash: "b".repeat(64) });
  ok(pending.status === 409, "route: a second file waits until the first is converted");
  await post(`/api/cloud/songs/${started.song.id}/jobs`, { kind: "process", new: true });      // dispatch may be off: the job is still counted
  const second = await post("/api/cloud/uploads", { filename: "other.mp3", size: 1000, hash: "b".repeat(64) });
  const msg = (await second.json()).detail ?? "";
  ok(second.status === 403 && /used your free song/i.test(msg), "route: a second new song is refused with the paid-plans message");
  const anonUpload = await fetch(`${web}/api/cloud/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "a.mp3", size: 10 }) });
  ok(anonUpload.status === 401, "route: a guest can't start an upload");
  const files = await admin.storage.from("uploads").list(`${u.id}/${started.song.id}`);
  await admin.storage.from("uploads").remove((files.data ?? []).map((x) => `${u.id}/${started.song.id}/${x.name}`));
}
try {
  await admin.from("allowlist").upsert([{ email: emailA, note: "privacy check" }, { email: emailB, note: "privacy check" }]);
  const open = await admin.auth.admin.createUser({ email: outsider, email_confirm: true });
  ok(!open.error, "anyone can create an account (sign-up is open; the beta list only marks testers)");
  if (open.data?.user) users.push(open.data.user);

  for (const email of [emailA, emailB]) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users.push(data.user);
  }
  const [, ua, ub] = users;
  users.splice(0, 1);
  await admin.auth.admin.deleteUser(open.data.user.id);
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

  await freeTierChecks(ub, b);
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
  await admin.from("waitlist").delete().ilike("email", `privacy-%-${tag}@notealong.test`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll privacy checks passed");
  process.exit(failures ? 1 : 0);
}
