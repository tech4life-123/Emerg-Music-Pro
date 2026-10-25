# Phase 5, Milestone 2: Library, likes, follows, private playlists

Branch: phase5-m2-library (built on phase5-security-proposal). Not merged. Live Supabase: security migration applied (Milestone 1); limits migration NOT applied (awaiting approval).

## Files
- supabase/migrations/20261026000100_phase5_limits.sql (new, UNAPPLIED): private.app_limits (configurable), 3 BEFORE INSERT triggers, advisory locks.
- src/lib/library/{actions,data,session}.ts, src/components/library/{Controls,LibraryTrackList}.tsx
- Pages: /library (rebuilt), /library/playlists/[id] (new); like/follow/add-to-playlist controls on track, release and artist pages.
- src/components/catalog/Catalog.tsx (optional like buttons), icons.tsx (heart), globals.css, services/limits.ts (library rate limit), home page wording.
- scripts/local-stack.ts: two seeded test listeners.
- Tests: tests/db/phase5_limits.test.ts (6), tests/e2e/phase5_library.py (20).

## Results (local stack, real migrations, real PostgREST HTTP layer)
- Vitest: 25 files / 212 tests passed. Lint and typecheck clean. Production build succeeded.
- Phase 4 browser flow: 36/36. Phase 5 library browser flow: 20/20 (three consecutive clean runs).
- Not tested: the live site, real Supabase Auth, real phones.

## Known limitations / risks
- Limits are not enforced on the live database until the limits migration is approved and applied. Do not merge to main (auto-deploys) before that.
- Playlists are private only in this milestone. The database column is_public still exists and owners can set it through the API; public playlists contain only public tracks (Milestone 1 policy), and there is no UI or share link yet.
- Rate limiting is the in-memory limiter (per serverless instance); the database limits are the hard cap.
- No reorder UI yet (position is stored; tracks append).
- Audio upload/playback in production remains untested end to end (R2, AAC in real browsers, worker host).
