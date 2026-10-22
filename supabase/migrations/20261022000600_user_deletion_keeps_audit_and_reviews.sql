-- Deleting a user (account deletion / privacy request) failed once they had audit rows, reviewed anything, or declared rights, because audit_log.actor_id
-- referenced profiles(id) without an ON DELETE action. The audit trail must outlive the account, so the actor link
-- becomes NULL on deletion. This is the ONLY change to an audit row that is permitted; everything else stays append-only.
alter table public.audit_log alter column actor_id drop not null;
alter table public.audit_log drop constraint audit_log_actor_id_fkey;
alter table public.audit_log add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

create or replace function public.audit_log_append_only() returns trigger language plpgsql set search_path = public as $$
begin
  -- The referential action nulls actor_id. Allow exactly that and nothing else (every other column unchanged).
  if tg_op = 'UPDATE'
     and old.actor_id is not null and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'audit_log is append-only';
end $$;

-- Reviewer columns are optional history, not ownership: deleting the reviewing admin must not be blocked, and must not
-- delete the reviewed application / rights record. They become NULL (the audit_log row still records who decided).
alter table public.artist_applications drop constraint artist_applications_reviewed_by_fkey;
alter table public.artist_applications add constraint artist_applications_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;
alter table public.rights_records drop constraint rights_records_reviewed_by_fkey;
alter table public.rights_records add constraint rights_records_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;

-- Declarations / evidence / records the user authored sit under releases that are deleted with the user's artist.
-- With NO ACTION the profile delete was rejected before that cascade could remove them, so they cascade as well.
alter table public.rights_declarations drop constraint rights_declarations_user_id_fkey;
alter table public.rights_declarations add constraint rights_declarations_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.rights_evidence drop constraint rights_evidence_added_by_fkey;
alter table public.rights_evidence add constraint rights_evidence_added_by_fkey
  foreign key (added_by) references public.profiles(id) on delete cascade;
alter table public.rights_records drop constraint rights_records_declared_by_fkey;
alter table public.rights_records add constraint rights_records_declared_by_fkey
  foreign key (declared_by) references public.profiles(id) on delete cascade;
