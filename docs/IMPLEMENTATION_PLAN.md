# Phase 1 file-by-file implementation plan

Scope: foundation only. No payments, subscriptions, ads, royalties, native apps or recommendations.

## Database (`supabase/migrations/`)
Mirrors the live Supabase schema, then hardens it. See `docs/SUPABASE_RECONCILIATION.md` for the table of all 10 files.
The original greenfield schema is archived in `docs/archive/greenfield-schema/`.

## Tests (`tests/`)
| File | Covers |
|---|---|
| `tests/db/supabase_shim.sql`, `helpers.ts` | TEST-ONLY Supabase role/JWT imitation on vanilla Postgres; per-file throwaway DB |
| `tests/db/baseline.test.ts` | 18 tests: protections the live schema already had |
| `tests/db/pre_hardening_gaps.test.ts` | 6 tests proving the live gaps on the pre-hardening schema |
| `tests/db/hardening.test.ts` | 13 tests: tracks insert/audio lock, variants RPC, audit append-only |
| `tests/db/rights_gates.test.ts` | 20 tests: rights records, evidence, publish gate, playback gate, takedown |
| `tests/unit/*.test.ts` | tokens, range, rate limiter, storage, env, upload/playback authorization, access gate, FFmpeg worker |

## Application (`src/`)
| Path | Purpose |
|---|---|
| `lib/env.ts` | Validated server env (secrets never echoed) |
| `lib/media/{tokens,storage,range,authorization}.ts` | Signed capability tokens; local private storage; Range parsing; scoped upload / short-lived playback authorization |
| `lib/worker/*` | AudioWorker interface + local FFmpeg implementation |
| `lib/supabase/{config,server,admin}.ts` | Public config; user-scoped (RLS) client; server-only service-role client |
| `lib/auth/viewer.ts` | Verified viewer + server-side role gate |
| `lib/services/media.ts`, `lib/http.ts`, `lib/catalog.ts` | Wiring of tested logic to Supabase/storage; HTTP helpers; published-release query |
| `app/api/upload/authorize`, `app/api/upload/[token]` | Scoped upload authorization; byte receipt + registers tracks.audio_path (service role) |
| `app/api/playback/authorize`, `app/api/media/[token]` | Gate + token; Range streaming with `Cache-Control: private, no-store` |
| `app/(app)/*`, `app/onboarding`, `app/dev/states` | Shell pages with honest states; welcome screen; dev-only state gallery |
| `app/{layout,globals.css,manifest}` | Plum Velvet tokens, PWA manifest, icons from the owned logo |
| `components/shell/*`, `components/states/*`, `components/icons.tsx` | Responsive shell (sidebar / bottom nav), state components |

## Tooling
`package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `.prettierrc`, `.env.example`,
`.github/workflows/ci.yml`, `scripts/migrate.ts` (+`lib/migrate.ts`), `scripts/generate-sample-audio.ts`,
`fixtures/sample/*`.

## Decisions that could create cost (none taken)
See `docs/COST_AND_DEPLOYMENT.md`: object storage (R2), audio worker host, web hosting plan, Supabase tier.
