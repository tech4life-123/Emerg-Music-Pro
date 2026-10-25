-- REVERT of every change made to this database by the Emerg Music PRO work (migrations 20261022000100 .. 20261022001000).
-- Target state: exactly the schema recorded by migrations 20261020145037 .. 20261021203301 (+ the unrecorded live changes of
-- 20261022000000, which already existed here). Rehearsed on local PostgreSQL 16: the catalogs (columns, constraints, indexes,
-- policies, functions, triggers, grants, enums, RLS flags) are compared against that baseline by scripts/catalog-diff.ts.
-- DATA LOSS (intended): rows of rights_records, rights_evidence, processing_jobs; tracks.removed_at / removal_reason;
-- copyright_reports.track_id. Everything else is data-preserving. NOT a migration for the new Emerg Music Pro project.

-- 1. Restore the public policy helpers (policies are re-pointed to them in step 3).
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$function$;
CREATE OR REPLACE FUNCTION public.owns_artist(a uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.artists where id = a and owner_id = auth.uid() and status = 'approved');
$function$;
grant execute on function public.is_admin() to public, anon, authenticated, service_role;
grant execute on function public.owns_artist(uuid) to public, anon, authenticated, service_role;

-- 2. Remove the tables added by the Pro work (cascades their policies, indexes, triggers, grants).
drop table public.rights_evidence;
drop table public.rights_records;
drop table public.processing_jobs;

-- 3. Policies back to their original definitions.
alter policy "applications: create own" on public.artist_applications
  with check (((user_id = auth.uid()) AND (status = 'pending'::application_status) AND (reviewed_by IS NULL)));
alter policy "applications: read own or admin" on public.artist_applications
  using (((user_id = auth.uid()) OR public.is_admin()));
alter policy "artists: public read approved" on public.artists
  using (((status = 'approved'::artist_status) OR (owner_id = auth.uid()) OR public.is_admin()));
alter policy "audit: admin reads" on public.audit_log
  using (public.is_admin());
alter policy "reports: admin reads" on public.copyright_reports
  using (public.is_admin());
alter policy "plays: read own, artist, admin" on public.play_events
  using (((user_id = auth.uid()) OR public.is_admin() OR (EXISTS ( SELECT 1
   FROM tracks t
  WHERE ((t.id = play_events.track_id) AND public.owns_artist(t.artist_id))))));
alter policy "profiles: read own" on public.profiles
  using (((id = auth.uid()) OR public.is_admin()));
alter policy "releases: artist creates draft" on public.releases
  with check ((public.owns_artist(artist_id) AND (status = 'draft'::release_status)));
alter policy "releases: artist deletes own draft" on public.releases
  using ((public.owns_artist(artist_id) AND (status = 'draft'::release_status)));
alter policy "releases: artist edits own" on public.releases
  using ((public.owns_artist(artist_id) OR public.is_admin()))
  with check ((public.owns_artist(artist_id) OR public.is_admin()));
alter policy "releases: read published or own or admin" on public.releases
  using (((status = 'published'::release_status) OR public.owns_artist(artist_id) OR public.is_admin()));
alter policy "rights: artist declares for own release" on public.rights_declarations
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM releases r
  WHERE ((r.id = rights_declarations.release_id) AND public.owns_artist(r.artist_id))))));
alter policy "rights: read own or admin" on public.rights_declarations
  using (((user_id = auth.uid()) OR public.is_admin()));
alter policy "credits: artist manages own" on public.track_credits
  using ((EXISTS ( SELECT 1
   FROM tracks t
  WHERE ((t.id = track_credits.track_id) AND public.owns_artist(t.artist_id)))))
  with check ((EXISTS ( SELECT 1
   FROM tracks t
  WHERE ((t.id = track_credits.track_id) AND public.owns_artist(t.artist_id)))));
alter policy "credits: read if track visible" on public.track_credits
  using ((EXISTS ( SELECT 1
   FROM (tracks t
     JOIN releases r ON ((r.id = t.release_id)))
  WHERE ((t.id = track_credits.track_id) AND ((r.status = 'published'::release_status) OR public.owns_artist(r.artist_id) OR public.is_admin())))));
alter policy "tracks: artist manages own" on public.tracks
  using (public.owns_artist(artist_id))
  with check ((public.owns_artist(artist_id) AND (EXISTS ( SELECT 1
   FROM releases r
  WHERE ((r.id = tracks.release_id) AND (r.artist_id = tracks.artist_id))))));
alter policy "tracks: read if release visible" on public.tracks
  using ((EXISTS ( SELECT 1
   FROM releases r
  WHERE ((r.id = tracks.release_id) AND ((r.status = 'published'::release_status) OR public.owns_artist(r.artist_id) OR public.is_admin())))));

