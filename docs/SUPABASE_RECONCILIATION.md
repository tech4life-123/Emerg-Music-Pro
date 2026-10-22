# Supabase reconciliation (live project `nuqstzxolrssorvovhqf`)

The live Supabase project already held a working schema and data (built before this repo). We kept it. The
repo's `supabase/migrations/` now **reproduces it exactly** and adds **additive, non-destructive hardening**.
The first greenfield design is archived in `docs/archive/greenfield-schema/` (reference only, not applied).

## 1. Migration history

| Migration | What | Effect on live |
|---|---|---|
| `20261020145037` … `20261021203301` (6 files) | Verbatim copies of the migrations recorded on live | None (already applied) |
| `20261022000000_capture_unrecorded_live_changes` | Changes that exist on live but were never recorded (copyright report RPC, `tracks_audio_path_own_folder`, tracks policy `WITH CHECK`). Idempotent | **No-op on live** |
| `20261022000100_harden_tracks_and_audit` | Column-level INSERT on `tracks`; audio lock after draft; `set_track_audio_variants` service-role only; append-only `audit_log` | **Changes behaviour** |
| `20261022000200_rights_records_and_gates` | `rights_records` / `rights_evidence`, `review_rights_record`, publish gate, `get_playback_target` | **Changes behaviour** |
| `20261022000300_hide_audio_paths_from_clients` | `tracks` audio path columns no longer readable by anon/authenticated | **Can break `select *` on tracks** |

Equality of the replica and live was checked with a 9-category catalog fingerprint (tables, columns,
constraints, indexes, policies, functions, triggers, grants, enums) before the hardening migrations.

## 2. Gaps found in the live schema (each proven by `tests/db/pre_hardening_gaps.test.ts`)

1. An artist could insert a track already `ready` with arbitrary variant paths.
2. Audio could be added or swapped after a release was published (moderation bypass).
3. Any artist could call `set_track_audio_variants` and mark their own track `ready`.
4. `audit_log` could be edited/deleted/truncated by the table owner.
5. Audio storage paths were readable by `anon`.
6. A release could be published with only a declaration: no territory, term or evidence review.

All six are closed by the hardening migrations and covered by allow/deny tests (`hardening.test.ts`,
`rights_gates.test.ts`).

## 3. What changes for existing data and clients

- The 2 existing published releases have **no approved rights record**, so the new playback gate refuses them
  until an admin approves rights (`review_rights_record`). Rights are never invented or back-filled.
- Any client that reads `audio_path`, `audio_low_path` or `audio_std_path` from `tracks`, or does
  `select *` on `tracks`, will get a permission error (migration 000300). Revert: `grant select on public.tracks to anon, authenticated;`.
- Any client that calls `set_track_audio_variants` as a signed-in user is now refused (service role only).
- The Next.js app in this repo has been adapted to this schema (`profiles.role`, `tracks.audio_*`,
  `get_playback_target`). The earlier `Emerg-Music` frontend, if it is a consumer of this database, was **not** reviewed.

## 4. Observed, not yet acted on

- Advisor WARN: SECURITY DEFINER helpers (`is_admin`, `owns_artist`, …) are executable by anon/authenticated.
  RLS policies call them, so the safe fix is moving them to a private schema (separate change).
- Leaked-password protection is off (dashboard setting; may depend on plan).
- No `moderator` role exists (enum is listener/artist/admin). No track-level takedown (release-level `moderate_release` exists).
- `audit_log.actor_id` FK blocks deleting a user who has audit rows.

## 5. Applied to live (2026-10-22)

Applied to `nuqstzxolrssorvovhqf` with the owner's delegated approval, after an in-database snapshot of
`tracks, releases, artists, audit_log, profiles, rights_declarations` into schema `backup_20261022`
(RLS on, no grants to API roles; row counts matched: 3 tracks, 3 releases, 6 audit rows).

| Migration | Live status |
|---|---|
| `...000000_capture_unrecorded_live_changes` | **Not applied.** The apply was cancelled at the confirmation prompt (it contains `drop policy`) and was not retried. It is a no-op on live (everything it records already exists there), so nothing is missing. |
| `...000100_harden_tracks_and_audit` | Applied (recorded as `20261022170827`) |
| `...000200_rights_records_and_gates` | Applied (`20261022170851`) |
| `...000300_hide_audio_paths_from_clients` | Applied (`20261022170856`) |
| `...000400_hide_suspended_artists_releases` | Applied via `alter policy` (the `drop policy` form was cancelled at the prompt); verified on live |
| `...000500_move_policy_helpers_to_private_schema` | Applied (`20261022174007`). `is_admin` / `owns_artist` are no longer API functions; 7 admin functions re-created |
| `...000600_user_deletion_keeps_audit_and_reviews` | Applied (`20261022174034`). Users with audit rows / reviews / rights declarations can now be deleted; audit rows survive with `actor_id` NULL |
| `...000700_anon_cannot_read_artist_owner` | Applied (`20261022174021`) |
| `...000800_rights_records_for_published_releases` | Applied (`20261022174026`). Artists can add a PENDING rights record to an already-published release |

Live migration versions are timestamps of when they were applied and differ from the repo file prefixes; the SQL is identical.
Do not run `supabase db push` blindly: reconcile history first (`supabase migration repair`).

Verified on live afterwards: data intact (3 tracks, 6 audit rows); the three new triggers exist; `rights_records` and
`rights_evidence` have RLS; `get_playback_target` executable by service_role only; `set_track_audio_variants` not
executable by signed-in users; anon cannot read `audio_path`; clients cannot insert `processing_status`; a
`delete from audit_log` is blocked (rolled-back test, still 6 rows).

Still to do manually: create the private storage bucket `media` (not public) in the dashboard; approve rights for the
2 existing published releases (until then `get_playback_target` returns nothing for them, which is intended);
drop `backup_20261022` once you are satisfied (`drop schema backup_20261022 cascade;`).
Revert 000300 only: `grant select on public.tracks to anon, authenticated;`.

## 6. Defect round (2026-10-22, "solve all bugs")

Fixed and verified on live (SQL checks + advisors), each with automated tests locally (`tests/db/defect_fixes.test.ts`,
`catalog_visibility.test.ts`, `tests/integration/catalog-postgrest.test.ts`):

| Defect | Fix |
|---|---|
| Suspended artist's published releases/tracks stayed readable via the API | 000400 |
| Policy helpers callable as public RPCs (advisor WARN x4) | 000500 (warnings gone) |
| Deleting a user with audit rows / reviews / declarations failed | 000600 |
| Anonymous visitors could read `artists.owner_id` | 000700 |
| Published releases could never receive a rights record (so never playable) | 000800 |
| 2 tracks marked `ready` with no audio files in storage (0 objects, no bucket) | Set to `pending` (paths kept; originals in `backup_20261022`) |

### Accepted / not fixable here
- Advisor WARN on `artist_follower_count` (public aggregate, intentionally callable by everyone) and on the admin RPCs
  (`approve/reject_artist_application`, `moderate_release`, `resolve_copyright_report`, `review_rights_record`): they must be
  callable by signed-in users and check admin rights inside; they are not callable by `anon`.
- Leaked-password protection is an Auth dashboard setting (Authentication > Providers/Policies); it cannot be changed with SQL.
- `npm audit` reports 5 high in the lint toolchain (`braces` has no patched release). Dev-only; `npm audit --omit=dev` is 0.
- A null `audit_log.actor_id` now also means "system/backend action" or "deleted account".
