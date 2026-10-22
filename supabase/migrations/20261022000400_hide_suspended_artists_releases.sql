-- Phase 2 (catalog) hardening. A release only stays publicly readable while its artist is APPROVED.
-- Before this, suspending an artist hid the artist row but their published releases (and, through the tracks policy,
-- their tracks) stayed readable by anyone calling the API directly. The owner and admins are unaffected.
-- Uses ALTER POLICY (not drop/create) so there is no window without a policy and no destructive statement.
-- Revert: alter policy ... using (status = 'published' or public.owns_artist(artist_id) or public.is_admin())
alter policy "releases: read published or own or admin" on public.releases
  using (
    (status = 'published'
      and exists (select 1 from public.artists a where a.id = releases.artist_id and a.status = 'approved'))
    or public.owns_artist(artist_id)
    or public.is_admin()
  );
