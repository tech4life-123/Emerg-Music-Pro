-- =====================================================================
-- TEST-ONLY shim of the parts of Supabase that our migrations depend on.
-- NEVER apply this to a real Supabase project (it already has these).
-- It lets us exercise the migrations + RLS on vanilla PostgreSQL 16.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz default now(), -- real Supabase has this column; test users are confirmed unless a test says otherwise
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''))::uuid;
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''))::text;
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- Reproduce Supabase's generous default privileges so our explicit
-- REVOKEs in migration 3 are genuinely exercised.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
