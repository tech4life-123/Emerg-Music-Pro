# Phase 5 (PRD Phase 6): Security migration proposal. NOT applied to the live database.

Files (in the repo, uncommitted):
- supabase/migrations/20261026000000_phase5_listener_security.sql (new)
- tests/db/phase5_security.test.ts (new, 18 tests)
- tests/db/baseline.test.ts (1 assertion updated: a client insert into play_events now fails with "permission denied" instead of "row-level security")

Test results (local PostgreSQL 16, all migrations applied from scratch): full suite 24 files / 206 tests passed; lint and typecheck clean.
Live check (read-only, just now): favorites, artist_follows, playlists, playlist_tracks, play_events all have 0 rows, so the migration rewrites no data.

## What the migration changes
1. play_events privacy: artists can no longer SELECT raw rows. Listeners keep their own history; admins keep read access.
2. play_events writes: clients can no longer insert. A service-only function record_play_event() checks the track is public, clamps listened_ms to the track length, and ignores duplicate (user, client_event_id) callbacks. New column client_event_id plus a unique index.
3. artist_play_stats(artist, from, to): the replacement for artist reads. Returns per-day, per-track plays, unique listener COUNT and listened ms. No user ids. Owner or admin only; max range 366 days.
4. favorites and artist_follows: insert requires a public track (published, not removed, approved artist) or an approved artist.
5. playlist_tracks: insert trigger requires a public track; public playlists no longer reveal ids of removed tracks; owners still see and can remove their own dead items; re-ordering still works.
Helpers live in the private schema. ALTER POLICY only, no drop policy. Revert notes are at the bottom of the migration.

## Impact
- No UI changes. Nothing in the app writes play events or likes yet, so no feature breaks.
- Phase 5 server code must record plays with the service-role key from a server route (never the browser).
- Risk: a tiny audience can make "unique listeners" re-identifying (1 listener = that person). Decision 4 below.

## Decisions still needing your approval (none are encoded in the migration)
1. Adopt PRD s.14 phase numbering from now on.
2. Validated play: counted at the lower of 30 s or 50% of the track, once per event id (enforced by the server route, not the database).
3. History retention: raw play events kept 90 days, then daily roll-ups.
4. Artist analytics are aggregate-only; small-count handling: show exact counts, or hide unique-listener counts below a minimum (for example 5)?
5. May admins keep read access to raw play events (identities) for abuse handling? Currently yes.
6. Playlist visibility: private (default) or public with a share link; "unlisted" deferred. Share links stop working on takedown.
7. Abuse caps: proposed 200 playlists per user, 500 tracks per playlist, 5,000 likes per user. Not implemented until you approve numbers.
8. Order of work: close PRD Phase 5 (artist/admin) gaps before or after listener features?
9. Cloudflare Turnstile and a custom email sender as prerequisites for password recovery.
10. Deferred as stated: charts/trending, block/mute, notifications UI, subscription placeholder, data export/deletion.
