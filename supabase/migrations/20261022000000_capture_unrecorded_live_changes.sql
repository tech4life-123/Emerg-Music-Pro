-- Captures changes that exist in the live "Emerg Music" Supabase project but were never recorded in
-- supabase_migrations (they were applied directly, e.g. via the SQL editor). Found by diffing the live catalog
-- against the recorded migrations on 2026-10-22. IDEMPOTENT: safe to run on the live database, where it is a no-op.

-- Direct updates of copyright_reports were replaced by an admin-only function.
drop policy if exists "reports: admin updates" on public.copyright_reports;
revoke update on public.copyright_reports from authenticated;

create or replace function public.resolve_copyright_report(p_report uuid, p_status public.report_status, p_note text)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;
revoke execute on function public.resolve_copyright_report(uuid, public.report_status, text) from public, anon;
grant execute on function public.resolve_copyright_report(uuid, public.report_status, text) to authenticated;

-- audio_path must live in the track owner's own folder (same rule as the low/std variant paths).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracks_audio_path_own_folder' and conrelid = 'public.tracks'::regclass) then
    alter table public.tracks add constraint tracks_audio_path_own_folder
      check (audio_path is null or audio_path like 'audio/' || artist_id::text || '/' || id::text || '/%');
  end if;
end $$;

-- A track may only be written into a release that belongs to the SAME artist.
drop policy if exists "tracks: artist manages own" on public.tracks;
create policy "tracks: artist manages own" on public.tracks for all to authenticated
  using (public.owns_artist(artist_id))
  with check (public.owns_artist(artist_id)
    and exists (select 1 from public.releases r where r.id = tracks.release_id and r.artist_id = tracks.artist_id));
