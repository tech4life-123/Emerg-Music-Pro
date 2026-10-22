-- =====================================================================
-- Privileges + Row Level Security. DEFAULT DENY, then explicit allows.
-- Supabase grants broad default privileges to anon/authenticated on new
-- tables; we revoke all of them and re-grant only what is needed, so RLS
-- is never the *only* line of defence.
-- =====================================================================

-- ---------- 1. strip default privileges ----------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- private helpers must be callable inside policies/triggers
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to anon, authenticated, service_role;
-- ...except the audit writer and trigger functions, which run via triggers/definer code only
revoke execute on function
  private.write_audit(text, text, text, jsonb, jsonb, jsonb),
  private.handle_new_user(),
  private.audit_user_roles(),
  private.audit_artist_verification(),
  private.audit_publication_status(),
  private.audit_rights_decision(),
  private.audit_moderation_case(),
  private.audit_logs_append_only()
  from anon, authenticated;

-- ---------- 2. enable RLS on every table -----------------------------------
-- NOTE: deliberately NOT `force row level security`. The SECURITY DEFINER
-- helpers (owned by the table owner) must be able to read tables to evaluate
-- policies without recursion. Client roles are never the table owner.
alter table public.profiles          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.artists           enable row level security;
alter table public.artist_members    enable row level security;
alter table public.genres            enable row level security;
alter table public.releases          enable row level security;
alter table public.tracks            enable row level security;
alter table public.track_genres      enable row level security;
alter table public.audio_assets      enable row level security;
alter table public.rights_records    enable row level security;
alter table public.rights_evidence   enable row level security;
alter table public.moderation_cases  enable row level security;
alter table public.audit_logs        enable row level security;

-- ---------- 3. table privileges (minimum needed) ---------------------------
grant select on public.profiles         to authenticated;
grant update (display_name, avatar_url, country_code) on public.profiles to authenticated;

grant select on public.user_roles       to authenticated;          -- writes: RPC only
grant select on public.artist_members   to authenticated;          -- writes: RPC only

grant select on public.artists          to anon, authenticated;
grant update (name, bio, avatar_url, banner_url, country_code, verification)
  on public.artists to authenticated;                              -- inserts: create_artist() only

grant select on public.genres           to anon, authenticated;
grant insert, update, delete on public.genres to authenticated;    -- admin-only via policy

grant select on public.releases         to anon, authenticated;
grant insert (artist_id, title, type, description, release_date, artwork_path, status)
  on public.releases to authenticated;
grant update (title, type, description, release_date, artwork_path, status)
  on public.releases to authenticated;
grant delete on public.releases         to authenticated;

grant select on public.tracks           to anon, authenticated;
grant insert (release_id, artist_id, title, track_number, duration_ms, explicit, isrc, language, status)
  on public.tracks to authenticated;
grant update (title, track_number, duration_ms, explicit, isrc, language, status)
  on public.tracks to authenticated;
grant delete on public.tracks           to authenticated;

grant select on public.track_genres     to anon, authenticated;
grant insert, delete on public.track_genres to authenticated;

-- audio_assets: NO grants to anon/authenticated at all (server/service_role only)

grant select on public.rights_records   to authenticated;
grant insert (track_id, declared_by, basis, rights_holder_name, territories, term_start, term_end,
              declaration_text)
  on public.rights_records to authenticated;
grant update (basis, rights_holder_name, territories, term_start, term_end, declaration_text,
              review_status, review_notes)
  on public.rights_records to authenticated;

grant select, insert on public.rights_evidence to authenticated;

grant select, insert, update on public.moderation_cases to authenticated;
grant select on public.audit_logs       to authenticated;           -- appends: triggers/definer only

-- service_role (server only) keeps full table access; it also bypasses RLS.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------- 4. public RPC execute grants -------------------------------------
grant execute on function public.create_artist(text, text)            to authenticated;
grant execute on function public.grant_role(uuid, public.app_role)    to authenticated;
grant execute on function public.revoke_role(uuid, public.app_role)  to authenticated;
grant execute on function public.takedown_track(uuid, text)           to authenticated;
-- playback target resolution: server-side only, never callable from a browser JWT
grant execute on function public.get_playback_target(uuid, text, int) to service_role;

-- ---------- 5. policies ---------------------------------------------------------
-- profiles
create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated using (id = auth.uid() or private.is_staff());
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles (read-only for clients; changes go through grant_role/revoke_role)
create policy user_roles_select_self_or_admin on public.user_roles
  for select to authenticated using (user_id = auth.uid() or private.is_admin());

-- artists
create policy artists_select_public_verified on public.artists
  for select to anon, authenticated using (verification = 'verified');
create policy artists_select_member on public.artists
  for select to authenticated using (private.is_artist_member(id));
