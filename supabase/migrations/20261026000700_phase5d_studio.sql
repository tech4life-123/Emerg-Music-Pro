-- Phase 5D step 2 of 2: studio. Release date, artist-initiated withdrawal, cover-art and rights-evidence storage,
-- and analytics that hide small unique-listener counts. Everything is additive; nothing existing is dropped.

-- ---------- release date ----------
alter table public.releases add column release_date date;
grant update (release_date) on public.releases to authenticated;

-- ---------- withdrawal: published -> withdrawn -> (reopen) draft -> in_review ----------
-- Only these two functions may make the transition; the guard trigger checks a transaction-local flag they set, so a direct
-- UPDATE of status by an artist is still refused and every withdrawal is audited.
create or replace function public.guard_release_status() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if new.status is distinct from old.status and not private.is_admin() then
    if old.status::text = 'published' and new.status::text = 'withdrawn' and current_setting('app.release_transition', true) = new.id::text then
      null;  -- set only by withdraw_release()
    elsif old.status::text = 'withdrawn' and new.status::text = 'draft' and current_setting('app.release_transition', true) = new.id::text then
      null;  -- set only by reopen_withdrawn_release()
    else
      if not (old.status = 'draft' and new.status = 'in_review') then
        raise exception 'Only an admin can set status to %', new.status;
      end if;
      if not exists (select 1 from public.rights_declarations where release_id = new.id) then
        raise exception 'A rights declaration is required before submitting a release';
      end if;
      if not exists (select 1 from public.rights_records where release_id = new.id and review_status in ('pending','approved')) then
        raise exception 'Add a rights record (who owns the rights, where, and for how long) before submitting';
      end if;
      if not exists (select 1 from public.tracks where release_id = new.id and removed_at is null) then
        raise exception 'Add at least one track before submitting';
      end if;
      if exists (select 1 from public.tracks where release_id = new.id and removed_at is null and processing_status <> 'ready') then
        raise exception 'Every track needs processed audio before submitting. Wait for processing to finish, or fix failed tracks';
      end if;
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

create or replace function public.withdraw_release(p_release uuid) returns void
language plpgsql security definer set search_path = 'public' as $$
declare r public.releases;
begin
  select * into r from public.releases where id = p_release for update;
  if not found or not private.owns_artist(r.artist_id) then raise exception 'Release not found'; end if;
  if r.status::text <> 'published' then raise exception 'Only a published release can be withdrawn'; end if;
  perform set_config('app.release_transition', p_release::text, true);
  update public.releases set status = 'withdrawn' where id = p_release;
  perform public.write_audit('withdraw_release', 'release', p_release::text, null);
end $$;

create or replace function public.reopen_withdrawn_release(p_release uuid) returns void
language plpgsql security definer set search_path = 'public' as $$
declare r public.releases;
begin
  select * into r from public.releases where id = p_release for update;
  if not found or not private.owns_artist(r.artist_id) then raise exception 'Release not found'; end if;
  if r.status::text <> 'withdrawn' then raise exception 'Only a withdrawn release can be reopened'; end if;
  perform set_config('app.release_transition', p_release::text, true);
  update public.releases set status = 'draft' where id = p_release;
  perform public.write_audit('reopen_release', 'release', p_release::text, null);
end $$;
revoke all on function public.withdraw_release(uuid), public.reopen_withdrawn_release(uuid) from public, anon;
grant execute on function public.withdraw_release(uuid), public.reopen_withdrawn_release(uuid) to authenticated;

-- ---------- cover art: public bucket, 1 MB, own artist folder (path rule covers/<artist>/<release>/* already exists on releases.cover_path) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "covers bucket: add to own artist folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and private.owns_artist_folder(name));
create policy "covers bucket: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and private.owns_artist_folder(name)) with check (bucket_id = 'covers' and private.owns_artist_folder(name));
create policy "covers bucket: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and private.owns_artist_folder(name));
create policy "covers bucket: list own" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and private.owns_artist_folder(name));

-- ---------- rights evidence: PRIVATE bucket, 5 MB, pdf/jpeg/png; owner adds and reads, admins read; nobody edits or deletes ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "evidence bucket: add to own artist folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and private.owns_artist_folder(name));
create policy "evidence bucket: owner or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (private.owns_artist_folder(name) or private.is_admin()));

-- ---------- analytics: unique listeners below 5 are hidden (decision C); exact counts are no longer reachable by artists ----------
create or replace function public.artist_play_summary(p_artist uuid, p_from date, p_to date)
returns table(day date, track_id uuid, plays bigint, unique_listeners bigint, listened_ms bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.owns_artist(p_artist) or private.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'Invalid date range'; end if;
  return query
    select (e.created_at at time zone 'UTC')::date, e.track_id, count(*),
           case when count(distinct e.user_id) >= 5 then count(distinct e.user_id) end,   -- null = "Fewer than 5"
           coalesce(sum(e.listened_ms), 0)::bigint
    from public.play_events e join public.tracks t on t.id = e.track_id
    where t.artist_id = p_artist
      and e.created_at >= (p_from::timestamp at time zone 'UTC')
      and e.created_at <  ((p_to + 1)::timestamp at time zone 'UTC')
    group by 1, 2 order by 1, 2;
end $$;

create or replace function public.artist_listener_totals(p_artist uuid, p_from date, p_to date)
returns table(plays bigint, unique_listeners bigint, listened_ms bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.owns_artist(p_artist) or private.is_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'Invalid date range'; end if;
  return query
    select count(*), case when count(distinct e.user_id) >= 5 then count(distinct e.user_id) end, coalesce(sum(e.listened_ms), 0)::bigint
    from public.play_events e join public.tracks t on t.id = e.track_id
    where t.artist_id = p_artist
      and e.created_at >= (p_from::timestamp at time zone 'UTC')
      and e.created_at <  ((p_to + 1)::timestamp at time zone 'UTC');
end $$;
revoke all on function public.artist_play_summary(uuid, date, date), public.artist_listener_totals(uuid, date, date) from public, anon;
grant execute on function public.artist_play_summary(uuid, date, date), public.artist_listener_totals(uuid, date, date) to authenticated;
-- The old function returned exact unique counts to artists: no longer callable by clients.
revoke execute on function public.artist_play_stats(uuid, date, date) from authenticated;

-- Revert (safe before any covers/evidence exist):
--   grant execute on function public.artist_play_stats(uuid, date, date) to authenticated;
--   drop function public.artist_play_summary(uuid, date, date), public.artist_listener_totals(uuid, date, date);
--   drop policy on storage.objects for the 6 covers/evidence policies above; delete from storage.buckets where id in ('covers','evidence');
--   drop function public.withdraw_release(uuid), public.reopen_withdrawn_release(uuid);
--   restore guard_release_status() from 20261022001000 (without the two transitions); alter table public.releases drop column release_date;
