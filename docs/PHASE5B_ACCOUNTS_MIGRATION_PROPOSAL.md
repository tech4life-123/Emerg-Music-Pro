# Phase 5 / Milestone B step 1: accounts migration proposal (NOT applied to live)

File: supabase/migrations/20261026000200_phase5b_accounts.sql on branch phase5b-accounts-security. Local results: 26 test files / 227 tests passed (15 new in tests/db/phase5b_accounts.test.ts), lint and typecheck clean.

Impact: additive. New nullable profile columns (existing profiles keep username NULL), 2 new tables, 5 functions, 1 trigger, and ONE behaviour change: artist applications now require a confirmed email (private.email_verified()). Profile update grants widen to username, bio, country, onboarding_completed_at, profile_public; role and terms fields stay locked. The sign-up trigger now reads username and terms_version from sign-up metadata and never blocks account creation on a bad or taken username.

```sql
-- Phase 5 / Milestone B (step 1): listener account fields. PROPOSED, not applied to the live project.
-- Adds username, bio, country, onboarding + terms state, optional public profile, genre interests, deletion requests,
-- and a verified-email gate on artist applications. Additive; uses ALTER POLICY (no drop policy).
-- Existing profiles keep username NULL until the person sets one (the app prompts for it).
-- Revert (before any data depends on it): alter policy "applications: create own" ... without private.email_verified();
--   the new columns/tables/functions are additive and harmless to leave.

-- ---------- profile fields ----------
alter table public.profiles
  add column username text,
  add column bio text,
  add column country text,
  add column onboarding_completed_at timestamptz,
  add column terms_accepted_at timestamptz,
  add column terms_version text,
  add column profile_public boolean not null default false,
  add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  add constraint profiles_bio_len check (bio is null or char_length(bio) <= 500),
  add constraint profiles_country_code check (country is null or country ~ '^[A-Z]{2}$');
create unique index profiles_username_uidx on public.profiles (username);

-- Reserved handles (staff-looking or route-like names). Case-insensitive because usernames are stored lowercase.
create or replace function private.username_reserved(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p = any (array['admin','administrator','moderator','mod','staff','support','help','security','root','system','official',
    'emerg','emergmusic','emerg_music','emergmusic_team','team','studio','library','login','signup','account','artist','artists',
    'api','www','null','undefined','anonymous','everyone','me']);
$$;
revoke all on function private.username_reserved(text) from public;
grant execute on function private.username_reserved(text) to anon, authenticated, service_role;

create or replace function private.guard_username() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.username is not null and (tg_op = 'INSERT' or new.username is distinct from old.username)
     and private.username_reserved(new.username) then
    raise exception 'That username is not available.';
  end if;
  return new;
end $$;
revoke all on function private.guard_username() from public;
create trigger profiles_username_guard before insert or update of username on public.profiles
  for each row execute function private.guard_username();

-- Sign-up form helper: true when the handle is well-formed, not reserved and not taken. Rate-limited in the app.
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_username ~ '^[a-z0-9_]{3,24}$'
     and not private.username_reserved(p_username)
     and not exists (select 1 from public.profiles where username = p_username);
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- New accounts: read username and terms version from sign-up metadata. A bad or taken username never blocks account creation
-- (it is stored as NULL and the app asks again); the form validates it first.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1));
  v_user text := lower(nullif(trim(new.raw_user_meta_data->>'username'), ''));
  v_terms text := nullif(trim(new.raw_user_meta_data->>'terms_version'), '');
begin
  if v_user is not null and (v_user !~ '^[a-z0-9_]{3,24}$' or private.username_reserved(v_user)) then v_user := null; end if;
  begin
    insert into public.profiles (id, display_name, username, terms_version, terms_accepted_at)
    values (new.id, left(v_name, 80), v_user, left(v_terms, 40), case when v_terms is null then null else now() end);
  exception when unique_violation then
    insert into public.profiles (id, display_name, terms_version, terms_accepted_at)
    values (new.id, left(v_name, 80), left(v_terms, 40), case when v_terms is null then null else now() end);
  end;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- What a signed-in user may change on their own profile. role, terms_*, created_at stay locked.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, locale, username, bio, country, onboarding_completed_at, profile_public) on public.profiles to authenticated;

-- Accepting a newer terms version is a function so the timestamp cannot be forged.
create or replace function public.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_version is null or char_length(trim(p_version)) not between 1 and 40 then raise exception 'Invalid version'; end if;
  update public.profiles set terms_version = trim(p_version), terms_accepted_at = now() where id = auth.uid();
end $$;
revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- ---------- optional public profile (only when the owner turns it on) ----------
create or replace function public.get_public_profile(p_username text)
returns table (username text, display_name text, avatar_url text, bio text, joined_at timestamptz, following_count bigint)
language sql stable security definer set search_path = '' as $$
  select p.username, p.display_name, p.avatar_url, p.bio, p.created_at,
         (select count(*) from public.artist_follows f where f.user_id = p.id)
  from public.profiles p
  where p.username = lower(p_username) and p.profile_public and p.username is not null;
$$;
revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ---------- music interests (onboarding) ----------
create table public.user_genres (
  user_id uuid not null references public.profiles(id) on delete cascade,
  genre_id uuid not null references public.genres(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, genre_id)
);
alter table public.user_genres enable row level security;
create policy "user_genres: manage own" on public.user_genres for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.user_genres to authenticated;

-- ---------- account deletion requests (handled by an administrator for the pilot) ----------
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  requested_at timestamptz not null default now()
);
create unique index account_deletion_one_pending on public.account_deletion_requests (user_id) where status = 'pending';
alter table public.account_deletion_requests enable row level security;
create policy "deletion: read own or admin" on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy "deletion: request own" on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "deletion: cancel own pending" on public.account_deletion_requests for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');
grant select, insert (user_id), delete on public.account_deletion_requests to authenticated;

-- ---------- verified email gate for sensitive actions ----------
create or replace function private.email_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null);
$$;
revoke all on function private.email_verified() from public;
grant execute on function private.email_verified() to authenticated, service_role;

alter policy "applications: create own" on public.artist_applications
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null and rights_statement_accepted and private.email_verified());
```
