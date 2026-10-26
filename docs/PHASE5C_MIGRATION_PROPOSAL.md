# Milestone C: artist application, profiles and moderator (migration proposal, NOT applied)

Branch phase5c-artist-profiles. Two migrations, applied in order. 18 new tests plus 4 updated assertions; full suite 29 files / 258 tests passing locally.

## File 1: 20261026000400_phase5c_enum_values.sql
```sql
-- Phase 5C step 1 of 2: new enum values only. PROPOSED, not applied to the live project.
-- Postgres does not let a value added to an enum be used in the same transaction, so these live in their own migration.
-- 'pending' stays and now MEANS "submitted" (waiting for staff): existing rows, functions and tests keep working unchanged.
alter type public.user_role add value if not exists 'moderator';
alter type public.application_status add value if not exists 'draft';
alter type public.application_status add value if not exists 'under_review';
alter type public.application_status add value if not exists 'info_requested';
```

## File 2: 20261026000500_phase5c_artist_profiles.sql
```sql
-- Phase 5C step 2 of 2: moderator role, application workflow with messages, artist profile fields, artist images. PROPOSED, not applied.
-- Live check before writing: 1 application (approved), 1 artist ("Emergency", image_url NULL). Nothing here rewrites existing rows.
-- Uses ALTER POLICY for existing policies. Application states: draft -> pending(=submitted) -> under_review -> info_requested -> ... -> approved | rejected.
-- Suspension stays on artists.status. NOT included (deferred): claiming an existing artist, artist teams, info-requested notifications.

-- ---------- staff = admin or moderator ----------
create or replace function private.is_staff() returns boolean
language plpgsql stable security definer set search_path = 'public' as $$
begin
  return exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'moderator'));
end $$;
revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to anon, authenticated, service_role;

-- Admin-only role switch between listener and moderator (artists and admins are not changed here).
create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  if p_role not in ('listener', 'moderator') then raise exception 'Only listener or moderator can be set here'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user and role::text in ('listener', 'moderator');
  if not found then raise exception 'That person cannot be changed here'; end if;
  perform public.write_audit('set_role', 'profile', p_user::text, jsonb_build_object('role', p_role));
end $$;
revoke all on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- ---------- applications: richer fields, draft editing ----------
alter table public.artist_applications
  add column artist_type text check (artist_type in ('solo', 'band', 'group', 'producer', 'label')),
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column hometown text check (char_length(hometown) <= 80),
  add column contact_email text check (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+$'),
  add column genre_id uuid references public.genres(id),
  add column secondary_genre_ids uuid[] not null default '{}' check (cardinality(secondary_genre_ids) <= 3),
  add column authority_confirmed boolean not null default false,
  add column submitted_at timestamptz,
  add column updated_at timestamptz not null default now();

drop index if exists public.artist_applications_one_pending_per_user;
create unique index artist_applications_one_active_per_user on public.artist_applications (user_id)
  where status in ('draft', 'pending', 'under_review', 'info_requested');

alter policy "applications: read own or admin" on public.artist_applications using (user_id = auth.uid() or private.is_staff());
alter policy "applications: create own" on public.artist_applications
  with check (user_id = auth.uid() and status in ('draft', 'pending') and reviewed_by is null and rights_statement_accepted and private.email_verified());
revoke insert on public.artist_applications from authenticated;
grant insert (user_id, artist_name, bio, links, rights_statement_accepted, status, artist_type, country, hometown, contact_email, genre_id, secondary_genre_ids, authority_confirmed)
  on public.artist_applications to authenticated;

create policy "applications: edit own draft" on public.artist_applications for update to authenticated
  using (user_id = auth.uid() and status in ('draft', 'info_requested'))
  with check (user_id = auth.uid() and status in ('draft', 'info_requested'));
grant update (artist_name, bio, links, artist_type, country, hometown, contact_email, genre_id, secondary_genre_ids, authority_confirmed)
  on public.artist_applications to authenticated;

create or replace function private.touch_application() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function private.touch_application() from public;
create trigger applications_touch before update on public.artist_applications for each row execute function private.touch_application();

-- The person submits through this function (status cannot be written directly): it checks completeness and the verified email.
create or replace function public.submit_artist_application(p_application uuid) returns void
language plpgsql security definer set search_path = 'public' as $$
declare a public.artist_applications;
begin
  select * into a from public.artist_applications where id = p_application and user_id = auth.uid() for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status::text not in ('draft', 'info_requested') then raise exception 'This application cannot be submitted now'; end if;
  if not private.email_verified() then raise exception 'Verify your email address before submitting'; end if;
  if a.artist_type is null or a.country is null or a.genre_id is null or a.contact_email is null then
    raise exception 'Fill in artist type, country, main genre and contact email first';
  end if;
  if coalesce(char_length(a.bio), 0) < 20 then raise exception 'Write a short bio (at least 20 characters)'; end if;
  if not a.authority_confirmed then raise exception 'Confirm that you are authorised to represent this artist'; end if;
  if exists (select 1 from public.artists x where lower(x.name) = lower(a.artist_name)) then
    raise exception 'An artist with this name already exists. Choose a different name or contact support';
  end if;
  update public.artist_applications set status = 'pending', submitted_at = now() where id = a.id;
end $$;
revoke all on function public.submit_artist_application(uuid) from public, anon;
grant execute on function public.submit_artist_application(uuid) to authenticated;

-- ---------- messages between applicant and staff ----------
create table public.application_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.artist_applications(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  from_staff boolean not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index application_messages_app_idx on public.application_messages (application_id, created_at);
alter table public.application_messages enable row level security;
create policy "app messages: read own or staff" on public.application_messages for select to authenticated
  using (private.is_staff() or exists (select 1 from public.artist_applications a where a.id = application_id and a.user_id = auth.uid()));
create policy "app messages: applicant replies" on public.application_messages for insert to authenticated
  with check (author_id = auth.uid() and not from_staff and exists (
    select 1 from public.artist_applications a
    where a.id = application_id and a.user_id = auth.uid() and a.status::text in ('pending', 'under_review', 'info_requested')));
grant select on public.application_messages to authenticated;
grant insert (application_id, author_id, from_staff, body) on public.application_messages to authenticated;

create or replace function public.start_application_review(p_application uuid) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  update public.artist_applications set status = 'under_review', reviewed_by = auth.uid() where id = p_application and status = 'pending';
  if not found then raise exception 'Application not found or not waiting for review'; end if;
  perform public.write_audit('review_application', 'artist_application', p_application::text, null);
end $$;
create or replace function public.request_application_info(p_application uuid, p_message text) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write what you need from the applicant'; end if;
  update public.artist_applications set status = 'info_requested' where id = p_application and status::text in ('pending', 'under_review');
  if not found then raise exception 'Application not found or already decided'; end if;
  insert into public.application_messages (application_id, author_id, from_staff, body) values (p_application, auth.uid(), true, left(trim(p_message), 2000));
  perform public.write_audit('request_application_info', 'artist_application', p_application::text, null);
end $$;
revoke all on function public.start_application_review(uuid), public.request_application_info(uuid, text) from public, anon;
grant execute on function public.start_application_review(uuid), public.request_application_info(uuid, text) to authenticated;

-- ---------- artist profile fields ----------
alter table public.artists
  add column artist_type text check (artist_type in ('solo', 'band', 'group', 'producer', 'label')),
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column hometown text check (char_length(hometown) <= 80),
  add column header_url text,
  add column links text[] not null default '{}' check (cardinality(links) <= 5),
  add column verified_at timestamptz,
  add column featured_release_id uuid; -- deliberately NO foreign key: a second artists<->releases relationship would make PostgREST embeds ambiguous; the trigger below validates it.
-- artists.image_url (avatar) already has artists_image_own_folder ('artists/<artist id>/%', migration 0004); header gets the same rule.
alter table public.artists
  add constraint artists_header_own_folder check (header_url is null or header_url like 'artists/' || id::text || '/%');

-- anon may read only whitelisted columns of artists (owner_id stays hidden); the new PUBLIC profile columns must be added to that list.
grant select (artist_type, country, hometown, header_url, links, verified_at, featured_release_id) on public.artists to anon;

revoke update on public.artists from authenticated;
grant update (bio, image_url, header_url, links, country, hometown, artist_type, featured_release_id) on public.artists to authenticated;

-- A featured release must be this artist's own, published release. verified_at is not in the grant above: staff set it via the function below.
create or replace function private.guard_featured_release() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.featured_release_id is not null and new.featured_release_id is distinct from old.featured_release_id then
    if not exists (select 1 from public.releases r where r.id = new.featured_release_id and r.artist_id = new.id and r.status = 'published') then
      raise exception 'Feature one of your own published releases';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_featured_release() from public;
create trigger artists_featured_guard before update of featured_release_id on public.artists for each row execute function private.guard_featured_release();

create or replace function public.set_artist_verified(p_artist uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  update public.artists set verified_at = case when p_verified then now() else null end where id = p_artist;
  if not found then raise exception 'Artist not found'; end if;
  perform public.write_audit(case when p_verified then 'verify_artist' else 'unverify_artist' end, 'artist', p_artist::text, null);
end $$;
revoke all on function public.set_artist_verified(uuid, boolean) from public, anon;
grant execute on function public.set_artist_verified(uuid, boolean) to authenticated;

-- Contact email is private (artists is publicly readable): it lives in its own table.
create table public.artist_private (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  contact_email text check (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+$')
);
alter table public.artist_private enable row level security;
create policy "artist_private: owner or staff read" on public.artist_private for select to authenticated using (private.owns_artist(artist_id) or private.is_staff());
create policy "artist_private: owner writes" on public.artist_private for insert to authenticated with check (private.owns_artist(artist_id));
create policy "artist_private: owner edits" on public.artist_private for update to authenticated using (private.owns_artist(artist_id)) with check (private.owns_artist(artist_id));
grant select, insert (artist_id, contact_email), update (contact_email) on public.artist_private to authenticated;

-- ---------- approve / reject: staff, new states, copy the richer fields ----------
create or replace function public.approve_artist_application(p_application uuid) returns uuid
language plpgsql security definer set search_path = 'public' as $$
declare app public.artist_applications; new_artist uuid; base text; final_slug text; n int := 0;
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into app from public.artist_applications where id = p_application and status::text in ('pending', 'under_review') for update;
  if not found then raise exception 'Application not found or already decided'; end if;
  base := trim(both '-' from regexp_replace(lower(app.artist_name), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'artist'; end if;
  final_slug := base;
  while exists (select 1 from public.artists where slug = final_slug) loop n := n + 1; final_slug := base || '-' || n; end loop;
  insert into public.artists (owner_id, name, slug, bio, artist_type, country, hometown, links)
    values (app.user_id, app.artist_name, final_slug, app.bio, app.artist_type, app.country, app.hometown, app.links) returning id into new_artist;
  if app.contact_email is not null then insert into public.artist_private (artist_id, contact_email) values (new_artist, app.contact_email); end if;
  update public.profiles set role = 'artist' where id = app.user_id and role::text = 'listener';
  update public.artist_applications set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = p_application;
  perform public.write_audit('approve_artist', 'artist_application', p_application::text, jsonb_build_object('artist_id', new_artist));
  return new_artist;
end $$;
create or replace function public.reject_artist_application(p_application uuid, p_reason text) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.artist_applications set status = 'rejected', decision_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_application and status::text in ('pending', 'under_review', 'info_requested');
  if not found then raise exception 'Application not found or already decided'; end if;
  perform public.write_audit('reject_artist', 'artist_application', p_application::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------- artist images (public bucket "artists", 1 MB; files at <artist id>/<file>, stored in the table as artists/<artist id>/<file>) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artists', 'artists', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.owns_artist_folder(p_name text) returns boolean
language plpgsql stable security definer set search_path = 'public' as $$
declare f text := (storage.foldername(p_name))[1];
begin
  if f is null or f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return private.owns_artist(f::uuid);
end $$;
revoke all on function private.owns_artist_folder(text) from public;
grant execute on function private.owns_artist_folder(text) to authenticated;

create policy "artists bucket: add to own artist folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'artists' and private.owns_artist_folder(name));
create policy "artists bucket: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'artists' and private.owns_artist_folder(name)) with check (bucket_id = 'artists' and private.owns_artist_folder(name));
create policy "artists bucket: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'artists' and private.owns_artist_folder(name));
create policy "artists bucket: list own" on storage.objects for select to authenticated
  using (bucket_id = 'artists' and private.owns_artist_folder(name));

-- Revert notes (before any new-state data exists): drop the new policies/triggers/functions/tables and columns added above;
-- enum values added in step 1 cannot be removed from Postgres enums (harmless if unused).
```

## Existing tests changed (expected wording only)
- 'Admin only' becomes 'Admin or Staff only' for approve/reject (moderators are staff).
- Application insert with status 'approved' is now refused by the row policy instead of a column grant.
- Unique-index name: one_pending_per_user becomes one_active_per_user.
