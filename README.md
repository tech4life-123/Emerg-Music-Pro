# Emerg Music Pro

A Liberia-first music streaming platform. Phases 1-4 are built: secure foundation, catalog, audio pipeline + player, and
artist/admin workflows (sign-in, Studio, review, takedown, audit). See `docs/PHASE4_REPORT.md` for the latest status.

> **Music rights.** Emerg Music hosts and streams only music with documented permission. The only audio in
> this repo is a synthesized test tone in `fixtures/sample/`, labeled sample data. Never commit real songs or
> artwork. The logo is the project owner's.

## What works today / what does not

| Works (verified, see `docs/PHASE1_REPORT.md`) | Not built yet |
|---|---|
| Migrations that reproduce the live Supabase schema + additive hardening | Rights EVIDENCE upload UI (records only), notifications, moderator role |
| Allow/deny authorization tests on real PostgreSQL 16 + catalog tests through a real PostgREST server (188 tests total) | Playlists, likes/follows, share links |
| Signed short-lived upload/playback tokens, private storage (local disk or Cloudflare R2 driver), Range streaming | Upload screen for artists (the API exists; the Studio UI does not) |
| FFmpeg worker (probe / AAC transcode / waveform) tested on a real file | Direct-to-R2 uploads (needed for Vercel), waveform display |
| Catalog pages: home, search, artist, release, track, genre; every state handled (Phase 2) | Waveform display, queue editing, offline |
| Audio pipeline (Phase 3): quarantine upload, ffprobe validation, AAC low/std renditions, job queue with retries, persistent player | Offline, payments, ads, royalties, native apps (excluded for now) |
| Artist/admin (Phase 4): sign-in/up, artist application, Studio (releases, tracks, upload with progress, rights, submit checklist), admin review/publish/takedown/restore, copyright reports, audit viewer, public report form. Verified in a real browser against the LOCAL stack (29 checks) | Verified against live Supabase Auth (not done; see report) |

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

# 2. Checks (what CI runs). The PostgREST integration test needs one pinned binary:
scripts/fetch-postgrest.sh     # skipped automatically if absent

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

### Audio pipeline, locally ($0, no accounts)
```bash
npm run local-stack     # local Postgres + PostgREST + a /rest/v1 shim, seeded with ONE published release of synthesized tones
                        # that went through the real upload -> validate -> transcode -> ready path. Writes .local-stack/env
set -a; . .local-stack/env; set +a; npm run build && npx next start      # NEXT_PUBLIC_* values are baked in at build time
npm run worker -- --once   # process queued uploads (needs ffmpeg and the same env as the web app)
```
Sign-in in the local stack uses a TEST-ONLY auth shim (`scripts/lib/auth-shim.ts`). Seeded accounts, password `preview-password-1`: `admin@preview.test` and `artist@preview.test`. Run the browser flow with `python3 tests/e2e/phase4_flow.py http://127.0.0.1:3100 <some.wav>` (needs Playwright for Python and the worker running).

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
| `CATALOG_SOURCE` | no | server | `sample` = labelled fictional data for local previews only (`ALLOW_SAMPLE_CATALOG=1` needed in production builds) |
| `R2_*` | no | server | Leave empty until you approve R2 |
| `WORKER_DRIVER`, `FFMPEG_PATH` | no | server | `local-ffmpeg` |
| `DATABASE_URL` | for `db:migrate` only | local | Local Postgres only; use the Supabase CLI for real projects |
| `TEST_DATABASE_URL` | tests only | local | Superuser URL of a throwaway server |

> **Database target:** Emerg Music Pro uses Supabase project `mjkszpbqzeidemxeykvj` ("emergmusic"). Earlier docs that mention `nuqstzxolrssorvovhqf` refer to a different product; see the correction in `docs/SUPABASE_RECONCILIATION.md`.

## Manual steps only you can do
Nothing below was done for you; no external account is connected.

1. **GitHub repository:** create it, push this code, and CI (`.github/workflows/ci.yml`) will run.
2. **Supabase:** the live project already exists; see `docs/SUPABASE_RECONCILIATION.md` (hardening and `000900_processing_jobs` applied; `001000_phase4_takedown_and_submission` also applied). Audio does not use Supabase Storage. For a fresh dev project: create one at supabase.com **without upgrading or adding billing**.
   Copy the URL, anon key and service-role key into `.env.local`. Then apply migrations with the Supabase CLI
   (`supabase link`, `supabase db push`), which uses `supabase/migrations/`. Do **not** use `npm run db:migrate --shim` against Supabase.
3. **First administrator:** there is intentionally no UI to self-promote (column grants stop a user changing their
   own `profiles.role`). After signing up a user, promote them once in the Supabase SQL editor (runs as the project owner):
   `update public.profiles set role = 'admin' where id = '<user uuid>';`
4. **Auth settings:** enable email sign-in in the Supabase dashboard. Decide whether email confirmation is required (the sign-up form handles both). Turn on leaked-password protection.
5. **Cloudflare R2 (approved):** create two PRIVATE buckets, one API token limited to those two buckets, set the `R2_*` variables and `STORAGE_DRIVER=r2`, then run `npm run r2:smoke`. Details in `docs/PHASE3_REPORT.md`.
6. **Worker host:** `npm run worker` must run on a machine that stays on (your computer for a pilot, or a small VM). Serverless hosting cannot run FFmpeg jobs. See `docs/COST_AND_DEPLOYMENT.md`.

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
- The R2 driver is tested against an in-process S3-compatible server through the real AWS SDK, **not against a real R2 bucket** (`npm run r2:smoke` does that; it has not been run).
- AAC playback was not verified in a real browser: the only browser available in the build sandbox has no AAC decoder. The player, authorization, Range and navigation behaviour were verified with MP3 data in place of the AAC renditions. Test AAC in Chrome, Safari and Firefox.
- Uploads are proxied through the Next.js route. That works on a long-running Node server but NOT on Vercel serverless (about 4.5 MB request body limit); direct-to-R2 uploads are the planned replacement.
- A track whose upload registered but whose job could not be queued stays `pending` with no job (the upload returns `queue_failed`; the artist re-uploads). There is no sweeper yet.
- Dev-only audit findings: `npm audit` reports 5 high findings in the lint toolchain
  (`eslint-config-next` -> `fast-glob` -> `braces`). `npm audit --omit=dev` reports 0. The suggested forced fix
  downgrades Next tooling, so it was not applied.
- TypeScript is pinned to 6.0.3 because `typescript-eslint` does not yet support TypeScript 7.
