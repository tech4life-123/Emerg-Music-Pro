# Emerg Music Pro - Phase 2 report (Catalog)

PRD gate: "Only published items are publicly discoverable." Date: 2026-10-22.

## Delivered
- Pages: Home (new releases, genres), Search, Artist, Release, Track, Genre. Each handles unconfigured, error, not-found, empty and ok states.
- Search: real GET form (works without JavaScript), 2-60 characters, matched literally (LIKE wildcards escaped), artists + releases + tracks, published only.
- Data layer `src/lib/catalog/`: `supabase-repo` (runs as the visitor, so RLS is the boundary; explicit column lists because audio path columns are not granted), pure helpers, and a `sample-repo` for previews.
- No dead buttons: there is no Play control anywhere; pages say playback arrives with the audio phase. Tracks without processed audio say "Audio not available yet".
- Placeholder artwork is generated from the id (no real artwork exists yet) and is `aria-hidden`.

## Verified (executed)
- lint, typecheck, build exit 0; `npm test`: 131 passed (database + unit + PostgREST integration)
- New DB test `catalog_visibility` (real RLS as anon): draft / in_review / removed releases and their tracks invisible; audio paths and `select *` on tracks denied; wildcard search patterns literal; published release of an approved artist visible.
- New unit tests: id/slug validation, query normalisation, LIKE escaping, no audio columns selected, malformed ids rejected WITHOUT a query, search never builds a raw filter string, errors surface as errors (not empty), hidden-artist releases dropped.
- Rendered in Chromium at 1280px and 390px using SAMPLE data: no horizontal scroll, no console errors, keyboard Tab reaches links, empty/short/injection-style search inputs handled.

## Defects found and fixed (now applied to live, see docs/SUPABASE_RECONCILIATION.md section 6)
1. Suspended artist's published releases/tracks readable via the API: `000400`. The new test failed before the fix.
2. Policy helper functions exposed as public RPCs: `000500`.
3. User deletion blocked by audit/review/declaration foreign keys: `000600`.
4. `artists.owner_id` readable by anonymous visitors: `000700`.
5. No way to attach rights to an already-published release: `000800`.
6. Two live tracks marked `ready` with no audio files: reset to `pending`.

## NOT verified
- The app against the live Supabase project over HTTPS (the sandbox cannot reach it). The catalog repo IS tested through a real PostgREST server over the migrated schema (`tests/integration`, pinned PostgREST 12.2.3), plus a stub-client unit suite.
- Screenshots use sample data; the live catalog (2 published releases) has not been rendered.
- Accessibility beyond keyboard reachability (no screen-reader or contrast audit).

## Known limits
Search is substring match (no ranking or typo tolerance). No pagination beyond fixed caps (24 new releases, 60 per genre). Artist `owner_id` is selectable by anon (not displayed; consider a column revoke).

## Next
Phase 3 - audio pipeline: create the private `media` bucket, upload to quarantine, validation/transcoding job, protected playback, persistent player. Requires your decision on object storage (see docs/COST_AND_DEPLOYMENT.md).
