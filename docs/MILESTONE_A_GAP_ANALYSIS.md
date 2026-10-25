# Milestone A: audit and gap analysis (accounts, profiles, artist profiles, studio)

Read-only. No code or database was changed for this document. Inspected: repo at main (888503f), all 19 migrations, auth actions and forms, account/studio/admin/library pages, storage code, the live Supabase project's applied migrations. Not inspected (cannot be read from here): Supabase Auth dashboard settings (email confirmation on/off, SMTP, redirect URLs).

## 1. What already exists and is reusable
| Area | Exists and works (tested locally unless noted) |
|---|---|
| Auth | Email+password sign-in/up/out, one generic error, rate limit (in memory), safe `next` redirect. Live sign-in verified by you. |
| Profiles | `profiles` (display_name, avatar_url, locale, role), created by trigger on sign-up; users can update only display_name/avatar_url/locale; cannot change role. |
| Roles | listener / artist / admin; admin hidden from the app, 404 for non-admins, server-side gates + RLS. |
| Artist application | `artist_applications` (name, bio, links, rights statement), one pending per user, admin approve/reject, approval creates `artists` row + audit. |
| Artist | `artists` (name, slug, bio, image_url, status approved/suspended), public read of approved only, owner can edit bio/image_url. |
| Studio | Releases and tracks, upload to private storage, worker pipeline, rights declaration + rights record, submit, status polling. Admin review, publish, takedown, audit log. |
| Listener | Library (liked, follows, private playlists) with limits; persistent player; protected playback. |
| Storage | Private audio (R2 driver + local driver). No image storage exists. |

## 2. Gap table against the new PRD
Legend: DONE, PARTIAL, MISSING.

| PRD section | Requirement | State | Notes |
|---|---|---|---|
| 3 | Listener starts as listener, may apply as artist | DONE | |
| 3 | Moderator role | MISSING | `user_role` has no moderator; admin does everything. |
| 3 | Artist team members | MISSING | `artists.owner_id` is UNIQUE: one owner, one artist per user. Needs a membership table (decision). |
| 3 | No self-grant of roles/verification | DONE for role; verification flag does not exist yet | add admin-only `verified_at`. |
| 4 | Sign-up: email, password | DONE | |
| 4 | Sign-up: display name | DONE (called "Your name") | |
| 4 | Unique username/handle | MISSING | no column, no availability check. |
| 4 | Terms and privacy acceptance | MISSING | no Terms or Privacy pages exist; no stored acceptance. Text needs your/legal approval. |
| 4 | Optional avatar, country, preferences | MISSING | |
| 4 | Email verification, sensitive actions gated | PARTIAL | depends on a Supabase setting I cannot read; app never checks `email_confirmed_at`; no confirmation landing route. |
| 4 | Forgot / reset password | MISSING | no routes, no emails. |
| 4 | Session-expiry flow | PARTIAL | middleware/cookies refresh via Supabase SSR; no explicit "session expired" UX. |
| 4 | Auth abuse protection | PARTIAL | in-memory per-instance limiter only. Supabase CAPTCHA is OFF (I had you disable it to fix sign-in). Public anon key means the Supabase auth API can be called directly. Free fix: Cloudflare Turnstile. |
| 4 | First-run onboarding | MISSING | `/onboarding` is a static page, not wired to sign-up, saves nothing. |
| 5 | Listener profile page and shareable URL | MISSING | profiles are readable only by their owner; no public view. |
| 5 | Photo upload/crop/replace/remove | MISSING | |
| 5 | Edit name/bio, change password, privacy, deletion request | MISSING | Account page shows name and role only. |
| 5 | Followed count, public playlists | PARTIAL | follows exist; playlists are private-only (public deferred, awaiting your visibility decision). |
| 6 | Artist application fields: type, genres, country, images, contact email, authority confirmation | PARTIAL | have name, bio, links, rights acceptance. Missing the rest. |
| 6 | Application states draft/submitted/under review/info requested/approved/rejected/suspended | PARTIAL | enum is pending/approved/rejected; suspension lives on `artists.status`. No moderator message thread. |
| 6 | Claim existing artist, duplicate prevention | MISSING | only a slug uniqueness check; no claim flow. |
| 6 | Approval separate from rights approval | DONE | rights records and release moderation are separate. |
| 7 | Public artist page: avatar, header, verification badge, location, follow, releases, share, pinned release | PARTIAL | name, bio, follow, releases exist. Avatar/header images are placeholders (`Cover` hue blocks). No share control, no featured release. |
| 8 | Studio overview: completion, plays, trends, pending, rejected reasons, next steps | PARTIAL | release list and status only. |
| 8 | Studio profile editor + image upload + preview | MISSING | |
| 8 | Release metadata: date, credits, cover art, featured artists, contributors | PARTIAL | title/type/genre/language/explicit exist; `cover_path` column exists but no upload; credits table exists, no editor UI; no release date. |
| 8 | Withdrawal request, correct and resubmit | PARTIAL | returned-to-draft with a note works; no artist-initiated withdrawal. |
| 8 | Analytics (validated plays, unique listeners hidden under 5, definitions, no earnings) | PARTIAL | database function exists (aggregate-only) but returns exact unique counts; hiding below 5 and the page are not built; no plays are recorded yet. |
| 9 | Rights declaration, territories, term, evidence, splits | PARTIAL | declaration, territories, term, rights record exist. No evidence upload, no splits. |
| 9 | Track states list | PARTIAL | have draft/processing/ready/failed + release states; no distinct "withdrawn". |
| 10 | Playback, mini-player, library sections | PARTIAL | full-screen player, queue view, reorder, history, share: MISSING. Likes, follows, playlists: DONE. |
| 11 | Real images: listener avatar, artist avatar, header, release art, crop, variants | MISSING | no image storage, validation or crop tool. |
| 12 | RLS positive/negative tests | DONE for existing tables; new tables will need the same | |
| 12 | Storage permissions match DB | MISSING | no image storage yet. |
| 13 | Plum Velvet, accessibility, reduced motion | DONE/PARTIAL | existing; new screens must follow. |
| 14 | $0 budget | OK so far | limits listed in section 5. |

