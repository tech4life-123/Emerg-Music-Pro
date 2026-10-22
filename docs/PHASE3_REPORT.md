# Phase 3 report: audio pipeline (Cloudflare R2)

Date: 2026-10-22. Scope: private upload, validation, transcoding, protected playback, persistent player.
Source of truth: the Master PRD. Nothing here claims a deployment or a real-R2 test that was not executed.

## Result in one paragraph
An upload now goes to a private **originals** (quarantine) bucket, a job is queued in the database, a worker validates it with
ffprobe, produces two AAC renditions (64 and 128 kbps) in a separate private **renditions** bucket, and marks the track `ready`.
Only renditions can be streamed, only after the existing playback gate (published, approved artist, rights in term and territory).
A persistent player plays them. All of this was verified on a local stack (real PostgreSQL migrations, real PostgREST, real FFmpeg,
real browser). It was **not** verified against real Cloudflare R2 or live Supabase, and AAC decoding was not verified in a browser.

## Files changed / added
- Storage: `src/lib/media/storage.ts` (two buckets `originals`/`renditions`; `R2Storage` over the S3 API; `read()` replaces `createReadStream()`), `storage-config.ts`
- Pipeline: `src/lib/worker/pipeline.ts`, `supabase-store.ts`; `scripts/worker.ts` (`npm run worker`)
- Routes: `api/upload/[token]` (quarantine, register, enqueue, clean up replaced audio), `api/media/[token]` (renditions only)
- Player: `src/components/player/{PlayerProvider,PlayButton}.tsx`, shell + release/track pages, icons, CSS
- Tooling: `scripts/local-stack.ts` (local preview stack), `scripts/r2-smoke.ts` (real-R2 check, not yet run)
- Copy fixed: removed "Playback arrives with the audio phase" text that became false
- Dependencies (exact pins): `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` 3.1155.0. `npm audit --omit=dev`: 0

## Migration
`20261022000900_processing_jobs.sql` (**not applied to live; awaiting owner approval**): `processing_jobs` table (clients may only
READ their own jobs, and not `original_key`), `enqueue/claim/complete/fail_processing_job` executable by `service_role` only.
Claims use `FOR UPDATE SKIP LOCKED` with a lease; retries up to 3 attempts; a result is only published if the track still points
at the original the job was created for (replaced uploads cannot publish stale renditions).

## Tests (all executed; 169 pass in 21 files)
| Layer | New tests | What they prove |
|---|---|---|
| DB (PostgreSQL 16) | 10 | permissions, RLS, lifecycle, SKIP LOCKED race, retry/timeout, replace-upload supersede |
| R2 driver via real AWS SDK against an in-process S3 server | 10 | put, multipart (12 MB), size ceiling aborts upload, stat, ranges, delete, key safety. **Not real R2** |
| Pipeline with real FFmpeg | 9 | AAC renditions, fake audio rejected with a safe message, too short, video-only, retry on infra error, cleanup |
| Upload route handler | 6 | quarantine bucket, register-then-queue order, replaced files deleted, failure cleanup, all refusals touch no DB |
| PostgREST end to end | 3 | worker RPCs over HTTP, artist sees job status via RLS but not storage keys, playback gate opens only after `ready` |
| Real browser (Playwright, 24 checks, run against the local stack) | 24 | plays, time advances, seek to 60 s with HTTP 206, keeps playing across navigation, next track, pause/resume, forged/tampered tokens 404, only the app origin is contacted, mobile layout, no console errors |

The browser checks are a script in the build scratchpad, not in the repo or CI. Caveat: the sandbox Chromium cannot decode AAC, so for those
checks the renditions on disk were replaced with MP3 bytes; server code and the player were unchanged.

## Known defects and limits
1. **Real R2 untested.** Run `npm run r2:smoke` after setup (below). 2. **AAC in browsers untested** (Chrome, Safari, Firefox).
3. **No upload UI** (Studio is a placeholder), so the flow is exercised through the API/tests, not by an artist in a browser.
4. **Uploads proxy through Next.js**: breaks on Vercel serverless (about 4.5 MB body limit). Fix: presigned direct-to-R2 upload.
5. A job that fails to queue after a successful upload leaves the track `pending` without a job (no sweeper yet).
6. Waveform peaks are computed by the worker interface but not stored or shown yet (no fake waveform is displayed).
7. A playback URL issued before a takedown stays valid until its TTL (default 5 minutes). New authorizations are blocked at once.
8. Supabase still reports **leaked-password protection disabled** (advisor, observed 2026-10-22 18:12 UTC) although you said it is done; it may be a paid-plan feature or not yet saved. Please re-check.
9. The 2 published releases still have no rights record, so nothing in live is playable until an artist adds one and an admin approves it.

## Security considerations
- R2 credentials exist only in server environment (`server-only` env module, worker process). The browser never receives a storage URL or key.
- Originals are never served: the media route reads only the `renditions` bucket and only keys from the signed play token, which come from the DB gate.
- Content is trusted by ffprobe, not by file name or declared type; ffmpeg is called with argument arrays (no shell); error text shown to artists never includes paths or tool output.
- Originals and renditions must be different buckets (the driver refuses one bucket for both), so tokens can be scoped separately.
- Job functions are service-role only; anon/authenticated calls are denied (tested over HTTP).

## What you must do in Cloudflare (nothing was created or changed by me)
1. Decide the two buckets. Two already exist (`emerg-audio`, `emerg-music`); I do not know their purpose or contents. Recommended: two NEW private buckets
   (for example `emerg-originals`, `emerg-renditions`). I can create them if you say so.
2. For both: leave **Public Development URL (r2.dev) disabled** and attach **no custom domain**.
3. R2 > Manage API tokens > create a token with **Object Read & Write**, restricted to **only those two buckets**. Copy the Access Key ID and Secret (shown once).
4. Put into `.env.local` on the web host and the worker host (never commit): `STORAGE_DRIVER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_ORIGINALS`, `R2_BUCKET_RENDITIONS`.
5. Run `npm run r2:smoke` and send me the output.
6. Set a billing alert in Cloudflare. No payment method is added by this repo.

## Exact next step
Your decisions needed: (a) apply migration 000900 to live (recommended, additive); (b) which R2 buckets (step 1 above).
Then: `npm run r2:smoke` against real R2. After that, Phase 4: artist Studio upload screen (with direct-to-R2 upload if hosting on Vercel),
admin review queue for rights and releases, moderator role and track-level takedown.
