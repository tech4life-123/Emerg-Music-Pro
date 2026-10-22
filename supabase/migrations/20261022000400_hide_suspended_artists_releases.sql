-- Phase 2 (catalog) hardening. A release only stays publicly readable while its artist is APPROVED.
-- Before this, suspending an artist hid the artist row but their published releases (and, through the tracks policy,
-- their tracks) stayed readable by anyone calling the API directly. The owner and admins are unaffected.
-- Additive in effect: it only narrows what anonymous / other users can read. Revert by restoring the previous policy:
--   using (status = 'published' or public.owns_artist(artist_id) or public.is_admin())
drop policy if exists "releases: read published or own or admin" on public.releases;
create policy "releases: read published or own or admin" on public.releases for select to anon, authenticated
  using (
    (status = 'published'
      and exists (select 1 from public.artists a where a.id = releases.artist_id and a.status = 'approved'))
    or public.owns_artist(artist_id)
    or public.is_admin()
  );
