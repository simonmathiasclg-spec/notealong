-- NoteAlong private beta: accounts, songs, settings, edits, favourites, setlists, processing jobs.
--
-- Privacy rule: every table has row-level security, and each user can read and change only their own rows.
-- The processing worker and the server routes use the service role (which bypasses RLS) and always filter
-- by the user they act for. Built-in catalog songs are public domain or Creative Commons and are public.

-- ---------------------------------------------------------------------------------------------------
-- Beta gate: only invited emails can create an account. The owner edits `allowlist` in the dashboard
-- (Table editor) or with the admin page; people who are not invited can leave their email on `waitlist`.
-- ---------------------------------------------------------------------------------------------------
create table public.allowlist (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  note text,
  added_at timestamptz not null default now()
);
alter table public.allowlist enable row level security;
-- no policies: nobody but the owner (service role / dashboard) can read or change it

create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null check (length(email) between 3 and 320 and position('@' in email) > 1),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create unique index waitlist_email on public.waitlist (lower(email));
alter table public.waitlist enable row level security;
-- anyone may add themselves; nobody can read the list back except the owner
create policy "anyone can join the waitlist" on public.waitlist
  for insert to anon, authenticated with check (true);

create or replace function public.enforce_allowlist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.allowlist a where a.email = lower(new.email)) then
    raise exception 'NOT_INVITED' using errcode = 'P0001', hint = 'This email is not on the beta list.';
  end if;
  return new;
end $$;
revoke all on function public.enforce_allowlist() from public, anon, authenticated;

create trigger enforce_allowlist before insert on auth.users
  for each row execute function public.enforce_allowlist();

-- ---------------------------------------------------------------------------------------------------
-- Uploaded songs. `data` is the song exactly as the pipeline writes song.json (notes, words, lines,
-- settings, steps, the player settings); the other columns are for listing, search and duplicates.
-- ---------------------------------------------------------------------------------------------------
create table public.songs (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled',
  artist text,
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  duration real not null default 0,
  data jsonb not null,
  -- the uploaded file's SHA-256 (the same file again is recognised before processing) and the sound
  -- fingerprint (the same recording in another format is recognised during processing)
  content_hash text,
  fingerprint jsonb,
  -- note range, lyrics text, note count and difficulty, for search and the filters
  search jsonb,
  pasted_lyrics text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index songs_user_created on public.songs (user_id, created_at desc);
create index songs_user_hash on public.songs (user_id, content_hash);
alter table public.songs enable row level security;
create policy "own songs: read" on public.songs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own songs: edit" on public.songs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own songs: delete" on public.songs for delete to authenticated
  using (user_id = (select auth.uid()));
-- new songs are created by the upload route, which checks the daily limit first (no insert policy)

-- what a user may change directly: titles, edits and player settings (processing results come from the worker)
revoke insert, update on public.songs from anon, authenticated;
grant select, delete on public.songs to authenticated;
grant update (title, artist, data, pasted_lyrics, updated_at) on public.songs to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- A user's changes to built-in songs (player settings, note fixes), kept apart from the shared catalog.
-- ---------------------------------------------------------------------------------------------------
create table public.catalog_edits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);
alter table public.catalog_edits enable row level security;
create policy "own catalog edits" on public.catalog_edits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------
-- Favourites, plays and setlists (song ids are catalog ids or the user's own upload ids)
-- ---------------------------------------------------------------------------------------------------
create table public.favourites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);
alter table public.favourites enable row level security;
create policy "own favourites" on public.favourites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.plays (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null,
  count integer not null default 0,
  last timestamptz,
  primary key (user_id, song_id)
);
alter table public.plays enable row level security;
create policy "own plays" on public.plays for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.record_play(p_song_id text) returns public.plays
language sql security invoker set search_path = '' as $$
  insert into public.plays (user_id, song_id, count, last)
  values ((select auth.uid()), p_song_id, 1, now())
  on conflict (user_id, song_id) do update set count = public.plays.count + 1, last = now()
  returning *;
$$;
revoke all on function public.record_play(text) from public, anon;
grant execute on function public.record_play(text) to authenticated;

create table public.setlists (
  id text primary key default ('set-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'New setlist' check (length(name) <= 200),
  songs text[] not null default '{}',
  gap_seconds integer not null default 8 check (gap_seconds between 0 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index setlists_user on public.setlists (user_id, created_at);
alter table public.setlists enable row level security;
create policy "own setlists" on public.setlists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- when an upload is deleted, it leaves the user's favourites, plays and setlists too
create or replace function public.forget_deleted_song() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.favourites where user_id = old.user_id and song_id = old.id;
  delete from public.plays where user_id = old.user_id and song_id = old.id;
  update public.setlists set songs = array_remove(songs, old.id), updated_at = now()
    where user_id = old.user_id and old.id = any (songs);
  return old;
end $$;
revoke all on function public.forget_deleted_song() from public, anon, authenticated;
create trigger forget_deleted_song after delete on public.songs
  for each row execute function public.forget_deleted_song();

-- ---------------------------------------------------------------------------------------------------
-- Processing jobs: one row per request to the processing service. The song page reads `snapshot` for
-- the progress view, so processing carries on (and is shown again) after the tab is closed.
-- ---------------------------------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id text not null,
  kind text not null check (kind in ('process', 'trim', 'lyrics', 'render')),
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'stopped')),
  snapshot jsonb,
  result jsonb,
  error text,
  gpu text,
  gpu_seconds real not null default 0,
  processing_seconds real not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_song on public.jobs (song_id, created_at desc);
create index jobs_user_created on public.jobs (user_id, created_at desc);
alter table public.jobs enable row level security;
create policy "own jobs: read" on public.jobs for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.jobs from anon, authenticated;

-- Totals per month with no user in them, so the processing cost stays known after accounts are deleted.
create table public.usage_monthly (
  month date primary key,
  jobs integer not null default 0,
  failures integer not null default 0,
  gpu_seconds real not null default 0,
  cpu_seconds real not null default 0,
  uploads integer not null default 0
);
alter table public.usage_monthly enable row level security;
-- no policies: owner only

create or replace function public.add_usage(p_jobs integer, p_failures integer, p_gpu real, p_cpu real, p_uploads integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.usage_monthly as u (month, jobs, failures, gpu_seconds, cpu_seconds, uploads)
  values (date_trunc('month', now())::date, p_jobs, p_failures, p_gpu, p_cpu, p_uploads)
  on conflict (month) do update set jobs = u.jobs + excluded.jobs, failures = u.failures + excluded.failures,
    gpu_seconds = u.gpu_seconds + excluded.gpu_seconds, cpu_seconds = u.cpu_seconds + excluded.cpu_seconds,
    uploads = u.uploads + excluded.uploads;
$$;
revoke all on function public.add_usage(integer, integer, real, real, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Storage. `uploads` is private: every file lives under <user id>/<song id>/ and only that user can
-- reach it. `catalog` is public: the built-in songs (public domain / Creative Commons) and their key renders.
-- ---------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 52428800), ('catalog', 'catalog', true, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "own files: read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files: replace" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- the catalog bucket has no write policies: only the service role (upload script, worker) writes to it
