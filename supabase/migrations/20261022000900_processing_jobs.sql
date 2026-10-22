-- Phase 3: audio processing jobs. Additive. Nothing here is reachable by clients except READ of their own jobs.
--  * A job is created by the trusted backend (service role) when an original has been uploaded and registered.
--  * The worker claims jobs with FOR UPDATE SKIP LOCKED + a lease, so two workers never process the same job and a
--    crashed worker's job is picked up again (up to max_attempts).
--  * A job is only allowed to publish its result if the track still points at the original it was created for
--    (a replaced upload turns the old job into 'superseded').

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  original_key text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  -- error_message is written for the ARTIST to read: no paths, stack traces or tool output.
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  error_message text check (error_message is null or char_length(error_message) <= 300),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index processing_jobs_one_active_per_track on public.processing_jobs (track_id) where status in ('queued','running');
create index processing_jobs_claim_idx on public.processing_jobs (status, created_at);
create index processing_jobs_track_idx on public.processing_jobs (track_id, created_at desc);

alter table public.processing_jobs enable row level security;
revoke all on public.processing_jobs from anon, authenticated;
grant select (id, track_id, status, attempts, max_attempts, error_code, error_message, created_at, started_at, finished_at)
  on public.processing_jobs to authenticated;
create policy "processing_jobs: read own or admin" on public.processing_jobs for select to authenticated
  using (private.is_admin() or exists (select 1 from public.tracks t where t.id = track_id and private.owns_artist(t.artist_id)));

-- Called by the upload route after the original is stored and registered on the track.
-- Resets the track to 'pending', clears stale renditions (returned so the caller can delete the objects) and queues ONE job.
create or replace function public.enqueue_processing_job(p_track uuid)
returns table (job_id uuid, stale_paths text[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare t public.tracks; stale text[]; jid uuid;
begin
  if coalesce(auth.role(), '') = 'authenticated' or coalesce(auth.role(), '') = 'anon' then raise exception 'Not allowed'; end if;
  select * into t from public.tracks where id = p_track for update;
  if not found then raise exception 'Track not found'; end if;
  if t.audio_path is null then raise exception 'Track has no uploaded original'; end if;

  stale := array_remove(array[t.audio_low_path, t.audio_std_path], null);
  update public.tracks set processing_status = 'pending', audio_low_path = null, audio_std_path = null where id = p_track;
  -- A newer upload replaces any job still waiting or running for this track.
  update public.processing_jobs set status = 'failed', error_code = 'superseded', error_message = 'Replaced by a newer upload.', finished_at = now()
    where track_id = p_track and status in ('queued','running');
  insert into public.processing_jobs (track_id, original_key) values (p_track, t.audio_path) returning id into jid;
  return query select jid, stale;
end $$;

-- Worker entry point. Returns zero rows when there is nothing to do.
create or replace function public.claim_processing_job(p_lease_seconds int default 600)
returns table (job_id uuid, track_id uuid, original_key text, attempts int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare j public.processing_jobs;
begin
  if coalesce(auth.role(), '') in ('authenticated','anon') then raise exception 'Not allowed'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Bad lease'; end if;

  -- Expired leases that have used all their attempts are failed rather than retried forever.
  update public.processing_jobs set status = 'failed', error_code = 'timeout',
         error_message = 'Processing took too long and was stopped.', finished_at = now()
   where status = 'running' and locked_until < now() and attempts >= max_attempts;
  update public.tracks set processing_status = 'failed'
   where id in (select pj.track_id from public.processing_jobs pj where pj.status = 'failed' and pj.error_code = 'timeout' and pj.finished_at >= now() - interval '1 minute')
     and processing_status = 'processing';

  select * into j from public.processing_jobs pj
   where pj.status = 'queued' or (pj.status = 'running' and pj.locked_until < now() and pj.attempts < pj.max_attempts)
   order by pj.created_at
   for update skip locked limit 1;
  if not found then return; end if;

  update public.processing_jobs set status = 'running', attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds), started_at = coalesce(j.started_at, now())
   where id = j.id;
  update public.tracks set processing_status = 'processing' where id = j.track_id;
  return query select j.id, j.track_id, j.original_key, j.attempts + 1;
end $$;

-- Worker finished. Publishes renditions only if the track still points at the original this job was made for.
create or replace function public.complete_processing_job(p_job uuid, p_low text, p_std text, p_duration_ms int)
returns text
language plpgsql security definer set search_path = '' as $$
declare j public.processing_jobs; t public.tracks;
begin
  if coalesce(auth.role(), '') in ('authenticated','anon') then raise exception 'Not allowed'; end if;
  select * into j from public.processing_jobs where id = p_job for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status <> 'running' then return 'not_running'; end if;
  select * into t from public.tracks where id = j.track_id for update;
  if not found or t.audio_path is distinct from j.original_key then
    update public.processing_jobs set status = 'failed', error_code = 'superseded', error_message = 'Replaced by a newer upload.', finished_at = now() where id = p_job;
    return 'superseded';
  end if;
  perform public.set_track_audio_variants(j.track_id, 'ready', p_low, p_std, p_duration_ms);
  update public.processing_jobs set status = 'succeeded', error_code = null, error_message = null, finished_at = now(), locked_until = null where id = p_job;
  return 'succeeded';
end $$;

-- Worker could not finish. p_retry = true re-queues while attempts remain; otherwise the job and track are failed.
create or replace function public.fail_processing_job(p_job uuid, p_code text, p_message text, p_retry boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare j public.processing_jobs;
begin
  if coalesce(auth.role(), '') in ('authenticated','anon') then raise exception 'Not allowed'; end if;
  select * into j from public.processing_jobs where id = p_job for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status <> 'running' then return 'not_running'; end if;
  if p_retry and j.attempts < j.max_attempts then
    update public.processing_jobs set status = 'queued', locked_until = null where id = p_job;
    update public.tracks set processing_status = 'pending' where id = j.track_id and audio_path = j.original_key;
    return 'requeued';
  end if;
  update public.processing_jobs set status = 'failed', error_code = p_code, error_message = left(p_message, 300), finished_at = now(), locked_until = null where id = p_job;
  update public.tracks set processing_status = 'failed' where id = j.track_id and audio_path = j.original_key;
  return 'failed';
end $$;

revoke execute on function public.enqueue_processing_job(uuid) from public, anon, authenticated;
revoke execute on function public.claim_processing_job(int) from public, anon, authenticated;
revoke execute on function public.complete_processing_job(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.fail_processing_job(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_processing_job(uuid) to service_role;
grant execute on function public.claim_processing_job(int) to service_role;
grant execute on function public.complete_processing_job(uuid, text, text, int) to service_role;
grant execute on function public.fail_processing_job(uuid, text, text, boolean) to service_role;
