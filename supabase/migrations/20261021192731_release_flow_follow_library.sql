-- 0007: release wizard fields, credits, audio processing results, follows, muted artists, avatars.

alter table public.releases
  add column language text check (language is null or char_length(language) <= 40),
  add column genre_id uuid references public.genres(id),
  add column updated_at timestamptz not null default now();
revoke update on public.releases from authenticated;
grant update (title, type, cover_path, status, language, genre_id) on public.releases to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger releases_touch before update on public.releases for each row execute function public.touch_updated_at();

alter table public.tracks
  add column explicit boolean not null default false,
  add column processing_status text not null default 'pending' check (processing_status in ('pending','processing','ready','failed')),
  add column audio_low_path text,
  add column audio_std_path text,
  add constraint tracks_low_path_own_folder check (audio_low_path is null or audio_low_path like 'audio/' || artist_id::text || '/' || id::text || '/%'),
  add constraint tracks_std_path_own_folder check (audio_std_path is null or audio_std_path like 'audio/' || artist_id::text || '/' || id::text || '/%');

revoke update on public.tracks from authenticated;
grant update (title, track_number, audio_path, duration_ms, genre_id, secondary_genre_id, explicit) on public.tracks to authenticated;

create or replace function public.reset_track_processing() returns trigger language plpgsql set search_path = public as $$
begin
  if new.audio_path is distinct from old.audio_path then
    new.processing_status := 'pending';
    new.audio_low_path := null;
    new.audio_std_path := null;
  end if;
  return new;
end $$;
create trigger tracks_reset_processing before update on public.tracks for each row execute function public.reset_track_processing();

create or replace function public.set_track_audio_variants(p_track uuid, p_status text, p_low text, p_std text, p_duration_ms int)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tracks;
begin
  select * into t from public.tracks where id = p_track;
  if not found then raise exception 'Track not found'; end if;
  if not (public.owns_artist(t.artist_id) or public.is_admin()) then raise exception 'Not allowed'; end if;
  if p_status not in ('processing','ready','failed') then raise exception 'Bad status'; end if;
  update public.tracks set
    processing_status = p_status,
    audio_low_path = coalesce(p_low, audio_low_path),
    audio_std_path = coalesce(p_std, audio_std_path),
    duration_ms = coalesce(p_duration_ms, duration_ms)
  where id = p_track;
end $$;
revoke execute on function public.set_track_audio_variants(uuid, text, text, text, int) from public, anon;
grant execute on function public.set_track_audio_variants(uuid, text, text, text, int) to authenticated;

create table public.track_credits (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  role text not null check (role in ('featured','writer','producer','composer','mixing','mastering','other')),
  artist_id uuid references public.artists(id) on delete set null,
  created_at timestamptz not null default now()
);
create index track_credits_track_idx on public.track_credits(track_id);
alter table public.track_credits enable row level security;
create policy "credits: read if track visible" on public.track_credits for select to anon, authenticated
  using (exists (select 1 from public.tracks t join public.releases r on r.id = t.release_id
                 where t.id = track_id and (r.status = 'published' or public.owns_artist(r.artist_id) or public.is_admin())));
create policy "credits: artist manages own" on public.track_credits for all to authenticated
  using (exists (select 1 from public.tracks t where t.id = track_id and public.owns_artist(t.artist_id)))
  with check (exists (select 1 from public.tracks t where t.id = track_id and public.owns_artist(t.artist_id)));
grant select on public.track_credits to anon, authenticated;
grant insert, update, delete on public.track_credits to authenticated;

create table public.artist_follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);
alter table public.artist_follows enable row level security;
create policy "follows: manage own" on public.artist_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.artist_follows to authenticated;

create table public.artist_blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);
alter table public.artist_blocks enable row level security;
create policy "blocks: manage own" on public.artist_blocks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.artist_blocks to authenticated;

create or replace function public.artist_follower_count(a uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.artist_follows where artist_id = a;
$$;
revoke execute on function public.artist_follower_count(uuid) from public;
grant execute on function public.artist_follower_count(uuid) to anon, authenticated;

alter table public.profiles
  add constraint profiles_avatar_own_folder check (avatar_url is null or avatar_url like 'avatars/' || id::text || '/%') not valid;
