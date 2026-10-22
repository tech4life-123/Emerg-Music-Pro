# Emerg Music Pro - Phase 2 report (Catalog)

PRD gate: "Only published items are publicly discoverable." Date: 2026-10-22.

## Delivered
- Pages: Home (new releases, genres), Search, Artist, Release, Track, Genre. Each handles unconfigured, error, not-found, empty and ok states.
- Search: real GET form (works without JavaScript), 2-60 characters, matched literally (LIKE wildcards escaped), artists + releases + tracks, published only.
- Data layer `src/lib/catalog/`: `supabase-repo` (runs as the visitor, so RLS is the boundary; explicit column lists because audio path columns are not granted), pure helpers, and a `sample-repo` for previews.
- No dead buttons: there is no Play control anywhere; pages say playback arrives with the audio phase. Tracks without processed audio say "Audio not available yet".
- Placeholder artwork is generated from the id (no real artwork exists yet) and is `aria-hidden`.

## Verified (executed)
- lint, typecheck, build exit 0; `npm test`: 114 passed (62 database + 52 unit)
- New DB test `catalog_visibility` (real RLS as anon): draft / in_review / removed releases and their tracks invisible; audio paths and `select *` on tracks denied; wildcard search patterns literal; published release of an approved artist visible.
- New unit tests: id/slug validation, query normalisation, LIKE escaping, no audio columns selected, malformed ids rejected WITHOUT a query, search never builds a raw filter string, errors surface as errors (not empty), hidden-artist releases dropped.
- Rendered in Chromium at 1280px and 390px using SAMPLE data: no horizontal scroll, no console errors, keyboard Tab reaches links, empty/short/injection-style search inputs handled.

## Defect found and fixed locally (NOT yet on live)
A suspended artist's published releases (and their tracks) stayed readable by anyone calling the API directly. Migration `000400` limits public reads to approved artists. The new DB test failed before the migration and passes after. No artist is suspended on live today.

## NOT verified
- The Supabase repo against the live project (the sandbox cannot reach it); only against a stubbed client and real RLS in local Postgres.
- Screenshots use sample data; the live catalog (2 published releases) has not been rendered.
- Accessibility beyond keyboard reachability (no screen-reader or contrast audit).

## Known limits
Search is substring match (no ranking or typo tolerance). No pagination beyond fixed caps (24 new releases, 60 per genre). Artist `owner_id` is selectable by anon (not displayed; consider a column revoke).

## Next
Phase 3 - audio pipeline: create the private `media` bucket, upload to quarantine, validation/transcoding job, protected playback, persistent player. Requires your decision on object storage (see docs/COST_AND_DEPLOYMENT.md).
