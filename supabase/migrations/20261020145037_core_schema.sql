create type public.user_role as enum ('listener', 'artist', 'admin');
create type public.application_status as enum ('pending', 'approved', 'rejected');
create type public.artist_status as enum ('approved', 'suspended');
create type public.release_status as enum ('draft', 'in_review', 'published', 'removed');
create type public.release_type as enum ('single', 'ep', 'album');
create type public.report_status as enum ('received', 'under_review', 'upheld', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'en' check (locale in ('en', 'fr')),
  role public.user_role not null default 'listener',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  bio text check (char_length(bio) <= 2000),
  image_url text,
  status public.artist_status not null default 'approved',
  created_at timestamptz not null default now()
);
alter table public.artists enable row level security;

create or replace function public.owns_artist(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.artists where id = a and owner_id = auth.uid() and status = 'approved');
$$;

create policy "profiles: read own" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles: update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, locale) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.artist_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  artist_name text not null check (char_length(artist_name) between 2 and 80),
  bio text check (char_length(bio) <= 2000),
  links text[] not null default '{}',
  rights_statement_accepted boolean not null check (rights_statement_accepted),
  status public.application_status not null default 'pending',
  decision_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.artist_applications enable row level security;
create policy "applications: read own or admin" on public.artist_applications for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "applications: create own" on public.artist_applications for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

create policy "artists: public read approved" on public.artists for select to anon, authenticated using (status = 'approved' or owner_id = auth.uid() or public.is_admin());
create policy "artists: owner edits profile" on public.artists for update to authenticated using (owner_id = auth.uid() and status = 'approved') with check (owner_id = auth.uid());
revoke update on public.artists from authenticated;
grant update (bio, image_url) on public.artists to authenticated;

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  type public.release_type not null default 'single',
  cover_path text,
  status public.release_status not null default 'draft',
  removal_reason text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.releases enable row level security;
create policy "releases: read published or own or admin" on public.releases for select to anon, authenticated
  using (status = 'published' or public.owns_artist(artist_id) or public.is_admin());
create policy "releases: artist creates draft" on public.releases for insert to authenticated
  with check (public.owns_artist(artist_id) and status = 'draft');
create policy "releases: artist edits own" on public.releases for update to authenticated
  using (public.owns_artist(artist_id) or public.is_admin()) with check (public.owns_artist(artist_id) or public.is_admin());
create policy "releases: artist deletes own draft" on public.releases for delete to authenticated
  using (public.owns_artist(artist_id) and status = 'draft');

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  track_number int not null default 1,
  audio_path text,
  duration_ms int check (duration_ms > 0),
  created_at timestamptz not null default now()
);
alter table public.tracks enable row level security;
create policy "tracks: read if release visible" on public.tracks for select to anon, authenticated
  using (exists (select 1 from public.releases r where r.id = release_id and (r.status = 'published' or public.owns_artist(r.artist_id) or public.is_admin())));
create policy "tracks: artist manages own" on public.tracks for all to authenticated
  using (public.owns_artist(artist_id)) with check (public.owns_artist(artist_id));

create table public.rights_declarations (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  statement_version text not null,
  accepted_at timestamptz not null default now()
);
alter table public.rights_declarations enable row level security;
create policy "rights: read own or admin" on public.rights_declarations for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "rights: artist declares for own release" on public.rights_declarations for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.releases r where r.id = release_id and public.owns_artist(r.artist_id)));

create or replace function public.guard_release_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    if not (old.status = 'draft' and new.status = 'in_review') then
      raise exception 'Only an admin can set status to %', new.status;
    end if;
    if not exists (select 1 from public.rights_declarations where release_id = new.id) then
      raise exception 'A rights declaration is required before submitting a release';
    end if;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then new.published_at := now(); end if;
  return new;
