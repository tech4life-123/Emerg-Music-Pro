-- Least privilege: RLS is the main gate, grants are a second one. Supabase grants everything by default; remove it.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Public catalog (RLS limits rows to published/approved/public)
grant select on public.artists, public.releases, public.tracks, public.playlists, public.playlist_tracks to anon, authenticated;
-- Anyone may file a copyright report
grant insert on public.copyright_reports to anon, authenticated;

-- Signed-in users
grant select on public.profiles, public.artist_applications, public.rights_declarations, public.play_events, public.favorites, public.audit_log, public.copyright_reports to authenticated;
grant update (display_name, avatar_url, locale) on public.profiles to authenticated;
grant insert on public.artist_applications to authenticated;
grant update (bio, image_url) on public.artists to authenticated;
grant insert, update, delete on public.releases to authenticated;
grant insert, update, delete on public.tracks to authenticated;
grant insert on public.rights_declarations to authenticated;
grant insert, update, delete on public.playlists, public.playlist_tracks to authenticated;
grant insert, delete on public.favorites to authenticated;
grant insert, delete on public.play_events to authenticated;
grant update on public.copyright_reports to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- insert on copyright_reports by anon needs no sequence (uuid key)

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
