-- Phase 4: takedown at TRACK level, a stricter submission gate, tighter public write surfaces.
-- Uses ALTER POLICY (not drop/create) so it can be applied without destructive statements.

-- 1. Track-level takedown. Admin-only functions; both audited. Takedown hides the track from everyone but its owner and
--    admins, and blocks playback authorization immediately (tokens already issued expire within their TTL).
alter table public.tracks add column removed_at timestamptz, add column removal_reason text;
grant select (removed_at, removal_reason) on public.tracks to authenticated;

alter policy "tracks: read if release visible" on public.tracks using (
  exists (
    select 1 from public.releases r
    where r.id = tracks.release_id
      and (
        (r.status = 'published' and tracks.removed_at is null
          and exists (select 1 from public.artists a where a.id = r.artist_id and a.status = 'approved'))
        or private.owns_artist(r.artist_id)
        or private.is_admin()
      )
  )
);

create or replace function public.takedown_track(p_track uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.tracks set removed_at = now(), removal_reason = left(p_reason, 500) where id = p_track and removed_at is null;
  if not found then raise exception 'Track not found or already removed'; end if;
  perform public.write_audit('takedown_track', 'track', p_track::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.restore_track(p_track uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  update public.tracks set removed_at = null, removal_reason = null where id = p_track and removed_at is not null;
  if not found then raise exception 'Track not found or not removed'; end if;
  perform public.write_audit('restore_track', 'track', p_track::text, jsonb_build_object('note', p_note));
end $$;

revoke execute on function public.takedown_track(uuid, text) from public, anon;
revoke execute on function public.restore_track(uuid, text) from public, anon;
grant execute on function public.takedown_track(uuid, text) to authenticated;
grant execute on function public.restore_track(uuid, text) to authenticated;

-- Playback gate: a removed track is never authorized.
create or replace function public.get_playback_target(p_track uuid, p_country text, p_low boolean default false)
returns table (track_id uuid, variant text, storage_key text, duration_ms int)
language sql stable security definer set search_path = '' as $$
  select t.id,
         case when (case when p_low then coalesce(t.audio_low_path, t.audio_std_path) else coalesce(t.audio_std_path, t.audio_low_path) end) = t.audio_low_path then 'low' else 'std' end,
         case when p_low then coalesce(t.audio_low_path, t.audio_std_path) else coalesce(t.audio_std_path, t.audio_low_path) end,
         t.duration_ms
  from public.tracks t
  join public.releases r on r.id = t.release_id
  join public.artists a on a.id = r.artist_id
  where t.id = p_track
    and t.removed_at is null
    and r.status = 'published'
    and a.status = 'approved'
    and t.processing_status = 'ready'
    and coalesce(t.audio_std_path, t.audio_low_path) is not null
    and private.release_rights_ok(r.id, coalesce(nullif(trim(p_country), ''), '??'));
$$;
revoke execute on function public.get_playback_target(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.get_playback_target(uuid, text, boolean) to service_role;

-- 2. Submission gate (artists): a release can only be submitted when it is complete enough to review.
create or replace function public.guard_release_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not private.is_admin() then
    if not (old.status = 'draft' and new.status = 'in_review') then
      raise exception 'Only an admin can set status to %', new.status;
    end if;
    if not exists (select 1 from public.rights_declarations where release_id = new.id) then
      raise exception 'A rights declaration is required before submitting a release';
    end if;
    if not exists (select 1 from public.rights_records where release_id = new.id and review_status in ('pending','approved')) then
      raise exception 'Add a rights record (who owns the rights, where, and for how long) before submitting';
    end if;
    if not exists (select 1 from public.tracks where release_id = new.id and removed_at is null) then
      raise exception 'Add at least one track before submitting';
    end if;
    if exists (select 1 from public.tracks where release_id = new.id and removed_at is null and processing_status <> 'ready') then
      raise exception 'Every track needs processed audio before submitting. Wait for processing to finish, or fix failed tracks';
    end if;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    if not private.release_rights_ok(new.id, null) then
      raise exception 'Cannot publish: the release needs an approved, in-term rights record';
    end if;
    new.published_at := now();
  end if;
  return new;
end $$;

-- 3. Copyright reports: the public may file a report, nothing more. They can no longer write status/resolution fields,
--    and the artist is derived from the release (a reporter cannot misattribute a report).
alter table public.copyright_reports add column track_id uuid references public.tracks(id) on delete set null;
revoke insert on public.copyright_reports from anon, authenticated;
grant insert (release_id, track_id, reporter_name, reporter_email, description) on public.copyright_reports to anon, authenticated;
alter table public.copyright_reports
  add constraint copyright_reports_reporter_check check (
    reporter_name is null or char_length(reporter_name) between 1 and 200),
  add constraint copyright_reports_email_check check (
    reporter_email is null or (char_length(reporter_email) <= 254 and reporter_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
-- NOTE: "a report must name a release" is enforced by the BEFORE INSERT trigger below, NOT by a CHECK constraint: release_id is
-- ON DELETE SET NULL (reports outlive a deleted release), and a CHECK would make deleting any reported release fail.

create or replace function public.copyright_reports_fill_artist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select r.artist_id into new.artist_id from public.releases r where r.id = new.release_id;
  if not found then raise exception 'Release not found'; end if;
  if new.track_id is not null and not exists (select 1 from public.tracks t where t.id = new.track_id and t.release_id = new.release_id) then
    raise exception 'Track does not belong to that release';
  end if;
  return new;
end $$;
revoke execute on function public.copyright_reports_fill_artist() from public, anon, authenticated;
create trigger copyright_reports_fill_artist before insert on public.copyright_reports
  for each row execute function public.copyright_reports_fill_artist();

-- 4. Other write surfaces: only the columns a client legitimately supplies.
revoke insert on public.releases from authenticated;
grant insert (id, artist_id, title, type, language, genre_id, cover_path) on public.releases to authenticated;

revoke insert on public.artist_applications from authenticated;
grant insert (user_id, artist_name, bio, links, rights_statement_accepted) on public.artist_applications to authenticated;
alter policy "applications: create own" on public.artist_applications
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null and rights_statement_accepted);
create unique index artist_applications_one_pending_per_user on public.artist_applications (user_id) where status = 'pending';
