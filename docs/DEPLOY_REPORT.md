# NoteAlong private beta: deploy report

<!-- SUMMARY -->

## Your checklist: what I need from you to put it online

Two of the three logins could not be used, so the beta is **not online yet**. Everything that doesn't need them is
built, committed and tested on this Mac against a local copy of Supabase (see "What was tested").

1. **Make room for the Supabase project.** Supabase refused to create it: *"simon.mathias347@gmail.com (2 project
   limit)"*. The free plan allows two active projects and both are in use ("simon.mathias347@gmail.com's Project"
   and "martins-map", in the organisation "PSC"). I didn't touch either. Do one of these in the Supabase dashboard:
   - pause or delete one of those two projects, or
   - upgrade the organisation to **Pro ($25/month, recommended)**: the free plan's 1 GB of storage is mostly taken by
     the built-in songs alone (623 MB), and its built-in email sender only sends a few sign-in emails an hour.
2. **Install and log in to Modal** (the processing):
   ```bash
   pip install modal
   ```
   ```bash
   modal setup
   ```
   It opens the browser; use your personal account.
3. **Send me one message:** "Logins are ready, finish the deploy." I'll then run `./deploy.sh` (creates the project,
   applies the database schema, uploads the built-in songs, deploys Modal and Vercel), test the whole flow on the
   live site with throwaway test users, measure the real cost per song, and fill in this report.

Optional, any time:
- **`ADMIN_EMAIL`** is unset, as you asked, so nobody can open the owner's overview (`/admin`). To use it, add a line
  `ADMIN_EMAIL=you@example.com` to `.env.cloud` before the deploy, or set it in Vercel (Project, Settings,
  Environment Variables) and redeploy. Until then, invite testers in Supabase: Table editor, `allowlist`, insert a
  row with their email in lower case.
- **Email for more than a handful of testers:** in Supabase, Authentication, Emails, SMTP settings, add a sender such
  as Resend (free for 3,000 emails a month). The built-in sender is rate-limited and meant for testing.
- **Google sign-in:** create an OAuth client in Google Cloud, enable Google in Supabase (Authentication, Providers),
  then set `NEXT_PUBLIC_GOOGLE_AUTH=1` on Vercel. The button is built and stays hidden until then.
- **Custom domain:** in Vercel, Project, Settings, Domains, add the domain and set the DNS record Vercel shows (a CNAME
  to `cname.vercel-dns.com`, or an A record to `76.76.21.21` for a bare domain). Then put `SITE_URL=https://your.domain`
  in `.env.cloud` and run `./deploy.sh` again so the sign-in emails link to it.
- **Before charging anyone:** Vercel's free Hobby plan is for non-commercial use only. Move the project to **Vercel
  Pro** ($20/month per member) first. Supabase and Modal have no such rule.
- **Terms and Privacy** (`/terms`, `/privacy`) are drafts. A lawyer should review them and fill in the contact email,
  the governing law and the age limit.

## What is built

```
browser ──► Vercel: the Next.js app (web/) ─────────────► Supabase: sign-in, Postgres, Storage (us-east-1)
               │  /api/cloud/* routes (server only)              row-level security on every table and bucket
               ▼
            Modal: dispatch ─► gpu_job (T4)  separation, notes, words
                          └──► cpu_job       key changes, trims, pasted lyrics, note tidying
```

- **Sign-in** by a link sent by email (works on any device), only for emails on the beta list; a database trigger
  refuses everyone else, and the sign-in page says the same thing either way, so it can't be used to find out who is
  invited. People who aren't invited can join the waitlist on the same page.
- **Uploads** go from the browser straight into the user's private storage folder with a one-time link (up to 50 MB;
  songs up to 12 minutes; 10 new songs per user per 24 hours). The same file again opens the song already there; the
  same recording in another format is recognised during processing. Both look only at that user's own songs.
- **Processing** is a row in `jobs` handed to Modal. It keeps going when the tab is closed; the song page shows the
  same progress view, read from the job row. Errors are shown in plain words with Try again; a job that never
  started or never finished is shown as stopped after 15 or 45 minutes, so it can be retried. Each job records its
  processing time and the GPU seconds it was billed for.
- **Key changes** are rendered on Modal on first use and kept; the neighbouring keys are prepared in the background.
  Built-in songs' key renders are shared (they are public domain or Creative Commons); uploads' are private.
- **Built-in songs** (208, 623 MB) are served from a public storage bucket, uploaded by
  `service/scripts/cloud/upload_catalog.py`, which reads only `catalog/` and refuses any song that isn't public domain
  or Creative Commons.
- **Privacy:** each user's uploads, results, edits, covers, favourites, setlists and jobs are reachable only by them.
  The owner's overview shows counts and error messages, never titles or files. "Delete my account" removes every
  file and row. Test material (`test-recordings/`) can't reach production: the web app deploys from `web/` with a
  `.vercelignore`, the Modal image holds only `service/notealong`, and the catalog upload reads only `catalog/`.
- **Owner's overview** (`/admin`, only for `ADMIN_EMAIL`): users, songs, jobs, failures, GPU and CPU time and the
  estimated cost this month, the beta list (invite and remove) and the waitlist.
- **Terms and Privacy** drafts at `/terms` and `/privacy`.
- **Phones and iPads:** the header, the player's top bar and its controls now fit a 375-pixel phone (they didn't
  before, in the local version either); Discover, My songs, setlists, the song page and the player were checked at
  phone and iPad sizes.
- **The local version is unchanged:** without the Supabase settings the app talks to `./start.sh`'s service as before.

Choices that differ from the brief, each because it is simpler or safer:
- The browser reads and writes its own rows in Supabase directly (row-level security is the guard) instead of going
  through an API server, so there is no always-on server to pay for and the database rules can't be bypassed by a
  bug in a route.
- Progress is read by polling the job row every 1.5 seconds instead of a live connection: it survives closed tabs,
  sleeping phones and restarts with nothing to reconnect.
- The sign-in email carries a one-time token instead of the default code exchange, so a link requested on a laptop
  can be opened on a phone.
- The dispatcher that starts jobs runs on a small image without the models, so starting a job never waits for a
  GPU image to load.

## What was tested

On this Mac, with Supabase running in Docker in place of the hosted project and the same worker code running locally
in place of Modal (one heavy job at a time):

<!-- TESTED -->

Not tested yet, because they need the missing logins: the live site on Vercel, the Modal GPU and CPU functions
themselves (image build, CUDA, cold starts), the hosted email sender, and the real cost per song.

## Cost per song

<!-- COST -->

## Files

- `supabase/migrations/20261110000000_private_beta.sql`: tables, row-level security, storage buckets and policies
- `supabase/tests/privacy_check.mjs`: the privacy checks (run against any Supabase project)
- `service/modal_app.py`, `service/notealong/cloud/`: the Modal app, worker, dispatcher
- `web/src/lib/cloud/`, `web/src/app/api/cloud/`, `web/src/proxy.ts`: the web app's online version
- `deploy.sh`: the whole deployment; `README.md`, "The online version": architecture, variables, inviting testers
