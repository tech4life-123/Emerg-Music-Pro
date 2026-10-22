# Phase 4 report: Artist and admin workflows

PRD scope: "Artist studio, submission review, rights workflow, takedown, audit logs". Exit gate: "Full submission-to-publication and takedown flows pass."

## What was built
- **Accounts:** `/login`, `/signup`, sign-out (server actions, zod validation, one generic error for bad credentials, rate limit, open-redirect-safe `next`). Account page shows role and links.
- **Artist application:** `/studio/apply` (rights statement must be accepted; one pending application per user).
- **Studio:** dashboard; new release; release workspace with tracks (add/delete), audio upload with progress through the authorized upload URL, processing status polling (as the user, via RLS), rights declaration (versioned statement `v1`), rights record form (basis, holder, territories, term), submit-for-review checklist, and the reviewer's notes / takedown reasons shown to the artist.
- **Admin** (server-gated layout; every database function re-checks `is_admin()`): overview counts; applications (approve / reject with reason); review queue and release detail (rights approve / request changes / reject, publish, send back, remove); **track takedown and restore**; copyright reports (under review / upheld / dismissed with note); audit log with filter.
- **Public:** `/report?release=&track=` form (no account needed; name, email, description, confirmation; rate limited) and a "Report" link on release pages.
- **Migration `20261022001000`** (NOT applied to live): track `removed_at/removal_reason`, `takedown_track`, `restore_track` (admin, audited), hidden-track playback refusal, stricter submission gate (declaration + rights record + at least one non-removed track + all tracks processed), hardened inserts for reports, releases and applications, tracks read policy now also requires an approved artist.

## Verification actually executed
| Check | Result |
|---|---|
| `npm test` (unit + DB + PostgREST integration, local PG16) | **188 passed** (23 files); includes 12 new DB tests (`phase4.test.ts`) and 7 form-helper tests |
| `npm run lint` / `typecheck` | clean |
| `npm run build` | passes (with and without backend env) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Browser run `tests/e2e/phase4_flow.py` against the LOCAL stack | **29/29**: anon denied on admin/studio; bad password generic; open redirect ignored; artist creates release, adds track, uploads WAV, worker processes it, declares rights, submits; publish blocked until rights approved; reasons enforced; admin approves and publishes; public can authorize playback; takedown refuses playback immediately and hides the track; artist sees the reason; restore re-enables; public report accepted and invalid report rejected; admin resolves report; audit shows the actions; sign-out |

## Defects found and fixed during this phase
- Public `copyright_reports` insert let anyone write status/resolution fields; releases and applications inserts accepted publication/decision fields; tracks public read skipped the artist-approved check; submission had no completeness gate (all fixed in 001000, with tests).
- **Found by the browser run:** my own "report must name a release" CHECK made deleting any reported release or account fail (`ON DELETE SET NULL` violated it). Replaced by the insert trigger; regression test added.
- Test harness mistakes (not product bugs): a login-redirect regex matched the login URL itself; Next's route announcer also has `role="alert"`.

## Known limitations (honest list)
- **Sign-in was verified only against a TEST-ONLY auth shim**, never against live Supabase Auth. Test real sign-up/sign-in (and email confirmation) once against your project.
- Migration 001000 was applied to live after this report was first written (verified; see SUPABASE_RECONCILIATION). The app has still not been run against live Supabase.
- No rights **evidence upload** UI (the table and policies exist). Admins approve on the artist's declared record only.
- No notifications to artists (they see status and notes in the Studio) and no `moderator` role (admin only).
- Cover art and artist profile editing are not built.
- Rate limiting is in memory (single instance). `?submit_error=` on the release page reflects a message in the query string (React-escaped, shown only on your own page).
- Playback tokens already issued stay valid up to 5 minutes after a takedown (new authorizations are refused immediately).
- AAC playback in real browsers and real R2 remain untested (Phase 3 items still open).
- Uploads still proxy through Next (breaks on Vercel's ~4.5 MB body limit): direct-to-R2 is the planned fix.

## Security notes
- Every Studio/Admin action runs as the signed-in user; RLS and the database functions are the boundary, the page gates are convenience.
- DB error text is shown only when the database raised it deliberately (business messages); policy/permission/internal errors become generic text.
- The auth shim, seeded passwords and generated secrets exist only in the local stack and are never used by the app in production.

## Exact next step
1. (Done) Migration `20261022001000` applied to live and verified.
2. In Supabase: enable email sign-in, decide on email confirmation, turn on leaked-password protection; then do one real sign-up/sign-in/sign-out.
3. R2: create the scoped API token, set `R2_*` + `STORAGE_DRIVER=r2` (originals = `emerg-originals`, renditions = `emerg-music`) and run `npm run r2:smoke`.
4. Then Phase 5 (per the PRD) or direct-to-R2 uploads first if you will host on Vercel.
