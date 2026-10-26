-- Phase 5D step 1 of 2: a new enum value cannot be used in the same transaction that adds it, so it is its own migration.
-- 'withdrawn' = the artist took their own published release down. It is hidden and unplayable (every public rule tests status = 'published'),
-- and unlike 'removed' (staff action, needs a reason) the artist can reopen it as a draft, correct it and resubmit.
alter type public.release_status add value if not exists 'withdrawn';
-- Revert: enum values cannot be removed from a Postgres enum; unused, it is harmless.
