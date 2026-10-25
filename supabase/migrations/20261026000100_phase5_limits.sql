-- Phase 5, Milestone 2: server-side usage limits (approved decision E). PROPOSED, not applied to the live project.
--   200 playlists per user, 500 tracks per playlist, 5,000 liked tracks per user.
-- Limits live in a private table so they can be changed with one SQL statement, no redeploy:
--   update private.app_limits set value = 300 where key = 'max_playlists_per_user';
-- Enforced by BEFORE INSERT triggers, so they apply to direct API requests, not just the UI.
-- A per-owner advisory lock makes the count-then-insert safe against parallel requests.
-- Additive only: one new table, three functions, three triggers. Revert: drop the three triggers (table/functions are harmless to keep).

create table private.app_limits (
  key text primary key,
  value int not null check (value > 0)
);
alter table private.app_limits enable row level security; -- no policies and no grants: unreachable through the API
insert into private.app_limits (key, value) values
  ('max_playlists_per_user', 200),
  ('max_tracks_per_playlist', 500),
  ('max_liked_tracks_per_user', 5000);

create or replace function private.limit_of(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select value from private.app_limits where key = p_key;
$$;
revoke all on function private.limit_of(text) from public;

create or replace function private.enforce_playlist_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int := private.limit_of('max_playlists_per_user');
begin
  perform pg_advisory_xact_lock(hashtextextended('playlists:' || new.owner_id::text, 0));
  if (select count(*) from public.playlists where owner_id = new.owner_id) >= v_max then
    raise exception 'You can have up to % playlists.', v_max;
  end if;
  return new;
end $$;
revoke all on function private.enforce_playlist_limit() from public;
create trigger playlist_limit before insert on public.playlists for each row execute function private.enforce_playlist_limit();

create or replace function private.enforce_playlist_track_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int := private.limit_of('max_tracks_per_playlist');
begin
  perform pg_advisory_xact_lock(hashtextextended('playlist_tracks:' || new.playlist_id::text, 0));
  if (select count(*) from public.playlist_tracks where playlist_id = new.playlist_id) >= v_max then
    raise exception 'A playlist can hold up to % tracks.', v_max;
  end if;
  return new;
end $$;
revoke all on function private.enforce_playlist_track_limit() from public;
create trigger playlist_track_limit before insert on public.playlist_tracks for each row execute function private.enforce_playlist_track_limit();

create or replace function private.enforce_favorite_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int := private.limit_of('max_liked_tracks_per_user');
begin
  perform pg_advisory_xact_lock(hashtextextended('favorites:' || new.user_id::text, 0));
  if (select count(*) from public.favorites where user_id = new.user_id) >= v_max then
    raise exception 'You can like up to % tracks.', v_max;
  end if;
  return new;
end $$;
revoke all on function private.enforce_favorite_limit() from public;
create trigger favorite_limit before insert on public.favorites for each row execute function private.enforce_favorite_limit();
