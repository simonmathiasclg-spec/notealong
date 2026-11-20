-- NoteAlong goes public: anyone can create an account, and each account converts ONE song of its own, for good.
--
--   guest (not signed in)   the built-in songs only (no rows of their own; row-level security already says so)
--   free account            one new uploaded song in the account's lifetime
--   tester / owner          emails on `allowlist` (the owner's ADMIN_EMAIL is added there by deploy.sh):
--                           10 new songs per 24 hours, as in the beta
--
-- The limit is enforced here, in the database, on the two inserts that make a new song (a `songs` row, and the
-- `jobs` row that starts processing it), so a bug in a route can't get round it. Retrying, re-processing,
-- key changes, trims and pasted lyrics never insert a new song or a "new" process job, so they use nothing up.
-- Deleting the song does not give the free song back: the count lives in `upload_counts`, not in `songs`.
-- "Delete my account" still removes every row; what stays is a salted SHA-256 hash of the email of an
-- account that used its free song, so a new account with the same email starts with it used.

-- ---------------------------------------------------------------------------------------------------
-- 1. Open sign-up: the allowlist no longer gates accounts; it now marks the beta testers.
-- ---------------------------------------------------------------------------------------------------
drop trigger if exists enforce_allowlist on auth.users;
drop function if exists public.enforce_allowlist();
comment on table public.allowlist is 'Beta testers and the owner: 10 new songs per 24 hours instead of one free song.';

-- the waitlist also collects interest in paid plans (kind = paid)
alter table public.waitlist add column kind text not null default 'beta' check (kind in ('beta', 'paid'));
drop index if exists public.waitlist_email;
create unique index waitlist_email_kind on public.waitlist (lower(email), kind);

-- ---------------------------------------------------------------------------------------------------
-- 2. What the browser and the API never see: the salt for the email hashes, and the hashes themselves.
--    The `private` schema is not exposed by the API, and only the functions below (security definer) use it.
-- ---------------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.settings (name text primary key, value text not null);
insert into private.settings (name, value)
values ('email_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- emails (salted SHA-256, never the email itself) of accounts that used their free song
create table private.free_song_used (
  email_hash text primary key,
  used_at timestamptz not null default now()
);
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.email_hash(p_email text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest((select value from private.settings where name = 'email_salt') || ':' || lower(trim(p_email)), 'sha256'), 'hex');
$$;
revoke all on function private.email_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. The lifetime count of new songs per account. It stays when songs are deleted and goes with the account.
-- ---------------------------------------------------------------------------------------------------
create table public.upload_counts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  new_songs integer not null default 0,
  first_song_id text,
  first_at timestamptz,
  last_at timestamptz
);
alter table public.upload_counts enable row level security;
create policy "own upload count: read" on public.upload_counts for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.upload_counts from anon, authenticated;

create or replace function public.is_tester(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u join public.allowlist a on a.email = lower(u.email) where u.id = p_user);
$$;
revoke all on function public.is_tester(uuid) from public, anon, authenticated;

create or replace function public.free_song_used(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select new_songs >= 1 from public.upload_counts where user_id = p_user), false)
      or exists (select 1 from auth.users u join private.free_song_used f on f.email_hash = private.email_hash(u.email)
                 where u.id = p_user and u.email is not null);
$$;
revoke all on function public.free_song_used(uuid) from public, anon, authenticated;

-- new songs a tester started in the last 24 hours (a new process job, or a song still uploading)
create or replace function public.new_songs_today(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.jobs j where j.user_id = p_user and j.kind = 'process' and j.params->>'new' = 'true'
            and j.created_at > now() - interval '24 hours')::integer
       + (select count(*) from public.songs s where s.user_id = p_user and s.status = 'uploading'
            and s.created_at > now() - interval '24 hours'
            and not exists (select 1 from public.jobs j where j.song_id = s.id and j.user_id = p_user and j.kind = 'process'))::integer;
$$;
revoke all on function public.new_songs_today(uuid) from public, anon, authenticated;

