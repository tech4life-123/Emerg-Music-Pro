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

- The 3 existing published releases have **no approved rights record**, so the new playback gate refuses them
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

## 5. Applying to live (needs owner approval, not done)

Take a backup/export first, then apply `20261022000000` … `20261022000300` in order (Supabase CLI
`supabase db push` or the SQL editor). Then create the private storage bucket `media` (not public) manually.
Re-run the DB test suite against a Supabase branch if you want shim-free proof.