create policy artists_select_staff on public.artists
  for select to authenticated using (private.is_staff());
create policy artists_update_member on public.artists
  for update to authenticated
  using (private.is_artist_member(id)) with check (private.is_artist_member(id));
create policy artists_update_staff on public.artists
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

-- artist_members
create policy artist_members_select on public.artist_members
  for select to authenticated
  using (user_id = auth.uid() or private.is_artist_member(artist_id) or private.is_staff());

-- genres (public reference data; admin-managed)
create policy genres_select_all on public.genres
  for select to anon, authenticated using (true);
create policy genres_admin_insert on public.genres
  for insert to authenticated with check (private.is_admin());
create policy genres_admin_update on public.genres
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy genres_admin_delete on public.genres
  for delete to authenticated using (private.is_admin());

-- releases
create policy releases_select_public on public.releases
  for select to anon, authenticated using (private.release_is_public(id));
create policy releases_select_member on public.releases
  for select to authenticated using (private.is_artist_member(artist_id));
create policy releases_select_staff on public.releases
  for select to authenticated using (private.is_staff());
create policy releases_insert_member on public.releases
  for insert to authenticated
  with check (private.is_artist_member(artist_id) and private.artist_is_verified(artist_id)
              and status = 'draft');
create policy releases_update_member on public.releases
  for update to authenticated
  using (private.is_artist_member(artist_id) and status in ('draft', 'changes_requested'))
  with check (private.is_artist_member(artist_id));
create policy releases_update_staff on public.releases
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy releases_delete_member_draft on public.releases
  for delete to authenticated using (private.is_artist_member(artist_id) and status = 'draft');

-- tracks
create policy tracks_select_public on public.tracks
  for select to anon, authenticated using (private.track_is_public(id));
create policy tracks_select_member on public.tracks
  for select to authenticated using (private.is_artist_member(artist_id));
create policy tracks_select_staff on public.tracks
  for select to authenticated using (private.is_staff());
create policy tracks_insert_member on public.tracks
  for insert to authenticated
  with check (private.is_artist_member(artist_id) and private.artist_is_verified(artist_id)
              and status = 'draft');
create policy tracks_update_member on public.tracks
  for update to authenticated
  using (private.is_artist_member(artist_id) and status in ('draft', 'changes_requested'))
  with check (private.is_artist_member(artist_id));
create policy tracks_update_staff on public.tracks
  for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy tracks_delete_member_draft on public.tracks
  for delete to authenticated using (private.is_artist_member(artist_id) and status = 'draft');

-- track_genres
create policy track_genres_select_public on public.track_genres
  for select to anon, authenticated using (private.track_is_public(track_id));
create policy track_genres_select_member_or_staff on public.track_genres
  for select to authenticated
  using (private.is_staff() or private.is_artist_member(private.track_artist(track_id)));
create policy track_genres_insert_member on public.track_genres
  for insert to authenticated with check (private.track_member_can_edit(track_id));
create policy track_genres_delete_member on public.track_genres
  for delete to authenticated using (private.track_member_can_edit(track_id));

-- audio_assets: RLS enabled, deliberately NO policies => no client access at all.

-- rights_records
create policy rights_select_member_or_staff on public.rights_records
  for select to authenticated
  using (private.is_staff() or private.is_artist_member(private.track_artist(track_id)));
create policy rights_insert_member on public.rights_records
  for insert to authenticated
  with check (declared_by = auth.uid()
              and private.is_artist_member(private.track_artist(track_id))
              and review_status = 'pending');
create policy rights_update_member on public.rights_records
  for update to authenticated
  using (private.is_artist_member(private.track_artist(track_id))
         and review_status in ('pending', 'changes_requested'))
  with check (private.is_artist_member(private.track_artist(track_id)));
create policy rights_update_staff on public.rights_records
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

-- rights_evidence
create policy evidence_select_member_or_staff on public.rights_evidence
  for select to authenticated
  using (private.is_staff()
         or private.is_artist_member(private.rights_record_artist(rights_record_id)));
create policy evidence_insert_member on public.rights_evidence
  for insert to authenticated
  with check (uploaded_by = auth.uid()
              and private.is_artist_member(private.rights_record_artist(rights_record_id))
              and private.rights_record_open(rights_record_id));

-- moderation_cases (staff only in Phase 1)
create policy moderation_select_staff on public.moderation_cases
  for select to authenticated using (private.is_staff());
create policy moderation_insert_staff on public.moderation_cases
  for insert to authenticated with check (private.is_staff());
create policy moderation_update_staff on public.moderation_cases
  for update to authenticated using (private.is_staff()) with check (private.is_staff());

-- audit_logs: admins read; nobody writes directly
create policy audit_select_admin on public.audit_logs
  for select to authenticated using (private.is_admin());
