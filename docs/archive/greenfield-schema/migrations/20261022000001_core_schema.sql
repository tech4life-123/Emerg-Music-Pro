-- =====================================================================
-- Emerg Music - Phase 1 core schema
-- Compatible with Supabase (uses auth.users, auth.uid()).
-- All tables live in `public`; policy helper functions live in `private`
-- (not exposed through the Supabase API).
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------- enums ----------------------------------------------------
create type public.app_role as enum ('listener', 'artist', 'moderator', 'admin');
create type public.artist_member_role as enum ('owner', 'manager');
create type public.artist_verification as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.release_type as enum ('single', 'ep', 'album');
create type public.publication_status as enum (
  'draft', 'processing', 'in_review', 'changes_requested',
  'approved', 'published', 'withdrawn', 'rejected'
);
create type public.rights_basis as enum ('owner', 'licensed', 'authorized_distributor');
create type public.rights_review_status as enum ('pending', 'changes_requested', 'approved', 'rejected');
create type public.evidence_kind as enum ('contract', 'license', 'ownership_proof', 'identity', 'other');
create type public.moderation_case_kind as enum ('submission_review', 'takedown', 'abuse_report');
create type public.moderation_case_status as enum ('open', 'in_review', 'resolved', 'dismissed');
create type public.audio_asset_kind as enum ('original', 'rendition');
create type public.audio_asset_status as enum ('quarantined', 'processing', 'ready', 'failed');

-- ---------- pure validation helpers (immutable, used in CHECKs) -------
create function private.valid_territories(p_codes text[])
returns boolean
language sql
immutable
as $$
  select coalesce(
    array_length(p_codes, 1) >= 1
    and (select bool_and(c ~ '^([A-Z]{2}|WW)$') from unnest(p_codes) as c),
    false
  );
$$;

-- ---------- profiles --------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 80),
  avatar_url    text check (avatar_url is null or char_length(avatar_url) <= 500),
  country_code  text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- user_roles -------------------------------------------------
create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_role_idx on public.user_roles (role);

