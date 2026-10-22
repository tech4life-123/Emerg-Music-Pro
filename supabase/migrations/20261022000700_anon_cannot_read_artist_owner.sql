-- Anonymous visitors could read artists.owner_id (the owning account's id). Not needed publicly: the catalog shows
-- name/slug/bio only. Signed-in users keep full read (the app filters artists by owner_id for the studio).
-- Revert: grant select on public.artists to anon;
revoke select on public.artists from anon;
grant select (id, slug, name, bio, image_url, status, created_at) on public.artists to anon;
