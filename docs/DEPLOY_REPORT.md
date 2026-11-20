# NoteAlong online: deploy report

## Summary

- **Live: https://notealong.vercel.app**. Anyone can open it, browse the 208 built-in songs and play any of them in the player, with no account.
- **Hosting:** Supabase project "notealong" (us-east-1) in the personal organization "Simon Personal" (zchrxexblzgmuwtjowqv), Modal (profile simon-mathiasclg, T4 GPU), Vercel project "notealong" (scope simonmathiasclg-9145s-projects). Nothing was created in the employer's organization; `deploy.sh` now refuses it outright.
- **Sign-up is open: "Continue with Google".** Since 20 November 2026 anyone with a Google account can create an account in one click and convert their free song. Google is the main button on the sign-in page; the email link is second, and when Supabase's built-in sender refuses or limits it, the page says "Sign-in by email is limited for now. Please use Continue with Google above." Email sign-up for everyone needs your own sender (to-do 3).
- **Real cost per song:** about 98 GPU-seconds on a T4 for a 2:32 song, about **$0.016**, or about **$0.026** when the GPU machine then sits idle for its 60-second wait. Details below.

## Who can do what

| Who | What they can do |
| --- | --- |
| Guest (not signed in) | Browse Discover and the search; open and play every built-in song in the player, with Hear it played, the sheet view, loops and the keys of a built-in song that are already made. Note fixes work on the page but aren't kept. Favourites, setlists and a new key ask them to sign in ("Sign in to change key", "Sign in to keep your favourites"). Upload buttons say "Sign up free to convert your own song" and come back to the upload after sign-in. |
| Free account (anyone who signs in) | Everything a guest can, saved; plus ONE song of their own, converted for good, with full use of it (key changes, note fixes, trims, pasted lyrics, setlists, favourites, retries). After that, uploading shows "You've used your free song. Paid plans are coming soon." with "Tell me when paid plans open". |
| Testers (emails on `allowlist`) and the owner (`ADMIN_EMAIL`, added to `allowlist` by deploy.sh) | The beta limits: 10 new songs in any 24 hours. |

How the free song is enforced:
- The database checks every insert that makes a new song (`check_new_song` on `songs`, `count_new_song` on the "new" process job), so neither a route bug nor a direct API call can get round it. The upload route asks the database for the allowance first, to give a plain message.
- Retries, re-processing, key changes, trims and pasted lyrics never insert a new song, so they use nothing up.
- Deleting the song doesn't give it back: the lifetime count is in `upload_counts`, not in `songs`.
- The same file again opens the song already there and doesn't count.
- "Delete my account" still removes every row and file. The only thing kept is a salted SHA-256 hash of the email of an account that used its free song, so a new account with that email starts with it used. The salt lives in a private schema the API can't reach. The Privacy page says this.

## Your to-dos, in order

1. **Check that Google sign-in is published.** Open https://console.cloud.google.com/auth/audience?project=notealong-515321. Under "Publishing status" it must say "In production". If it says "Testing", click "Publish app" and confirm; until then only the test users listed there can sign in with Google.
2. **Cloudflare Turnstile (blocks automated sign-ups; works on notealong.vercel.app, no custom domain needed).**
   1. Create a free account at https://dash.cloudflare.com, open Turnstile, click "Add widget".
   2. Name it NoteAlong, add the hostname `notealong.vercel.app`, choose "Managed", create it.
   3. Copy the Site key and the Secret key.
   4. Send me the Site key (it is public), or add these two lines to `.env.cloud` yourself: `TURNSTILE_SITE_KEY=...` and `TURNSTILE_SECRET_KEY=...`. Then I run `./deploy.sh`, which puts the site key on Vercel and switches captcha on in Supabase together. Don't switch captcha on in Supabase alone: until the site shows the check, email sign-in would stop working. (Google sign-in isn't affected by captcha.)
