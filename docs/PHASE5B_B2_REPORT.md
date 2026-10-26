# Milestone B2 report: accounts, onboarding, profile and recovery screens

Date: 2026-10-25. Branch `phase5b-accounts-security` (not merged). Builds on the B1 schema, which is already applied to the live project `emergmusic`. **No new migration in B2.**

## Built
- Sign-up: display name, unique username (checked server-side via `username_available`), email, password, terms checkbox (stores `terms_version`). Failed attempts keep what was typed.
- Draft **Terms** and **Privacy** pages, clearly marked "pending review by a qualified adviser".
- Forgot password (same answer whether or not the email exists), reset password, `/auth/callback` (code exchange), change password (requires current password), resend verification.
- Real onboarding: genres (from the `genres` table), follow artists, skip; sets `onboarding_completed_at`; shown once.
- Account page: profile (name, username, bio, country, public-profile toggle), verification status, deletion request/cancel, sign out.
- Public profile `/u/[username]` (404 unless the person made it public; no email shown).
- `Viewer.emailVerified`; `landingFor` sends listeners to onboarding or home, artists to Studio, admins to Admin.

## Tests (actually run, local stack)
- `tests/e2e/phase5b_accounts.py`: 22/22. Library regression e2e 20/20. Vitest 26 files / 227 tests. Lint and typecheck clean.

## Not verified / limits
- **Email links are untested.** The local auth shim sends no mail, so the real `/auth/callback` code exchange, confirmation and recovery emails have not run against Supabase. Needs SMTP and the redirect URL `https://emergmusic.vercel.app/**` in Supabase.
- Supabase's built-in email reaches team members only (2/hour); real users need custom SMTP.
- **Turnstile not built** (needs your site key). CAPTCHA must stay off in Supabase until the widget is deployed.
- **Avatar upload not built** (needs a Storage bucket migration for your approval).
- No session-refresh proxy added; sessions refresh only when the app calls Supabase in an action/route.
- Registration form relies on JavaScript.

## Next
Avatar upload (migration for approval), Turnstile, then Milestone C (artist application v2).
