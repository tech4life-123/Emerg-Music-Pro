-- Rights records could only be declared while a release was a DRAFT. A release that is already published
-- (e.g. everything published before rights records existed) could therefore never get one through the app, so its
-- audio could never pass the playback gate. Artists may now also add a (pending) rights record + evidence reference
-- to a published release of their own. Admin review (review_rights_record) is still required before it counts,
-- and in_review / removed releases remain closed.
alter policy "rights_records: artist declares on own draft" on public.rights_records
  with check (
    declared_by = auth.uid() and review_status = 'pending' and reviewed_by is null
    and exists (select 1 from public.releases r where r.id = release_id and private.owns_artist(r.artist_id)
                and r.status in ('draft', 'published')));
alter policy "rights_evidence: artist adds to own pending record" on public.rights_evidence
  with check (
    added_by = auth.uid() and exists (
      select 1 from public.rights_records rr join public.releases r on r.id = rr.release_id
      where rr.id = rights_record_id and private.owns_artist(r.artist_id) and r.status in ('draft', 'published')
        and rr.review_status = 'pending'
        and storage_path like 'evidence/' || r.artist_id::text || '/' || r.id::text || '/%'));
