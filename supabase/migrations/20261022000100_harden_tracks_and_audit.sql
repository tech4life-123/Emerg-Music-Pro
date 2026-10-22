-- Phase 1 hardening (1/3). Additive and non-destructive: no data is changed or removed.
--  * Clients can no longer set processing results / variant paths when inserting a track.
--  * Audio cannot be added, replaced or removed once a release has left draft (it would bypass moderation).
--  * Only the trusted backend (service role) may record audio-processing results.
--  * audit_log becomes append-only.

-- 1. Column-level INSERT on tracks (previously table-wide, which let an artist insert processing_status='ready').
revoke insert on public.tracks from authenticated;
grant insert (id, release_id, artist_id, title, track_number, audio_path, duration_ms, genre_id, secondary_genre_id, explicit)
  on public.tracks to authenticated;

-- 2. Audio is only editable while the release is a draft. Metadata (title, genre, explicit...) stays editable.
create or replace function public.guard_track_audio_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare rstatus public.release_status;
begin
  -- Trusted callers (service role, SQL editor/migrations) and admins are not restricted here.
  if coalesce(auth.role(), '') <> 'authenticated' or public.is_admin() then
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
end $$;
revoke execute on function public.guard_track_audio_lock() from public, anon, authenticated;
create trigger tracks_audio_lock before insert or delete or update of audio_path on public.tracks
  for each row execute function public.guard_track_audio_lock();

-- 3. Processing results come from the trusted worker only (previously any artist could mark their own track 'ready').
create or replace function public.set_track_audio_variants(p_track uuid, p_status text, p_low text, p_std text, p_duration_ms int)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tracks;
begin
  if coalesce(auth.role(), '') = 'authenticated' then raise exception 'Not allowed'; end if;
  select * into t from public.tracks where id = p_track;
  if not found then raise exception 'Track not found'; end if;
  if p_status not in ('processing','ready','failed') then raise exception 'Bad status'; end if;
  if p_status = 'ready' and coalesce(p_std, t.audio_std_path, p_low, t.audio_low_path) is null then
    raise exception 'A track can only be ready once a rendition exists';
  end if;
  update public.tracks set
    processing_status = p_status,
    audio_low_path = coalesce(p_low, audio_low_path),
    audio_std_path = coalesce(p_std, audio_std_path),
    duration_ms = coalesce(p_duration_ms, duration_ms)
  where id = p_track;
end $$;
revoke execute on function public.set_track_audio_variants(uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.set_track_audio_variants(uuid, text, text, text, int) to service_role;

-- 4. Append-only audit log.
create or replace function public.audit_log_append_only() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'audit_log is append-only';
end $$;
revoke execute on function public.audit_log_append_only() from public, anon, authenticated;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();