3. **A real email sender (Resend), for email-link sign-ups beyond a handful.** It needs a domain you own: without one, Resend only sends to your own address.
   1. Sign up at https://resend.com, open Domains, add your domain, and add the DNS records it shows at your domain registrar.
   2. Open API Keys and create a key with "Sending access".
   3. In Supabase: Authentication, then Emails, then SMTP Settings. Switch on custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = the API key, sender email `noreply@<your domain>`, sender name NoteAlong. Save.
   4. In Supabase: Authentication, then Rate Limits: raise "emails sent per hour" (for example to 100).
   5. Add `SMTP_HOST=smtp.resend.com` to `.env.cloud` and run `./deploy.sh` (or ask me): with your own sender, the NoteAlong email template is used too, and its link also works when opened on another device.
4. **The owner's overview (`/admin`)**: `ADMIN_EMAIL` is still unset. To use it, add `ADMIN_EMAIL=<your email>` to `.env.cloud` and run `SUPA_ORG=zchrxexblzgmuwtjowqv ./deploy.sh`: you get `/admin` and the testers' 10 songs a day.
5. **Later:**
   - Google's account picker says "to continue to npnjprtmiknqtdmzdgji.supabase.co" rather than NoteAlong. Showing your own name there needs a Supabase custom domain (a paid add-on on Supabase Pro).
   - Your own Google account was used for the live test, so its free song now counts as used (a salted hash of the email is kept, as for any deleted account). Signing in with it after `ADMIN_EMAIL` is set (to-do 4) gives you the owner's 10 songs a day anyway.
   - Vercel's free Hobby plan is for non-commercial use: move to Vercel Pro before you charge anyone.
   - A lawyer should review `/terms` and `/privacy` and fill in the contact email, the governing law and the age limit.
   - Supabase's free plan pauses a project after a week with no activity; a visit wakes it, but the first page can then take a minute. Supabase Pro ($25 a month) avoids that and raises storage from 1 GB (the built-in songs use 638 MB).

## How to deploy or update

```bash
SUPA_ORG=zchrxexblzgmuwtjowqv ./deploy.sh
```

Without `SUPA_ORG` the script stops with an explanation, and it refuses the employer's organization (tbmibpkmyuntvywispqj), also when `.env.cloud` already names a project there. It applies the migrations, uploads the built-in songs (it retries dropped connections and carries on where it stopped), deploys Modal and the web app, and pushes the sign-in settings. If Modal can't deploy, the site still goes up and converting songs says it is switched off, without using anyone's free song.

## What was tested

Locally (Supabase in Docker, the worker on this Mac in place of Modal), then live.

| What | Result |
| --- | --- |
| Privacy checks (`supabase/tests/privacy_check.mjs`) | **Local: 64 of 64 pass** (the 29 from the beta, the first turned round for open sign-up; 31 new ones; 4 that call the real upload route). **Hosted project: 60 of 60** (the route checks need a test web server; the live route was checked by hand). New checks: a guest can't write plays, catalog_edits, favourites, setlists or jobs, and reads them empty without an error; a free account can't make a second song through the route's insert or directly through Supabase; retries, key changes, trims and pasted lyrics still work and use nothing up; deleting the free song doesn't give it back; a deleted and re-created account with the same email (in any letter case) has no free song; nobody can read the salt or the hashes or ask about another account; a tester gets 10 in 24 hours and the 11th is refused. |
| Guest, local and live | Discover and "Try it: no sign-in needed" open Amazing Grace in the player in two clicks (choose your instrument, then Try it). It plays, and the note for each word lights up over the lyrics. A new key, favourites and setlists show the sign-in prompt; a note fix works on the page and says "Changed on this page only". My songs, setlists, account and admin, and any id that isn't a built-in song, send a guest to sign in. |
| Free account, local | Sign-up from "Sign up free to convert your own song" lands back on the upload ("You're signed in. Choose the song you want to convert."). Uploaded a Creative Commons song (Eternity, David Crowe, CC BY 3.0). It processed, played, changed key and saved a favourite. The second upload showed the paid-plans panel, and "Tell me when paid plans open" saved. |
| Free account, live (throwaway account, then deleted) | Uploaded the same CC song from its public archive.org copy and converted it on Modal: 195 notes, 87 words, key A minor; it plays. The second upload showed the panel, and the upload route answered 403 with the same message. "Delete my account" removed the account, every row and the files (after the fix below). |
| Google sign-up, live (20 November 2026) | Signed out, clicked "Continue with Google" on notealong.vercel.app, chose a Google account that had never used NoteAlong, and landed back on the site signed in, with "1 free song to convert". Uploaded the CC song Eternity from its public archive.org copy: it converted on Modal in about 2 minutes and played, with the notes above the lyrics. My songs then said "You've used your free song", and "Add a song" opened the "Paid plans are coming soon" panel. "Delete my account" then left 0 users, 0 songs, 0 jobs and no files for that song. |
| Tester, local | Two songs added, "8 of 10 songs left today"; the account page shows "2 of 10". |
| Phone (375 px) | Discover (guest and free song used), sign-in, My songs and the player fit with no sideways scrolling. |
| Suites and builds | Python: 119 passed. Web: 133 passed. Lint unchanged (the same 12 known problems, none new). Production builds of the local and online versions pass, including the check that no test material can ship. |