-- What a user may upload: {plan, used, limit, remaining}. The upload route asks for any user (service role);
-- the browser asks for itself (my_allowance).
create or replace function public.upload_allowance(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare used integer;
begin
  if public.is_tester(p_user) then
    used := public.new_songs_today(p_user);
    return jsonb_build_object('plan', 'beta', 'used', used, 'limit', 10, 'remaining', greatest(0, 10 - used));
  end if;
  used := case when public.free_song_used(p_user) then 1 else 0 end;
  return jsonb_build_object('plan', 'free', 'used', used, 'limit', 1, 'remaining', 1 - used);
end $$;
revoke all on function public.upload_allowance(uuid) from public, anon, authenticated;

create or replace function public.my_allowance() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.upload_allowance((select auth.uid()));
$$;
revoke all on function public.my_allowance() from public, anon;
grant execute on function public.my_allowance() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. The checks, on every insert that makes a new song (whoever inserts: the routes use the service role)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.check_new_song() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_tester(new.user_id) then
    if public.new_songs_today(new.user_id) >= 10 then
      raise exception 'DAILY_LIMIT' using errcode = 'P0001', hint = 'Testers can add 10 new songs in 24 hours.';
    end if;
    return new;
  end if;
  if public.free_song_used(new.user_id) then
    raise exception 'FREE_SONG_USED' using errcode = 'P0001', hint = 'This account has used its free song.';
  end if;
  -- one song at a time while the free one isn't used yet: a second file waiting to upload would be a second song
  if exists (select 1 from public.songs s where s.user_id = new.user_id and s.id <> new.id) then
    raise exception 'FREE_SONG_PENDING' using errcode = 'P0001', hint = 'This account already has a song on its way.';
  end if;
  return new;
end $$;
revoke all on function public.check_new_song() from public, anon, authenticated;
create trigger check_new_song before insert on public.songs
  for each row execute function public.check_new_song();

-- a "new" process job is the moment a song is counted
create or replace function public.count_new_song() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tester boolean := public.is_tester(new.user_id);
  first text;
  email text;
begin
  if new.kind <> 'process' or coalesce(new.params->>'new', 'false') <> 'true' then
    return new;
  end if;
  select first_song_id into first from public.upload_counts where user_id = new.user_id;
  if tester then
    if public.new_songs_today(new.user_id) - (case when exists (select 1 from public.songs s where s.id = new.song_id
        and s.user_id = new.user_id and s.status = 'uploading' and s.created_at > now() - interval '24 hours') then 1 else 0 end) >= 10 then
      raise exception 'DAILY_LIMIT' using errcode = 'P0001', hint = 'Testers can add 10 new songs in 24 hours.';
    end if;
  elsif public.free_song_used(new.user_id) and first is distinct from new.song_id then
    raise exception 'FREE_SONG_USED' using errcode = 'P0001', hint = 'This account has used its free song.';
  end if;
  insert into public.upload_counts as c (user_id, new_songs, first_song_id, first_at, last_at)
  values (new.user_id, 1, new.song_id, now(), now())
  on conflict (user_id) do update set
    new_songs = c.new_songs + case when c.first_song_id = new.song_id and not tester then 0 else 1 end,
    first_song_id = coalesce(c.first_song_id, new.song_id), first_at = coalesce(c.first_at, now()), last_at = now();
  if not tester then
    select u.email into email from auth.users u where u.id = new.user_id;
    if email is not null then
      insert into private.free_song_used (email_hash) values (private.email_hash(email)) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.count_new_song() from public, anon, authenticated;
create trigger count_new_song before insert on public.jobs
  for each row execute function public.count_new_song();

-- ---------------------------------------------------------------------------------------------------
-- 5. "Tell me when paid plans open": the signed-in account's own email on the waitlist, once.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.join_paid_interest() returns void
language sql security definer set search_path = '' as $$
  insert into public.waitlist (email, kind, note)
  select lower(u.email), 'paid', 'asked from the app' from auth.users u where u.id = (select auth.uid()) and u.email is not null
  on conflict do nothing;
$$;
revoke all on function public.join_paid_interest() from public, anon;
grant execute on function public.join_paid_interest() to authenticated;
