# Cost and deployment assessment

**Status of this document:** an assessment, not a quote. Vendor pricing and free-tier limits change; every
figure below must be re-checked on the vendor's pricing page before you rely on it. **Nothing in this
repository enables, provisions, or calls a paid or metered service.** All paid-capable services listed here
are *off by default* and need your explicit approval.

## Summary

| Capability | Phase 1 choice ($0) | Can it stay at $0 in production? | Needs your decision? |
|---|---|---|---|
| Web app hosting | Local `npm run dev` / `npm start` | Possibly on a free hosting tier, but commercial use and limits must be checked | Yes, before first deploy |
| Database + auth | Local PostgreSQL for tests; a *free* Supabase dev project you create | Free tier is limited (pausing on inactivity, small DB/egress). Fine for development, risky for a public launch | Yes, before launch |
| Audio storage | Local disk (`STORAGE_DRIVER=local`) | **No.** Local disk does not exist on serverless hosting. A real object store is required for any deployed environment | **Yes. Blocking for deployment** |
| Audio processing | Local FFmpeg on your machine | **No** on serverless (no long-running processes, no FFmpeg). Needs a small always-on worker or a job service | **Yes. Blocking for deployment** |
| Rate limiting | In-memory (single instance) | Works only on a single long-lived instance. Not sufficient across serverless instances | Yes, before launch |
| Error tracking / monitoring | None yet | Free tiers exist but are limited | Later |
| SMS / phone auth | Not implemented | **No.** SMS is per-message billing | Only if you want it |
| Payments / ads / royalties | Not implemented (excluded) | n/a | Later phase |

## Decision recorded: Cloudflare R2 for audio (owner approved, 2026-10-22)
The owner chose R2. What that does and does not mean:
- Approved: using R2 for the `originals` and `renditions` buckets. **Not** approved and not done: any paid plan, any other metered service.
- R2 has a free allowance and then charges for storage and operations (no egress fee). Check the current R2 pricing page and set
  a billing alert before real listeners arrive. The sizing note below still applies.
- **Nothing has been run against a real bucket.** The two buckets already on the account (`emerg-audio`, `emerg-music`) were
  not touched; their purpose and contents are unknown to the build. Use two PRIVATE buckets and one token scoped to them
  (steps in `docs/PHASE3_REPORT.md`), then run `npm run r2:smoke`.
- **Upload path vs. hosting:** uploads currently stream through the Next.js route. That is fine on a long-running Node server
  and impossible on Vercel serverless (request body limit of roughly 4.5 MB). If the web app goes on Vercel, uploads must go
  directly to R2 with short-lived presigned URLs, which also needs a CORS rule on the originals bucket. That is a separate, small change.
- **Worker host:** the worker needs a machine that stays on and has FFmpeg. For a private pilot that can be your computer.

## Services that cannot be assumed to operate within $0

### 1. Audio object storage (the main cost driver)
Streaming is bandwidth-heavy. Even a modest catalog generates egress.

- **Cloudflare R2** is the Phase 0 recommendation because it advertises no egress fee, but it still has
  storage and operation-count charges beyond a free allowance, and **enabling R2 typically requires a
  payment method on the account**. That is a metered service, so it is **not enabled**. The R2 driver
  deliberately throws `not_enabled`, and `STORAGE_DRIVER=r2` will not start without every `R2_*` variable.
- **Supabase Storage** is an alternative, but its free tier has a small storage and egress allowance and a
  per-file size cap that may be too small for lossless uploads.
- **Rough sizing you can do yourself:** a 96 kbps AAC stream is about 0.72 MB per minute. 1,000
  listening-hours is about 43 GB of egress at that bitrate. Multiply by your expected listening hours to see
  whether a free allowance is realistic. The app supports a per-request bitrate cap (data-saver) to help.
- **Security gate before enabling any provider** (from your requirement #8): verify private buckets, no public
  listing, scoped short-lived credentials, and that a leaked playback URL expires. This has *not* been
  tested because no provider is connected.

### 2. Audio processing worker
FFmpeg transcoding needs minutes of CPU per upload and a runtime that allows child processes.
Vercel's serverless functions are not a good fit. Options, all of which may cost money or need an account you
must create: a small VM, a container host with a free allowance, or a queue plus worker. Until you choose,
uploads stay private, the track stays `pending`. They are **not** transcoded or playable.

### 3. Web hosting
Vercel (the PRD choice) has a free "Hobby" plan, but its terms restrict commercial use. A product intended to
earn revenue should assume a paid plan. Confirm current terms. Because audio streams through the app's
`/api/media` route in this build, large audio egress would also count against hosting bandwidth; the
production design should serve audio from the object store or CDN instead (see "Known limitations").

### 4. Supabase
The free plan is adequate for development. Known constraints to verify: inactivity pausing, limited
database size, no point-in-time recovery (backups matter for a rights/audit ledger), and shared resources.
A public launch should assume the paid tier for backups and reliability. No Supabase project is created
by this repository.

### 5. Rate limiting store, monitoring, email, SMS
- The limiter is in-memory and per-process. On multiple instances it is weaker than it looks. A shared
  store (a managed Redis/KV) is a future, possibly metered, decision.
- Supabase's built-in auth email has strict sending limits on free plans; production needs a custom SMTP
  provider. SMS/phone login is per-message cost and is not used.

## What I did NOT do (by design)
Did not create any cloud account, project, bucket, domain or deployment. Did not enable R2, any trial, or any
metered API. Did not add a payment method anywhere.

## Recommended path to a low-cost private pilot
1. Create a free Supabase dev project and a GitHub repo (manual steps in the README).
2. Run everything locally to validate the workflow with the sample fixture.
3. Decide storage + worker together (they are coupled). Get a written cost ceiling from the provider
   pricing pages for your expected pilot size.
4. Only then deploy a staging environment, behind a login, with a small invited artist group.

## Known limitations of the Phase 1 design (relevant to cost)
- Audio is proxied through the Next.js route. This is simple and keeps storage URLs private, but it consumes
  hosting bandwidth. A production design should issue provider-signed URLs or put a CDN in front.
- A playback token already issued stays valid until it expires (default 5 minutes) even if the track is taken
  down in the meantime. New authorizations are blocked immediately.
