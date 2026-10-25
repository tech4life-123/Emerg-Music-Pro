-- Phase 5 (PRD Phase 6, Listener features) -- STEP 1: security fixes BEFORE any listener UI is built.
-- PROPOSED. Not applied to the live project. All four live tables involved (favorites, artist_follows, playlist_tracks, play_events)
-- were empty when last checked, so nothing here rewrites or loses data. Uses ALTER POLICY (no drop policy).
--
-- Fixes:
--  1. play_events leaked listener identity to artists (artists could SELECT raw rows incl. user_id).      -> artist branch removed; aggregates-only function added.
--  2. Any signed-in user could INSERT any play event for any track, with any listened_ms.                 -> direct client insert closed; server-only validated recorder added.
--  3. favorites / artist_follows accepted tracks/artists the user cannot see (unpublished, removed, suspended). -> insert now requires a publicly visible target.
--  4. playlist_tracks accepted non-public tracks, and exposed ids of removed tracks inside public playlists.  -> insert trigger + tighter read policy.
--
-- NOT in this migration (need your approval first): validated-play threshold, caps, retention, playlist sharing semantics.
-- Revert notes are at the bottom of the file.

-- ---------- helpers (private schema: not exposed through the API) ----------
create or replace function private.is_public_track(p_track uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tracks t
    join public.releases r on r.id = t.release_id
    join public.artists a on a.id = r.artist_id
    where t.id = p_track and t.removed_at is null and r.status = 'published' and a.status = 'approved'
  );
$$;
revoke all on function private.is_public_track(uuid) from public;
grant execute on function private.is_public_track(uuid) to anon, authenticated, service_role;

create or replace function private.is_public_artist(p_artist uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.artists a where a.id = p_artist and a.status = 'approved');
$$;
revoke all on function private.is_public_artist(uuid) from public;
grant execute on function private.is_public_artist(uuid) to anon, authenticated, service_role;

-- ---------- 3. favorites / artist_follows: target must be publicly visible ----------
-- (favorites and artist_follows have no UPDATE grant, so this WITH CHECK only ever gates INSERT.)
alter policy "favorites: manage own" on public.favorites
  with check (user_id = auth.uid() and private.is_public_track(track_id));
alter policy "follows: manage own" on public.artist_follows
  with check (user_id = auth.uid() and private.is_public_artist(artist_id));

-- ---------- 4. playlist_tracks ----------
-- Insert-only trigger (an RLS WITH CHECK would also block re-ordering a playlist that still holds a since-removed track).
create or replace function private.guard_playlist_track_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_public_track(new.track_id) then
    raise exception 'That track is not available' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_playlist_track_insert() from public;
create trigger playlist_track_guard before insert on public.playlist_tracks
  for each row execute function private.guard_playlist_track_insert();

-- Public playlists no longer reveal ids of removed/unpublished tracks; owners still see (and can remove) their own dead items.
alter policy "playlist_tracks: read if playlist visible" on public.playlist_tracks
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_tracks.playlist_id
      and (p.owner_id = auth.uid() or (p.is_public and private.is_public_track(playlist_tracks.track_id)))
  ));

-- ---------- 1 + 2. play_events ----------
alter table public.play_events add column client_event_id uuid;
create unique index play_events_client_event_uidx on public.play_events (user_id, client_event_id) where client_event_id is not null;

-- Artists lose raw-row access. Listeners keep their own history; admins keep read for abuse handling (see decision list).
alter policy "plays: read own, artist, admin" on public.play_events
  using (user_id = auth.uid() or private.is_admin());

-- Clients can no longer write events at all; the server route records them through record_play_event below.
revoke insert on public.play_events from authenticated;
alter policy "plays: record own" on public.play_events with check (false);

-- Server-only recorder (service_role). Validates the track is public, clamps listened_ms to the track length, is idempotent per
-- (user, client_event_id). The "counts as a play" threshold is deliberately NOT here: it is a pending PRD decision, enforced by the caller.
create or replace function public.record_play_event(p_user uuid, p_track uuid, p_client_event_id uuid, p_listened_ms int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_dur int;
  v_rows int;
begin
  if p_client_event_id is null then raise exception 'client_event_id is required'; end if;
  if p_listened_ms is null or p_listened_ms < 0 then raise exception 'invalid listened_ms'; end if;
  if not private.is_public_track(p_track) then return false; end if;
  select t.duration_ms into v_dur from public.tracks t where t.id = p_track;
  insert into public.play_events (track_id, user_id, listened_ms, client_event_id)
  values (p_track, p_user, least(p_listened_ms, coalesce(v_dur, p_listened_ms)), p_client_event_id)
  on conflict (user_id, client_event_id) where client_event_id is not null do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;
revoke all on function public.record_play_event(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.record_play_event(uuid, uuid, uuid, int) to service_role;

-- Aggregates only: counts and sums per day and track. No user ids are returned.
create or replace function public.artist_play_stats(p_artist uuid, p_from date, p_to date)
returns table (day date, track_id uuid, plays bigint, unique_listeners bigint, listened_ms bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.owns_artist(p_artist) or private.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'Invalid date range'; end if;
  return query
    select (e.created_at at time zone 'UTC')::date, e.track_id, count(*), count(distinct e.user_id), coalesce(sum(e.listened_ms), 0)::bigint
    from public.play_events e join public.tracks t on t.id = e.track_id
    where t.artist_id = p_artist
      and e.created_at >= (p_from::timestamp at time zone 'UTC')
      and e.created_at <  ((p_to + 1)::timestamp at time zone 'UTC')
    group by 1, 2 order by 1, 2;
end $$;
revoke all on function public.artist_play_stats(uuid, date, date) from public, anon;
grant execute on function public.artist_play_stats(uuid, date, date) to authenticated;

-- Revert (if ever needed, before any listener data exists):
--   alter policy "favorites: manage own" on public.favorites with check (user_id = auth.uid());
--   alter policy "follows: manage own" on public.artist_follows with check (user_id = auth.uid());
--   alter policy "plays: record own" on public.play_events with check (user_id = auth.uid());  grant insert on public.play_events to authenticated;
--   alter policy "plays: read own, artist, admin" on public.play_events using (user_id = auth.uid() or private.is_admin() or exists (select 1 from public.tracks t where t.id = track_id and private.owns_artist(t.artist_id)));
--   alter policy "playlist_tracks: read if playlist visible" ... using (exists (select 1 from public.playlists p where p.id = playlist_id and (p.is_public or p.owner_id = auth.uid())));
--   drop trigger playlist_track_guard on public.playlist_tracks;  (the new column/index/functions are additive and harmless to leave)