-- ---------- artists ----------------------------------------------------
create table public.artists (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  name          text not null check (char_length(name) between 1 and 120),
  bio           text check (bio is null or char_length(bio) <= 4000),
  avatar_url    text check (avatar_url is null or char_length(avatar_url) <= 500),
  banner_url    text check (banner_url is null or char_length(banner_url) <= 500),
  country_code  text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  verification  public.artist_verification not null default 'unverified',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.artist_members (
  artist_id   uuid not null references public.artists (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.artist_member_role not null default 'owner',
  created_at  timestamptz not null default now(),
  primary key (artist_id, user_id)
);
create index artist_members_user_idx on public.artist_members (user_id);

-- ---------- genres -----------------------------------------------------
create table public.genres (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name  text not null unique check (char_length(name) between 1 and 60)
);

-- ---------- releases / tracks ------------------------------------------
create table public.releases (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references public.artists (id) on delete restrict,
  title         text not null check (char_length(title) between 1 and 200),
  type          public.release_type not null default 'single',
  description   text check (description is null or char_length(description) <= 4000),
  release_date  date,
  artwork_path  text check (artwork_path is null or (artwork_path !~ '(^/|\.\.)' and char_length(artwork_path) <= 500)),
  status        public.publication_status not null default 'draft',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, artist_id)  -- enables the composite FK from tracks
);
create index releases_artist_idx on public.releases (artist_id);
create index releases_status_idx on public.releases (status);

create table public.tracks (
  id            uuid primary key default gen_random_uuid(),
  release_id    uuid not null,
  artist_id     uuid not null,
  title         text not null check (char_length(title) between 1 and 200),
  track_number  int not null check (track_number between 1 and 999),
  duration_ms   int check (duration_ms is null or duration_ms > 0),
  explicit      boolean not null default false,
  isrc          text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{2}[0-9]{5}$'),
  language      text check (language is null or char_length(language) between 2 and 35),
  status        public.publication_status not null default 'draft',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- a track's artist must be the release's artist (prevents cross-artist attachment)
  foreign key (release_id, artist_id) references public.releases (id, artist_id) on delete cascade,
  unique (release_id, track_number)
);
create index tracks_artist_idx on public.tracks (artist_id);
create index tracks_status_idx on public.tracks (status);

create table public.track_genres (
  track_id  uuid not null references public.tracks (id) on delete cascade,
  genre_id  uuid not null references public.genres (id) on delete restrict,
  primary key (track_id, genre_id)
);

-- ---------- audio assets (server-side only; never client readable) ------
create table public.audio_assets (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks (id) on delete cascade,
  kind            public.audio_asset_kind not null,
  status          public.audio_asset_status not null default 'quarantined',
  storage_bucket  text not null check (storage_bucket in ('originals', 'renditions')),
  storage_key     text not null check (storage_key !~ '(^/|\.\.)' and char_length(storage_key) <= 500),
  codec           text,
  bitrate_kbps    int check (bitrate_kbps is null or bitrate_kbps > 0),
  duration_ms     int check (duration_ms is null or duration_ms > 0),
  size_bytes      bigint not null check (size_bytes > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  waveform_peaks  jsonb,
  failure_reason  text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (storage_bucket, storage_key)
);
create index audio_assets_track_idx on public.audio_assets (track_id);
-- idempotency: the same file for the same track/kind/bitrate can never be registered twice
-- (coalesce so NULL bitrate on originals still collides)
create unique index audio_assets_idempotency_idx
  on public.audio_assets (track_id, kind, sha256, (coalesce(bitrate_kbps, 0)));

-- ---------- rights ------------------------------------------------------
create table public.rights_records (
  id                 uuid primary key default gen_random_uuid(),
  track_id           uuid not null references public.tracks (id) on delete cascade,
  declared_by        uuid not null references public.profiles (id) on delete restrict,
  basis              public.rights_basis not null,
  rights_holder_name text not null check (char_length(rights_holder_name) between 1 and 200),
  territories        text[] not null check (private.valid_territories(territories)),
  term_start         date not null,
  term_end           date,
  declaration_text   text not null check (char_length(declaration_text) between 1 and 4000),
  review_status      public.rights_review_status not null default 'pending',
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  review_notes       text check (review_notes is null or char_length(review_notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (term_end is null or term_end >= term_start)
);
create index rights_records_track_idx on public.rights_records (track_id);

-- Evidence is stored as a private REFERENCE only (key + checksum). Never public.
create table public.rights_evidence (
  id                uuid primary key default gen_random_uuid(),
  rights_record_id  uuid not null references public.rights_records (id) on delete cascade,
  kind              public.evidence_kind not null,
  storage_key       text not null check (storage_key !~ '(^/|\.\.)' and char_length(storage_key) <= 500),
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes        bigint not null check (size_bytes > 0),
  uploaded_by       uuid not null references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (rights_record_id, sha256)
);

-- ---------- moderation + audit ------------------------------------------
create table public.moderation_cases (
  id           uuid primary key default gen_random_uuid(),
  kind         public.moderation_case_kind not null,
  status       public.moderation_case_status not null default 'open',
  artist_id    uuid references public.artists (id) on delete set null,
  release_id   uuid references public.releases (id) on delete set null,
  track_id     uuid references public.tracks (id) on delete set null,
  opened_by    uuid references public.profiles (id) on delete set null,
  assigned_to  uuid references public.profiles (id) on delete set null,
  summary      text not null check (char_length(summary) between 1 and 4000),
  resolution   text check (resolution is null or char_length(resolution) <= 4000),
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  updated_at   timestamptz not null default now()
);
create index moderation_cases_status_idx on public.moderation_cases (status);

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  actor_kind   text not null,
  action       text not null,
  target_type  text not null,
  target_id    text,
  before_state jsonb,
  after_state  jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