Found and fixed while testing:
- **Next.js 16.4.3 had a moderate security advisory** (npm audit): updated to 16.4.6, now 0 vulnerabilities.
- **Every song stopped at "Finding the notes" on Modal.** On Linux, Basic Pitch also installs TensorFlow, built for NumPy 1, which can't load with NumPy 2. The image now leaves TensorFlow out, and Basic Pitch uses its ONNX model, as on the Mac.
- **A deleted account could leave files.** A key render that was running when the account was deleted uploaded two files afterwards. The worker now treats a job whose account is gone as stopped and writes nothing.
- **deploy.sh:**
  - zsh read part of the Vercel step as an array index, so the web app never deployed.
  - The site address saved was a private per-deployment address instead of notealong.vercel.app.
  - The CLI's "new version available" notice broke reading the new project's id.
  - The free plan refuses a custom email template with the built-in sender, and that refusal blocked the whole sign-in settings push.
  - All four are fixed.
- **The email link didn't bring people back to the upload.** The NoteAlong email template now carries the return address (it applies once you have your own sender, step 3).

## Cost per song (measured on Modal)

Every job records the GPU seconds it was billed for (the first job on a fresh machine includes starting it and loading the models).

| Job | Song | GPU-seconds (T4) | Cost at $0.59 an hour |
| --- | --- | --- | --- |
| Convert, clean run | Oh My Love (Billie, CC), 2:32 | 97.7 | **$0.016** |
| Convert, first try (failed at the notes step, before the fix) | Eternity (David Crowe, CC), 2:11 | 81.6 | $0.013 |
| Convert, retry of that song (notes, words, lining up) | same | 94.5 | $0.015 |
| The next keys, prepared in the background (CPU, 2 cores) | same | 0 (104 s of CPU) | about $0.003 |

So a typical song costs about **$0.016 of GPU time**, plus up to $0.010 for the 60 seconds the GPU machine waits for another song before it shuts down: **about $0.02 to $0.03 per song on its own, less when songs arrive together.** The rate is the T4 price this report has used since the beta ($0.59 an hour); check Modal's pricing page for the current figure. 1,000 free songs a month would cost roughly $20 to $30 of GPU time.

## History check (for making the repository public)

- **No secrets in any commit.** All 50 commits on every branch were searched for Supabase secret and service-role keys, JWTs, OpenAI, AWS and GitHub keys, Slack tokens, private keys, and the deploy secrets. Nothing was found. `.env`, `.env.cloud` and `web/.env.cloud-test` were never committed.
- **`test-recordings/` and `docs/design/references/` were never committed**, in any commit. The new check `service/scripts/check_no_test_material.py` runs before every web build, in the Python tests and in `deploy.sh`.
- Nothing was rewritten.

## Files

- `supabase/migrations/20261110000000_private_beta.sql`: tables, row-level security, storage.
- `supabase/migrations/20261119000000_open_signup.sql`: open sign-up, the free song, testers, the email hash, the paid-plan interest list.
- `supabase/tests/privacy_check.mjs`: the privacy checks (any Supabase project; `WEB_URL` adds the route checks).
- `web/src/proxy.ts`: what a guest may open.
- `web/src/lib/cloud/`, `web/src/app/api/cloud/`, `web/src/components/cloud/`: the online version.
- `service/modal_app.py`, `service/notealong/cloud/`: the Modal app and the worker.
- `deploy.sh`: the whole deployment.
