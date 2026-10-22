-- =====================================================================
-- Helpers, invariant triggers, audit, and narrow privileged RPCs.
-- Business invariants live HERE (database level), not only in the UI.
-- =====================================================================

-- ---------- identity / role helpers (SECURITY DEFINER, no RLS recursion) ----
create function private.has_role(p_user uuid, p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role = p_role);
$$;

create function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.has_role(auth.uid(), 'admin'), false);
$$;

create function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.has_role(auth.uid(), 'admin') or private.has_role(auth.uid(), 'moderator'), false);
$$;

create function private.is_artist_member(p_artist uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.artist_members m where m.artist_id = p_artist and m.user_id = auth.uid());
$$;

create function private.artist_is_verified(p_artist uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.artists a where a.id = p_artist and a.verification = 'verified');
$$;

create function private.release_is_public(p_release uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.releases r join public.artists a on a.id = r.artist_id
    where r.id = p_release and r.status = 'published' and a.verification = 'verified');
$$;

create function private.track_is_public(p_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tracks t
    where t.id = p_track and t.status = 'published' and private.release_is_public(t.release_id));
$$;

create function private.track_artist(p_track uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.artist_id from public.tracks t where t.id = p_track;
$$;

create function private.track_member_can_edit(p_track uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tracks t
    where t.id = p_track
      and t.status in ('draft', 'changes_requested')
      and private.is_artist_member(t.artist_id));
$$;

create function private.rights_record_artist(p_record uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.artist_id from public.rights_records rr join public.tracks t on t.id = rr.track_id
  where rr.id = p_record;
$$;

create function private.rights_record_open(p_record uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rights_records rr
    where rr.id = p_record and rr.review_status in ('pending', 'changes_requested'));
$$;

-- Trusted backend = Supabase service role / DB owner. SECURITY INVOKER on purpose:
-- it must see the *calling* role, not the function owner.
create function private.is_trusted_backend()
returns boolean language sql stable as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin');
$$;

-- Valid approved rights for a track today; p_country NULL means "ignore territory".
create function private.track_rights_ok(p_track uuid, p_country text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rights_records rr
    where rr.track_id = p_track
      and rr.review_status = 'approved'
      and rr.term_start <= current_date
      and (rr.term_end is null or rr.term_end >= current_date)
      and (p_country is null
           or 'WW' = any (rr.territories)
           or upper(p_country) = any (rr.territories)));
$$;

-- ---------- audit writer + append-only guard ---------------------------------
create function private.write_audit(
  p_action text, p_target_type text, p_target_id text,
  p_before jsonb default null, p_after jsonb default null, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_kind  text;
begin
  v_kind := case
    when v_actor is null then 'system'
    when private.has_role(v_actor, 'admin') then 'admin'
    when private.has_role(v_actor, 'moderator') then 'moderator'
    else 'user' end;
  insert into public.audit_logs (actor_id, actor_kind, action, target_type, target_id,
                                 before_state, after_state, metadata)
  values (v_actor, v_kind, p_action, p_target_type, p_target_id, p_before, p_after,
          coalesce(p_meta, '{}'::jsonb));
end;
$$;

create function private.audit_logs_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;
create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.audit_logs_append_only();
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.audit_logs_append_only();

-- ---------- generic updated_at ------------------------------------------------
create function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger artists_touch before update on public.artists
  for each row execute function private.touch_updated_at();
create trigger releases_touch before update on public.releases
  for each row execute function private.touch_updated_at();
create trigger tracks_touch before update on public.tracks
  for each row execute function private.touch_updated_at();
create trigger rights_records_touch before update on public.rights_records
  for each row execute function private.touch_updated_at();
create trigger moderation_cases_touch before update on public.moderation_cases
  for each row execute function private.touch_updated_at();

-- ---------- new auth user -> profile + listener role ---------------------------
create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  v_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                          nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                          'Listener'), 80);
  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.user_roles (user_id, role) values (new.id, 'listener');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- role changes are always audited -------------------------------------
create function private.audit_user_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('role.granted', 'user', new.user_id::text, null,
      jsonb_build_object('role', new.role), jsonb_build_object('granted_by', new.granted_by));
    return new;
  else
    perform private.write_audit('role.revoked', 'user', old.user_id::text,
      jsonb_build_object('role', old.role), null, '{}'::jsonb);
    return old;
  end if;
end;
$$;
create trigger user_roles_audit
  after insert or delete on public.user_roles
  for each row execute function private.audit_user_roles();

-- ---------- artists: only staff may change verification ---------------------------
create function private.guard_artist_update()
returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.created_by is distinct from old.created_by then
    raise exception 'immutable artist columns' using errcode = '42501';
  end if;
  if new.verification is distinct from old.verification then
    if not (private.is_trusted_backend() or private.is_staff()) then
      -- members may only REQUEST verification
      if not (new.verification = 'pending' and old.verification in ('unverified', 'rejected')) then
        raise exception 'only staff may change artist verification' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger artists_guard before update on public.artists
  for each row execute function private.guard_artist_update();

create function private.audit_artist_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification is distinct from old.verification then
    perform private.write_audit('artist.verification_changed', 'artist', new.id::text,
      jsonb_build_object('verification', old.verification),
      jsonb_build_object('verification', new.verification), '{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger artists_audit after update on public.artists
  for each row execute function private.audit_artist_verification();

-- ---------- releases/tracks: publication state machine -----------------------------
-- Members: draft|changes_requested -> in_review only.
-- Staff/backend: moderation transitions; publish requires approved, in-term rights.
create function private.enforce_publication_rules()
returns trigger language plpgsql as $$
declare
  v_privileged boolean := private.is_trusted_backend() or private.is_staff();
  v_ok boolean := false;
begin
  if new.id <> old.id or new.artist_id <> old.artist_id then
    raise exception 'immutable ownership columns' using errcode = '42501';
  end if;
  -- to_jsonb(): this function is shared with `releases`, which has no release_id column,
  -- and PL/pgSQL would fail to resolve new.release_id there even behind a table-name guard.
  if tg_table_name = 'tracks'
     and (to_jsonb(new) ->> 'release_id') is distinct from (to_jsonb(old) ->> 'release_id') then
    raise exception 'tracks cannot move between releases' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not v_privileged then
      v_ok := new.status = 'in_review' and old.status in ('draft', 'changes_requested');
    else
      v_ok := ((old.status, new.status) in (
        ('in_review', 'approved'), ('in_review', 'changes_requested'), ('in_review', 'rejected'),
        ('approved', 'published'), ('approved', 'changes_requested'), ('approved', 'withdrawn'),
        ('published', 'withdrawn'), ('withdrawn', 'published'), ('withdrawn', 'rejected'),
        ('changes_requested', 'rejected'), ('changes_requested', 'in_review')));
      -- pipeline-only transitions (trusted backend, never an end user)
      if not v_ok and private.is_trusted_backend() then
        v_ok := ((old.status, new.status) in (('draft', 'processing'), ('processing', 'draft')));
      end if;
    end if;
    if not v_ok then
      raise exception 'illegal status transition % -> % for %', old.status, new.status, tg_table_name
        using errcode = '42501';
    end if;
    if new.status = 'published' then
      if tg_table_name = 'tracks' and not private.track_rights_ok(new.id, null) then
        raise exception 'cannot publish track without approved, in-term rights' using errcode = '23514';
      end if;
      new.published_at := now();
    end if;
  end if;

  if new.published_at is distinct from old.published_at and new.status = old.status
     and not private.is_trusted_backend() then
    raise exception 'published_at is system-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger releases_publication before update on public.releases
  for each row execute function private.enforce_publication_rules();
create trigger tracks_publication before update on public.tracks
  for each row execute function private.enforce_publication_rules();

-- A member cannot create a row that is already published/approved.
create function private.enforce_publication_insert()
returns trigger language plpgsql as $$
begin
  if new.status <> 'draft' and not private.is_trusted_backend() then
    raise exception 'new rows must start as draft' using errcode = '42501';
  end if;
  if new.published_at is not null and not private.is_trusted_backend() then
    raise exception 'published_at is system-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger releases_insert_guard before insert on public.releases
  for each row execute function private.enforce_publication_insert();
create trigger tracks_insert_guard before insert on public.tracks
  for each row execute function private.enforce_publication_insert();

create function private.audit_publication_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.write_audit(tg_table_name || '.status_changed', rtrim(tg_table_name, 's'),
      new.id::text, jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status), '{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger releases_audit after update on public.releases
  for each row execute function private.audit_publication_status();
create trigger tracks_audit after update on public.tracks
  for each row execute function private.audit_publication_status();

-- ---------- rights: members cannot touch review fields -------------------------------
create function private.guard_rights_update()
returns trigger language plpgsql as $$
declare
  v_privileged boolean := private.is_trusted_backend() or private.is_staff();
begin
  if new.id <> old.id or new.track_id <> old.track_id or new.declared_by <> old.declared_by then
    raise exception 'immutable rights columns' using errcode = '42501';
  end if;
  if not v_privileged then
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.review_notes is distinct from old.review_notes then
      raise exception 'only staff may set review fields' using errcode = '42501';
    end if;
    if new.review_status is distinct from old.review_status
       and not (old.review_status = 'changes_requested' and new.review_status = 'pending') then
      raise exception 'only staff may decide rights' using errcode = '42501';
    end if;
  elsif new.review_status is distinct from old.review_status then
    -- review attribution is forced, never trusted from the client
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger rights_records_guard before update on public.rights_records
  for each row execute function private.guard_rights_update();

create function private.guard_rights_insert()
returns trigger language plpgsql as $$
begin
  if not private.is_trusted_backend() then
    if new.review_status <> 'pending' or new.reviewed_by is not null
       or new.reviewed_at is not null or new.review_notes is not null then
      raise exception 'new rights records must be pending and unreviewed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger rights_records_insert_guard before insert on public.rights_records
  for each row execute function private.guard_rights_insert();

create function private.audit_rights_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('rights.declared', 'rights_record', new.id::text, null,
      jsonb_build_object('track_id', new.track_id, 'territories', new.territories), '{}'::jsonb);
  elsif new.review_status is distinct from old.review_status then
    perform private.write_audit('rights.decision', 'rights_record', new.id::text,
      jsonb_build_object('review_status', old.review_status),
      jsonb_build_object('review_status', new.review_status),
      jsonb_build_object('track_id', new.track_id));
  end if;
  return new;
end;
$$;
create trigger rights_records_audit after insert or update on public.rights_records
  for each row execute function private.audit_rights_decision();

-- ---------- moderation cases: audited ----------------------------------------------------
create function private.audit_moderation_case()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('moderation_case.opened', 'moderation_case', new.id::text, null,
      jsonb_build_object('kind', new.kind, 'track_id', new.track_id), '{}'::jsonb);
  elsif new.status is distinct from old.status then
    perform private.write_audit('moderation_case.status_changed', 'moderation_case', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), '{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger moderation_cases_audit after insert or update on public.moderation_cases
  for each row execute function private.audit_moderation_case();

-- =====================================================================
-- Public RPCs (the ONLY write path for roles, artist creation, takedown)
-- =====================================================================

create function public.create_artist(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.artists (name, slug, created_by) values (trim(p_name), lower(trim(p_slug)), v_uid)
    returning id into v_id;
  insert into public.artist_members (artist_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.user_roles (user_id, role, granted_by) values (v_uid, 'artist', v_uid)
    on conflict do nothing;
  perform private.write_audit('artist.created', 'artist', v_id::text, null,
    jsonb_build_object('name', trim(p_name), 'slug', lower(trim(p_slug))), '{}'::jsonb);
  return v_id;
end;
$$;

create function public.grant_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid())
    on conflict do nothing;
end;
$$;

create function public.revoke_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_role = 'admin' and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'cannot remove the last admin' using errcode = '23514';
  end if;
  delete from public.user_roles where user_id = p_user and role = p_role;
end;
$$;

-- Takedown: withdraw a live track, open a case, leave an explicit audit record.
create function public.takedown_track(p_track uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_artist uuid;
  v_release uuid;
  v_status public.publication_status;
  v_case uuid;
begin
  if not private.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = '23514';
  end if;
  select artist_id, release_id, status into v_artist, v_release, v_status
    from public.tracks where id = p_track;
  if v_artist is null then
    raise exception 'track not found' using errcode = 'P0002';
  end if;
  if v_status not in ('published', 'approved') then
    -- refuse instead of silently creating duplicate cases/audit entries
    raise exception 'track is not live (status: %)', v_status using errcode = '23514';
  end if;
  -- also runs the publication state machine
  update public.tracks set status = 'withdrawn' where id = p_track;
  insert into public.moderation_cases (kind, status, artist_id, release_id, track_id, opened_by, summary)
    values ('takedown', 'open', v_artist, v_release, p_track, auth.uid(), trim(p_reason))
    returning id into v_case;
  perform private.write_audit('track.takedown', 'track', p_track::text, null, null,
    jsonb_build_object('reason', trim(p_reason), 'case_id', v_case));
  return v_case;
end;
$$;

-- Server-side only: resolves the object to stream IF every gate passes.
create function public.get_playback_target(p_track uuid, p_country text, p_max_bitrate int default null)
returns table (asset_id uuid, storage_bucket text, storage_key text, codec text,
               bitrate_kbps int, duration_ms int)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_bucket, a.storage_key, a.codec, a.bitrate_kbps, a.duration_ms
  from public.tracks t
  join public.audio_assets a
    on a.track_id = t.id and a.kind = 'rendition' and a.status = 'ready'
  where t.id = p_track
    and t.status = 'published'
    and private.release_is_public(t.release_id)
    -- NULL/blank country = unknown location: must NOT bypass territory limits.
    -- '??' can never appear in a rights record (CHECK requires [A-Z]{2} or WW),
    -- so an unknown country can only ever match worldwide ('WW') rights.
    and private.track_rights_ok(t.id, coalesce(nullif(trim(p_country), ''), '??'))
    and (p_max_bitrate is null or a.bitrate_kbps <= p_max_bitrate)
  order by a.bitrate_kbps desc nulls last
  limit 1;
$$;
