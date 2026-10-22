-- Policy helper functions are SECURITY DEFINER and were callable through the public API (/rest/v1/rpc/is_admin,
-- /rpc/owns_artist), which the Supabase advisors flag. They only exist to be used inside RLS policies and other
-- functions, so they move to the `private` schema (not exposed through the API).
--  * RLS policies reference functions by OID, so moving the functions keeps every policy working unchanged.
--  * plpgsql bodies reference them by NAME, so the 7 functions that call is_admin() are re-created below
--    (definitions copied from the migrated schema; only `public.is_admin()` -> `private.is_admin()` changed).
--  * anon/authenticated still need EXECUTE + schema USAGE because policies are evaluated as the caller.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

alter function public.is_admin() set schema private;
alter function public.owns_artist(uuid) set schema private;
revoke execute on function private.is_admin(), private.owns_artist(uuid) from public;
grant execute on function private.is_admin(), private.owns_artist(uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_artist_application(p_application uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare app public.artist_applications; new_artist uuid; base text; final_slug text; n int := 0;
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
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
end $function$
;


CREATE OR REPLACE FUNCTION public.guard_release_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from old.status and not private.is_admin() then
    if not (old.status = 'draft' and new.status = 'in_review') then
      raise exception 'Only an admin can set status to %', new.status;
    end if;
    if not exists (select 1 from public.rights_declarations where release_id = new.id) then
      raise exception 'A rights declaration is required before submitting a release';
    end if;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    if not private.release_rights_ok(new.id, null) then
      raise exception 'Cannot publish: the release needs an approved, in-term rights record';
    end if;
    new.published_at := now();
  end if;
  return new;
end $function$
;


CREATE OR REPLACE FUNCTION public.guard_track_audio_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rstatus public.release_status;
begin
  -- Trusted callers (service role, SQL editor/migrations) and admins are not restricted here.
  if coalesce(auth.role(), '') <> 'authenticated' or private.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.audio_path is not distinct from old.audio_path then return new; end if;
  select status into rstatus from public.releases
    where id = case when tg_op = 'DELETE' then old.release_id else new.release_id end;
  -- Release already gone (cascade from deleting a draft release): nothing to protect.
  if not found then return case when tg_op = 'DELETE' then old else new end; end if;
  if rstatus <> 'draft' then
    raise exception 'Audio can only be added, replaced or removed while the release is a draft';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $function$
;


CREATE OR REPLACE FUNCTION public.moderate_release(p_release uuid, p_status release_status, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  if p_status in ('removed','draft') and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.releases set status = p_status, removal_reason = case when p_status in ('removed','draft') then p_reason else null end where id = p_release;
  if not found then raise exception 'Release not found'; end if;
  perform public.write_audit('moderate_release', 'release', p_release::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $function$
;


CREATE OR REPLACE FUNCTION public.reject_artist_application(p_application uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.artist_applications set status = 'rejected', decision_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_application and status = 'pending';
  if not found then raise exception 'Application not found or already decided'; end if;
  perform public.write_audit('reject_artist', 'artist_application', p_application::text, jsonb_build_object('reason', p_reason));
end $function$
;


CREATE OR REPLACE FUNCTION public.resolve_copyright_report(p_report uuid, p_status report_status, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
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
end $function$
;


CREATE OR REPLACE FUNCTION public.review_rights_record(p_record uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not private.is_admin() then raise exception 'Admin only'; end if;
  if p_status not in ('approved','changes_requested','rejected') then raise exception 'Bad status'; end if;
  if p_status <> 'approved' and coalesce(trim(p_note), '') = '' then raise exception 'A note is required'; end if;
  update public.rights_records
     set review_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_record;
  if not found then raise exception 'Rights record not found'; end if;
  perform public.write_audit('review_rights', 'rights_record', p_record::text, jsonb_build_object('status', p_status, 'note', p_note));
end $function$
;