end $$;
create trigger release_status_guard before update on public.releases for each row execute function public.guard_release_status();

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.playlists enable row level security;
create policy "playlists: read own or public" on public.playlists for select to anon, authenticated using (is_public or owner_id = auth.uid());
create policy "playlists: manage own" on public.playlists for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id)
);
alter table public.playlist_tracks enable row level security;
create policy "playlist_tracks: read if playlist visible" on public.playlist_tracks for select to anon, authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and (p.is_public or p.owner_id = auth.uid())));
create policy "playlist_tracks: manage own" on public.playlist_tracks for all to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid()));

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
alter table public.favorites enable row level security;
create policy "favorites: manage own" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.play_events (
  id bigint generated always as identity primary key,
  track_id uuid not null references public.tracks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  listened_ms int not null default 0 check (listened_ms >= 0),
  created_at timestamptz not null default now()
);
create index play_events_track_idx on public.play_events (track_id, created_at);
create index play_events_user_idx on public.play_events (user_id, created_at desc);
alter table public.play_events enable row level security;
create policy "plays: record own" on public.play_events for insert to authenticated with check (user_id = auth.uid());
create policy "plays: read own, artist, admin" on public.play_events for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.tracks t where t.id = track_id and public.owns_artist(t.artist_id)));
create policy "plays: user clears own history" on public.play_events for delete to authenticated using (user_id = auth.uid());

create table public.copyright_reports (
  id uuid primary key default gen_random_uuid(),
  release_id uuid references public.releases(id) on delete set null,
  artist_id uuid references public.artists(id) on delete set null,
  reporter_name text not null,
  reporter_email text not null,
  description text not null check (char_length(description) between 10 and 4000),
  status public.report_status not null default 'received',
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.copyright_reports enable row level security;
create policy "reports: anyone can file" on public.copyright_reports for insert to anon, authenticated with check (status = 'received');
create policy "reports: admin reads" on public.copyright_reports for select to authenticated using (public.is_admin());
create policy "reports: admin updates" on public.copyright_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "audit: admin reads" on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.write_audit(p_action text, p_type text, p_id text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, detail) values (auth.uid(), p_action, p_type, p_id, p_detail);
$$;
revoke execute on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.approve_artist_application(p_application uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare app public.artist_applications; new_artist uuid; base text; final_slug text; n int := 0;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into app from public.artist_applications where id = p_application and status = 'pending' for update;
  if not found then raise exception 'Application not found or already decided'; end if;
  base := trim(both '-' from regexp_replace(lower(app.artist_name), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'artist'; end if;
  final_slug := base;
  while exists (select 1 from public.artists where slug = final_slug) loop n := n + 1; final_slug := base || '-' || n; end loop;
  insert into public.artists (owner_id, name, slug, bio) values (app.user_id, app.artist_name, final_slug, app.bio) returning id into new_artist;
  update public.profiles set role = 'artist' where id = app.user_id and role = 'listener';
  update public.artist_applications set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = p_application;
  perform public.write_audit('approve_artist', 'artist_application', p_application::text, jsonb_build_object('artist_id', new_artist));
  return new_artist;
end $$;

create or replace function public.reject_artist_application(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.artist_applications set status = 'rejected', decision_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_application and status = 'pending';
  if not found then raise exception 'Application not found or already decided'; end if;
  perform public.write_audit('reject_artist', 'artist_application', p_application::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.moderate_release(p_release uuid, p_status public.release_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status = 'removed' and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to remove a release'; end if;
  update public.releases set status = p_status, removal_reason = case when p_status = 'removed' then p_reason else null end where id = p_release;
  if not found then raise exception 'Release not found'; end if;
  perform public.write_audit('moderate_release', 'release', p_release::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

revoke execute on function public.approve_artist_application(uuid), public.reject_artist_application(uuid, text),
  public.moderate_release(uuid, public.release_status, text) from public, anon;
grant execute on function public.approve_artist_application(uuid), public.reject_artist_application(uuid, text),
  public.moderate_release(uuid, public.release_status, text) to authenticated;