## 3. Security and quality findings (current state)
1. Supabase CAPTCHA is disabled and there is no replacement. High priority before real users (Turnstile, free).
2. Email verification is not enforced anywhere in the app. Whether Supabase requires it is unknown to me (dashboard setting).
3. No password recovery: a locked-out user has no path.
4. Rate limiting is per serverless instance, so it is a speed bump, not a guarantee.
5. Leaked-password protection is off; I believe that setting needs a paid plan (not verified).
6. `rls_auto_enable()` is executable by anon/authenticated (flagged by Supabase's advisor; not created by our migrations).
7. Not a defect but a limit: one artist per user, no team access.
8. Audio pipeline remains untested in production (R2, AAC in real browsers, worker host, Vercel upload size). Unchanged by this milestone.

## 4. Proposed schema changes (nothing applied; each will be shown with tests before any live change)
- `profiles`: add `username` (unique, lowercase, 3-24 chars, reserved-word list), `bio`, `country`, `onboarding_completed_at`, `terms_accepted_at`/`terms_version`, `profile_public` (default false). Public view exposing only username, display name, avatar, bio, join date when `profile_public`.
- Genre interests: `user_genres(user_id, genre_id)`.
- `user_role`: add `moderator`; helper `private.is_staff()`; admin-only: role changes, verification.
- `artist_applications`: new statuses, `artist_type`, `country`, `hometown`, `contact_email`, secondary genres, moderator message, authority confirmation.
- `artists`: `artist_type`, `country`, `hometown`, `header_path`, `logo_path`, `contact_email` (private), `links`, `verified_at` (admin-only), `featured_release_id`. Reuse `image_url` as avatar.
- Optional (needs decision): `artist_members(artist_id, user_id, role)` for teams.
- `account_deletion_requests`.
- Image storage and policies (see decision 2). Paths already constrained: `avatars/<user id>/…`, `artists/<artist id>/…`, `covers/<artist id>/<release id>/…`.

## 5. Free-tier limits that could block this work
- Supabase built-in email sender is heavily rate limited and meant for testing (to my knowledge, not verified): verification and recovery emails for real users need a free custom SMTP provider and likely a sending domain.
- Supabase Storage free allowance (about 1 GB, not verified) vs R2 free allowance (about 10 GB): choose per decision 2.
- Vercel Hobby: request body limit about 4.5 MB and short function time. Images must be resized in the browser before upload and validated again on the server. Hobby terms are non-commercial; verify before commercial launch.
- Cloudflare Turnstile is free.
- Database 500 MB free: images must not be stored in the database.

## 6. Plan (milestones, each with its own report and migration approval)
Library basics (PRD Milestone E) already shipped in Phase 5 M2, so the order becomes:
- **B**: username + terms + onboarding + profile page/settings + avatar upload + password recovery + email-verification gating + Turnstile.
- **C**: artist application v2, application states with moderator messages, artist profile fields and images, public artist page, claim flow; moderator role.
- **D**: Studio overview, profile editor, cover art upload, credits editor, withdrawal, analytics page (hide <5), rights evidence upload, track/release states.
- **E**: remaining listener features: queue view, full-screen player, reorder, validated plays and history, sharing.
- **F**: desktop/mobile test pass, security tests, deployment report.
The real audio end-to-end test (R2, browsers, worker host) is scheduled before E, because plays and history need real published audio.

## 7. Decisions needed before Milestone B
1. Username rules: 3-24 chars, letters/numbers/underscore, lowercase, reserved words blocked. OK?
2. Image storage: Supabase Storage public bucket (simple, built-in policies) or Cloudflare R2. I recommend Supabase Storage for images and R2 for audio.
3. Email sending: can you set up a free SMTP provider and domain for verification/recovery emails? Until then recovery cannot work reliably for real users.
4. Is email verification required before applying as an artist or uploading? I recommend yes.
5. Artist teams now or later? I recommend later; build a safe single-owner flow first.
6. Add the moderator role now (Milestone C)? I recommend yes.
7. Listener profiles: private by default, public only if the user turns it on?
8. Account deletion: a request form handled manually by an admin for the pilot, automatic deletion later?
9. Terms of Use and Privacy Notice text: I can draft plain-language starter text, but it needs review by a qualified adviser before public launch.
10. Create a free Cloudflare Turnstile widget (you click; I'll tell you where) so sign-up and sign-in are protected.