-- 4. Triggers and functions added by the Pro work.
drop trigger tracks_audio_lock on public.tracks;
drop trigger audit_log_no_update_delete on public.audit_log;
drop trigger audit_log_no_truncate on public.audit_log;
drop trigger copyright_reports_fill_artist on public.copyright_reports;
drop function public.guard_track_audio_lock();
drop function public.audit_log_append_only();
drop function public.copyright_reports_fill_artist();
drop function public.get_playback_target(uuid, text, boolean);
drop function public.enqueue_processing_job(uuid);
drop function public.claim_processing_job(int);
drop function public.complete_processing_job(uuid, text, text, int);
drop function public.fail_processing_job(uuid, text, text, boolean);
drop function public.takedown_track(uuid, text);
drop function public.restore_track(uuid, text);
drop function public.review_rights_record(uuid, text, text);

-- 5. Original definitions of functions the Pro work replaced (note: set_track_audio_variants is again callable by signed-in users, as it was).
CREATE OR REPLACE FUNCTION public.approve_artist_application(p_application uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.reject_artist_application(p_application uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.artist_applications set status = 'rejected', decision_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_application and status = 'pending';
  if not found then raise exception 'Application not found or already decided'; end if;
  perform public.write_audit('reject_artist', 'artist_application', p_application::text, jsonb_build_object('reason', p_reason));
end $function$;
CREATE OR REPLACE FUNCTION public.moderate_release(p_release uuid, p_status release_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status in ('removed','draft') and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.releases set status = p_status, removal_reason = case when p_status in ('removed','draft') then p_reason else null end where id = p_release;
  if not found then raise exception 'Release not found'; end if;
  perform public.write_audit('moderate_release', 'release', p_release::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $function$;
CREATE OR REPLACE FUNCTION public.resolve_copyright_report(p_report uuid, p_status report_status, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status = 'received' then
    raise exception 'Choose under_review, upheld or dismissed';
  end if;
  update public.copyright_reports
     set status = p_status,
         resolution_note = p_note,
         resolved_at = case when p_status in ('upheld','dismissed') then now() else null end
   where id = p_report;
  if not found then raise exception 'Report not found'; end if;
  perform public.write_audit('resolve_report', 'copyright_report', p_report::text,
    jsonb_build_object('status', p_status, 'note', p_note));
end $function$;
CREATE OR REPLACE FUNCTION public.guard_release_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.set_track_audio_variants(p_track uuid, p_status text, p_low text, p_std text, p_duration_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.tracks;
begin
  select * into t from public.tracks where id = p_track;
  if not found then raise exception 'Track not found'; end if;
  if not (public.owns_artist(t.artist_id) or public.is_admin()) then raise exception 'Not allowed'; end if;
  if p_status not in ('processing','ready','failed') then raise exception 'Bad status'; end if;
  update public.tracks set
    processing_status = p_status,
    audio_low_path = coalesce(p_low, audio_low_path),
    audio_std_path = coalesce(p_std, audio_std_path),
    duration_ms = coalesce(p_duration_ms, duration_ms)
  where id = p_track;
end $function$;
grant execute on function public.set_track_audio_variants(uuid, text, text, text, int) to authenticated;

-- 6. Private schema and its helpers (nothing references them any more).
drop function private.is_admin();
drop function private.owns_artist(uuid);
drop function private.release_rights_ok(uuid, text);
drop schema private;

-- 7. Columns, constraints and indexes added by the Pro work.
revoke select (removed_at, removal_reason) on public.tracks from authenticated;
revoke insert (track_id) on public.copyright_reports from anon, authenticated;
alter table public.tracks drop column removed_at, drop column removal_reason;
alter table public.copyright_reports drop constraint copyright_reports_email_check, drop constraint copyright_reports_reporter_check, drop column track_id;
drop index public.artist_applications_one_pending_per_user;

-- 8. Foreign keys back to their original referential actions (no ON DELETE action = NO ACTION).
-- audit_log.actor_id NOT NULL is restored only when no row has a NULL actor (it would otherwise fail, which is the safe outcome).
alter table public.audit_log drop constraint audit_log_actor_id_fkey;
alter table public.audit_log add constraint audit_log_actor_id_fkey foreign key (actor_id) references public.profiles(id);
alter table public.audit_log alter column actor_id set not null;
alter table public.artist_applications drop constraint artist_applications_reviewed_by_fkey;
alter table public.artist_applications add constraint artist_applications_reviewed_by_fkey foreign key (reviewed_by) references public.profiles(id);
alter table public.rights_declarations drop constraint rights_declarations_user_id_fkey;
alter table public.rights_declarations add constraint rights_declarations_user_id_fkey foreign key (user_id) references public.profiles(id);

-- 9. Table-level grants back to what they were (REVOKE at table level also removes column-level grants).
revoke select on public.tracks from anon, authenticated;
grant select on public.tracks to anon, authenticated;
revoke insert on public.tracks from authenticated;
grant insert on public.tracks to authenticated;
revoke select on public.artists from anon;
grant select on public.artists to anon;
revoke insert on public.releases from authenticated;
grant insert on public.releases to authenticated;
revoke insert on public.artist_applications from authenticated;
grant insert on public.artist_applications to authenticated;
revoke insert on public.copyright_reports from anon, authenticated;
grant insert on public.copyright_reports to anon, authenticated;

