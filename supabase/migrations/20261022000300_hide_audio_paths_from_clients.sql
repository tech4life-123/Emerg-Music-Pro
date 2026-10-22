-- Phase 1 hardening (3/3): storage paths of audio files are not part of the public API.
-- Row Level Security is row-level only, so anon/authenticated could read audio_path / audio_low_path /
-- audio_std_path of every published track. Paths must not be a way around the playback gate.
--
-- POTENTIALLY BREAKING for any client that does `select *` on tracks (PostgREST then fails with
-- "permission denied for column"). Select explicit columns instead. To revert this one migration:
--   grant select on public.tracks to anon, authenticated;
revoke select on public.tracks from anon, authenticated;
grant select (id, release_id, artist_id, title, track_number, duration_ms, created_at, genre_id,
              secondary_genre_id, explicit, processing_status)
  on public.tracks to anon, authenticated;
