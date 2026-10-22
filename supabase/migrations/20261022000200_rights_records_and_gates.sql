-- Phase 1 hardening (2/3): rights records with territory + term, evidence REFERENCES, a publish gate and a
-- server-side playback gate. Additive. Existing published releases are NOT changed, but until a rights record
-- is approved for them the playback gate will (correctly) refuse to authorize their audio.

create schema if not exists private;
revoke all on schema private from public;

create table public.rights_records (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases(id) on delete cascade,
  declared_by uuid not null default auth.uid() references public.profiles(id),
  basis text not null check (basis in ('owner','licensed','authorized_distributor')),
  rights_holder_name text not null check (char_length(rights_holder_name) between 1 and 200),
  -- ISO-3166 alpha-2 codes or 'WW' (worldwide)
  territories text[] not null check (cardinality(territories) >= 1
    and array_to_string(territories, ',') ~ '^(WW|[A-Z]{2})(,(WW|[A-Z]{2}))*$'),
  term_start date not null,
  term_end date,
  check (term_end is null or term_end >= term_start),
  declaration_id uuid references public.rights_declarations(id) on delete set null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','changes_requested','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index rights_records_release_idx on public.rights_records (release_id);
alter table public.rights_records enable row level security;
revoke all on public.rights_records from anon, authenticated;
grant select on public.rights_records to authenticated;
grant insert (release_id, declared_by, basis, rights_holder_name, territories, term_start, term_end, declaration_id)
  on public.rights_records to authenticated;

create policy "rights_records: read own or admin" on public.rights_records for select to authenticated
  using (public.is_admin() or exists (select 1 from public.releases r where r.id = release_id and public.owns_artist(r.artist_id)));
create policy "rights_records: artist declares on own draft" on public.rights_records for insert to authenticated
  with check (declared_by = auth.uid() and review_status = 'pending' and reviewed_by is null
    and exists (select 1 from public.releases r where r.id = release_id and public.owns_artist(r.artist_id) and r.status = 'draft'));

-- Evidence is a REFERENCE to a private file (contract, licence, proof). The file itself never lives in this table.
create table public.rights_evidence (
  id uuid primary key default gen_random_uuid(),
  rights_record_id uuid not null references public.rights_records(id) on delete cascade,
  kind text not null check (kind in ('contract','license','ownership_proof','identity','other')),
  storage_path text not null check (storage_path !~ '(^/|\.\.)' and char_length(storage_path) <= 500),
  description text check (description is null or char_length(description) <= 500),
  added_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index rights_evidence_record_idx on public.rights_evidence (rights_record_id);
alter table public.rights_evidence enable row level security;
revoke all on public.rights_evidence from anon, authenticated;
grant select on public.rights_evidence to authenticated;
grant insert (rights_record_id, kind, storage_path, description, added_by) on public.rights_evidence to authenticated;

create policy "rights_evidence: read own or admin" on public.rights_evidence for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.rights_records rr join public.releases r on r.id = rr.release_id
    where rr.id = rights_record_id and public.owns_artist(r.artist_id)));
create policy "rights_evidence: artist adds to own pending record" on public.rights_evidence for insert to authenticated
  with check (added_by = auth.uid() and exists (
    select 1 from public.rights_records rr join public.releases r on r.id = rr.release_id
    where rr.id = rights_record_id and public.owns_artist(r.artist_id) and r.status = 'draft'
      and rr.review_status = 'pending'
      and storage_path like 'evidence/' || r.artist_id::text || '/' || r.id::text || '/%'));

-- Admin review of a rights record (audited). There is no direct UPDATE grant for clients.
create or replace function public.review_rights_record(p_record uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status not in ('approved','changes_requested','rejected') then raise exception 'Bad status'; end if;
  if p_status <> 'approved' and coalesce(trim(p_note), '') = '' then raise exception 'A note is required'; end if;
  update public.rights_records
     set review_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_record;
  if not found then raise exception 'Rights record not found'; end if;
  perform public.write_audit('review_rights', 'rights_record', p_record::text, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
revoke execute on function public.review_rights_record(uuid, text, text) from public, anon;
grant execute on function public.review_rights_record(uuid, text, text) to authenticated;

-- Internal (private schema: not reachable through the API). p_country NULL = "any territory" (used at publish time).
create or replace function private.release_rights_ok(p_release uuid, p_country text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rights_records rr
    where rr.release_id = p_release
      and rr.review_status = 'approved'
      and rr.term_start <= current_date
      and (rr.term_end is null or rr.term_end >= current_date)
      and (p_country is null or 'WW' = any(rr.territories) or upper(p_country) = any(rr.territories)));
$$;
revoke all on function private.release_rights_ok(uuid, text) from public;

-- Publish gate: a release can only go live with an approved, in-term rights record.
create or replace function public.guard_release_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    if not (old.status = 'draft' and new.status = 'in_review') then
      raise exception 'Only an admin can set status to %', new.status;
    end if;
    if not exists (select 1 from public.rights_declarations where release_id = new.id) then
      raise exception 'A rights declaration is required before submitting a release';
    end if;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    if not private.release_rights_ok(new.id, null) then
      raise exception 'Cannot publish: the release needs an approved, in-term rights record';
    end if;
    new.published_at := now();
  end if;
  return new;
end $$;

-- Playback gate: ONE place that decides whether audio may be authorized right now. Service role only.
-- Unknown country ('??') can only ever match worldwide ('WW') rights.
create or replace function public.get_playback_target(p_track uuid, p_country text, p_low boolean default false)
returns table (track_id uuid, variant text, storage_key text, duration_ms int)
language sql stable security definer set search_path = '' as $$
  select t.id,
         case when (case when p_low then coalesce(t.audio_low_path, t.audio_std_path) else coalesce(t.audio_std_path, t.audio_low_path) end) = t.audio_low_path then 'low' else 'std' end,
         case when p_low then coalesce(t.audio_low_path, t.audio_std_path) else coalesce(t.audio_std_path, t.audio_low_path) end,
         t.duration_ms
  from public.tracks t
  join public.releases r on r.id = t.release_id
  join public.artists a on a.id = r.artist_id
  where t.id = p_track
    and r.status = 'published'
    and a.status = 'approved'
    and t.processing_status = 'ready'
    and coalesce(t.audio_std_path, t.audio_low_path) is not null
    and private.release_rights_ok(r.id, coalesce(nullif(trim(p_country), ''), '??'));
$$;
revoke execute on function public.get_playback_target(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.get_playback_target(uuid, text, boolean) to service_role;
