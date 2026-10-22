# Emerg Music Pro - Phase 1 report (zero-budget foundation, reconciled with live Supabase)

Date: 2026-10-22. Everything under "Verified" was executed in the build environment.

## Verified
- `npm run lint`, `npm run typecheck`, `npm run build`: exit 0
- `npm test`: 97 tests passed, three consecutive runs (57 database authorization tests on PostgreSQL 16 + 40 unit tests incl. real FFmpeg)
  - `baseline` 18 (existing live protections), `pre_hardening_gaps` 6 (proves the 6 live gaps), `hardening` 13, `rights_gates` 20 (rights records, evidence, publish gate, playback gate, takedown)
- 10 migrations apply cleanly to a fresh database; local replica fingerprint equals live across 9 catalog categories (before hardening)
- Fixed a real race in `LocalStorage.put` (partial file could survive a failed upload), found by a flaky run

## NOT verified
- Hardening migrations are **NOT applied to live Supabase** (needs owner approval; see `docs/SUPABASE_RECONCILIATION.md`)
- RLS on a live Supabase project (tests use a test-only shim on vanilla Postgres)
- API routes / Supabase clients against live Supabase; upload flow end to end; private `media` bucket does not exist yet
- Any deployment, R2, hosted worker; the earlier `Emerg-Music` frontend (not reviewed)

## Files changed (this reconciliation)
`supabase/migrations/*` (10), `tests/db/*`, `scripts/lib/migrate.ts`, `src/lib/{auth/viewer,media/*,services/media}.ts`,
`src/app/api/{upload/[token],playback/authorize,media/[token]}/route.ts`, admin page copy, unit tests, docs, config (archive excluded from tsc/eslint).

## Decisions needed from owner
1. Approve applying migrations 000000-000300 to live (backup first). 000300 can break `select *` on tracks; the 3 published releases become unplayable until rights are approved.
2. Object storage (R2 is metered, not enabled), audio worker host, hosting plan, Supabase tier: `docs/COST_AND_DEPLOYMENT.md`.

## Known defects / limits
In-memory rate limiter; playback token valid until expiry after takedown (<=5 min); no processing queue; TypeScript pinned to 6.0.3; helper functions still executable by anon (see reconciliation doc section 4).

## Next
Apply hardening to live after approval, auth UI + first-admin bootstrap, run DB tests against a Supabase branch, catalog pages.
