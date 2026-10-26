# Milestone C report: artist application, artist profile and public artist page

Status: code complete on branch `phase5c-artist-profiles`; schema (C1) is live on the "emergmusic" Supabase project. **Not yet verified on the live site**: real image upload, and email links beyond password reset delivery.

## What was built
- **Artist application (C2):** draft, save, submit and resubmit at `/studio/apply`; applicant status screens and a reply thread at `/studio`. The database enforces completeness on submit (verified email, required fields, bio of 20+ characters, authority confirmation, unique artist name).
- **Staff review:** `/staff/applications` for administrators and moderators: start review, request more information, approve, reject (reject needs a reason). `/admin/applications` redirects there. Moderators cannot open Administration.
- **Artist profile editor (C3):** `/studio/profile`: bio, type, country, hometown, up to 5 links (http/https only), featured release (own published releases only), private contact email, artist picture (512x512 WebP) and header (1500x500 WebP). Images are cropped and re-encoded in the browser and uploaded to the public `artists` bucket under the artist's own folder; the server action then records the path.
- **Public artist page:** picture, header, type, place, bio, links (opened with `noopener noreferrer nofollow ugc`), verified badge, featured release first.
- **Admin:** `/admin/artists` (verify / remove verification, admin only) and `/admin/people` (make someone a moderator or return them to listener by username; artists and admins cannot be changed there).

## Tests actually run (local stack, not production)
| Check | Result |
|---|---|
| Typecheck, lint | clean |
| Vitest (unit + database, real Postgres 16 with the real migrations) | 261 / 261 passed, none skipped |
| Browser: application workflow (`tests/e2e/phase5c_applications.py`) | 19 / 19 |
| Browser: profile editor, public page, verify, moderators (`tests/e2e/phase5c_profile.py`) | 19 / 19 |

## Security notes
- All studio and admin actions run as the signed-in user, so row-level security and database triggers are the real boundary; the server checks are a second layer.
- Contact email lives in `artist_private` (owner and staff only) and is never selected by the public page (tested).
- Image paths are validated to `artists/<own artist id>/(avatar|header)-<uuid>.webp` in the action and again by the database and storage rules.
- Only administrators can verify an artist; moderators cannot.
- Bug found and fixed during testing: saving the contact email with an upsert failed because it also rewrites `artist_id`, which the owner may not update. It now updates, then inserts if no row exists.

## Not verified / open risks
1. **Real image upload** (avatars and artist images) has never been run against live Supabase Storage. The local stack has no Storage service. Needs a manual check on the live site.
2. **Email links:** password-reset email delivery works (Brevo, free plan, sender is a Gmail address, so spam placement is likely). The reset link and signup-confirmation link landing flow (`/auth/callback`) are still unconfirmed on the live site.
3. **Application insert policy:** a legacy policy still lets a client insert an application directly as `pending`, skipping the completeness checks in `submit_artist_application`. Needs a small migration (restrict insert to `draft`); will be shown to you before applying.
4. Moderators can approve and reject applications. This was not confirmed with you.
5. The `avatars` (B3) and `phase5_limits` migrations are applied live but missing from the migration history list.
6. Not built: claiming an existing artist, artist teams, notifications for information requests.
7. Still open from earlier phases: the real audio upload and playback test, Vercel upload size limit, worker hosting.

## Cost
No paid service was enabled. Brevo is on its free plan; its SMTP-key IP blocking was switched off so Supabase can send.
