-- Phase 5C step 1 of 2: new enum values only. PROPOSED, not applied to the live project.
-- Postgres does not let a value added to an enum be used in the same transaction, so these live in their own migration.
-- 'pending' stays and now MEANS "submitted" (waiting for staff): existing rows, functions and tests keep working unchanged.
alter type public.user_role add value if not exists 'moderator';
alter type public.application_status add value if not exists 'draft';
alter type public.application_status add value if not exists 'under_review';
alter type public.application_status add value if not exists 'info_requested';
