# Emerg Music Pro

A Liberia-first music streaming platform. **Phase 1: zero-budget foundation.** This repository contains
the secure foundation (database, authorization, private-audio plumbing, responsive shell). It is **not** a
working music player yet.

> **Music rights.** Emerg Music hosts and streams only music with documented permission. The only audio in
> this repo is a synthesized test tone in `fixtures/sample/`, labeled sample data. Never commit real songs or
> artwork. The logo is the project owner's.

## What works today / what does not

| Works (verified, see `docs/PHASE1_REPORT.md`) | Not built yet |
|---|---|
| Migrations that reproduce the live Supabase schema + additive hardening | Sign-in / sign-up UI |
| 57 allow/deny authorization tests on real PostgreSQL 16 (baseline, proven gaps, hardening, rights and playback gates) | Search, artist/album/track pages, player, playlists |
| Signed short-lived upload/playback tokens, local private storage, Range streaming logic | Audio processing queue (uploads register `audio_path` only; track stays `pending`) |
| FFmpeg worker (probe / AAC transcode / waveform) tested on a real file | Artist studio and admin dashboards (guarded placeholders only) |
| Responsive shell, design tokens, loading/empty/error/denied/not-configured states, PWA manifest + icons | Offline, payments, ads, royalties, native apps (excluded from Phase 1) |

API routes (`/api/upload/*`, `/api/playback/authorize`, `/api/media/*`) are implemented over tested logic, but
have **not been exercised against a live Supabase project**. The hardening migrations are applied to the live project; **read `docs/SUPABASE_RECONCILIATION.md`** for what changed and what is left to do.

## Requirements
Node 22+, npm, FFmpeg (`ffmpeg`/`ffprobe` on PATH), and a PostgreSQL 16 server for the database tests
(Docker is the easiest way).

## Reproduce the environment (all $0, all local)

```bash
git clone https://github.com/tech4life-123/emerg-music-pro && cd emerg-music-pro
npm ci

# 1. A throwaway local Postgres for tests (needs Docker):
docker run -d --name emerg-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 54329:5432 postgres:16
# (The tests default to postgres://postgres@127.0.0.1:54329/postgres. Override with TEST_DATABASE_URL.)

# 2. Checks (what CI runs):
npm run lint
npm run typecheck
npm test            # unit tests + database authorization tests
npm run build

# 3. Run the app:
cp .env.example .env.local     # then edit, see "Environment variables"
npm run dev                    # http://localhost:3000
```

With no Supabase variables set the app still runs and shows an honest "Backend not connected" state instead
of fake data.

Regenerate the sample fixture: `npm run fixtures:generate`.

## Environment variables

| Variable | Required | Scope | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | for accounts/catalog | browser-safe | From your Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for accounts/catalog | browser-safe | Public "anon/publishable" key only |
| `SUPABASE_SERVICE_ROLE_KEY` | for uploads/playback | **server only** | Bypasses RLS. Never `NEXT_PUBLIC_`, never commit |
| `MEDIA_SIGNING_SECRET` | **for any API route** | server only | >= 32 chars. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STORAGE_DRIVER` | no (`local`) | server | `r2` is **not enabled** (see cost doc) |
| `LOCAL_STORAGE_DIR` | no (`./storage-local`) | server | Git-ignored |
| `UPLOAD_TOKEN_TTL_SECONDS` / `PLAYBACK_TOKEN_TTL_SECONDS` | no (600 / 300) | server | 30-3600 / 30-900 |
| `MAX_UPLOAD_BYTES` | no (100 MB) | server | Upload ceiling |
| `R2_*` | no | server | Leave empty until you approve R2 |
| `WORKER_DRIVER`, `FFMPEG_PATH` | no | server | `local-ffmpeg` |
| `DATABASE_URL` | for `db:migrate` only | local | Local Postgres only; use the Supabase CLI for real projects |
| `TEST_DATABASE_URL` | tests only | local | Superuser URL of a throwaway server |

## Manual steps only you can do
Nothing below was done for you; no external account is connected.

1. **GitHub repository:** create it, push this code, and CI (`.github/workflows/ci.yml`) will run.
2. **Supabase:** the live project already exists; see `docs/SUPABASE_RECONCILIATION.md` (hardening already applied; still create a private `media` bucket). For a fresh dev project: create one at supabase.com **without upgrading or adding billing**.
   Copy the URL, anon key and service-role key into `.env.local`. Then apply migrations with the Supabase CLI
   (`supabase link`, `supabase db push`), which uses `supabase/migrations/`. Do **not** use `npm run db:migrate --shim` against Supabase.
3. **First administrator:** there is intentionally no UI to self-promote (column grants stop a user changing their
   own `profiles.role`). After signing up a user, promote them once in the Supabase SQL editor (runs as the project owner):
   `update public.profiles set role = 'admin' where id = '<user uuid>';`
4. **Auth settings:** enable email sign-in in the Supabase dashboard (sign-in UI is not built yet).
5. **Storage / worker decision (blocks any deployment):** read `docs/COST_AND_DEPLOYMENT.md`.

## Repository map
See `docs/IMPLEMENTATION_PLAN.md` for the file-by-file plan. Highlights:
`supabase/migrations/` (schema, functions/triggers, RLS), `tests/db/` (authorization tests), `src/lib/media/`
(tokens, storage, authorization, range), `src/lib/worker/` (FFmpeg), `src/app/` (pages + API routes),
`src/components/` (shell + states), `fixtures/sample/` (labeled sample data).

## Security model in one paragraph
Every table has RLS enabled with default-deny and explicit grants. Writes that must hold invariants go through
narrow `SECURITY DEFINER` functions and triggers (publication state machine, admin-reviewed rights term/territory/evidence, audited
admin actions, takedown). Audit logs are append-only even for the table owner. Audio is never public: uploads go
to a private store under a server-chosen key (`audio/<artist_id>/<track_id>/...`), allowed only to the artist's owner while the release is a draft; playback requires a rights/territory-checked,
short-lived signed token, and the browser only ever sees an app URL, never a storage URL or key. The
service-role key lives only in server-only modules.

## Verification
What was actually executed in the build environment, and the results, is recorded in the Phase 1 report.
Anything not listed there has not been verified.

## Known limitations
- **RLS was tested on vanilla PostgreSQL 16 with a test-only shim** that imitates Supabase's roles
  (`anon`, `authenticated`, `service_role`, `auth.uid()`), not on a live Supabase project. Run the same
  checks against your Supabase dev project before trusting it.
- API routes and Supabase client code are not integration-tested against a live Supabase.
- Rate limiting is in-memory (single instance).
- Issued playback tokens remain valid until expiry (default 5 min) after a takedown; new authorizations are blocked immediately.
- Uploads register `tracks.audio_path` and the track stays `pending`; validation/transcoding is not wired to a queue yet, so nothing becomes playable through the app yet.
- Dev-only audit findings: `npm audit` reports 5 high findings in the lint toolchain
  (`eslint-config-next` -> `fast-glob` -> `braces`). `npm audit --omit=dev` reports 0. The suggested forced fix
  downgrades Next tooling, so it was not applied.
- TypeScript is pinned to 6.0.3 because `typescript-eslint` does not yet support TypeScript 7.
