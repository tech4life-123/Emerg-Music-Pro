create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('release_published','release_removed','release_changes','application_approved','application_rejected')),
  data jsonb not null default '{}'::jsonb,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "notifications: read own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications: mark own read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify_release_status() returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; k text;
begin
  if new.status is not distinct from old.status then return new; end if;
  k := case when new.status = 'published' then 'release_published'
            when new.status = 'removed' then 'release_removed'
            when new.status = 'draft' and old.status = 'in_review' then 'release_changes' end;
  if k is null then return new; end if;
  select a.owner_id into owner from public.artists a where a.id = new.artist_id;
  insert into public.notifications (user_id, kind, data, link)
    values (owner, k, jsonb_build_object('title', new.title, 'reason', new.removal_reason), '/studio/releases/' || new.id);
  return new;
end $$;
revoke execute on function public.notify_release_status() from public, anon, authenticated;
create trigger releases_notify after update of status on public.releases for each row execute function public.notify_release_status();

create or replace function public.notify_application_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status or new.status not in ('approved','rejected') then return new; end if;
  insert into public.notifications (user_id, kind, data, link)
    values (new.user_id, case when new.status = 'approved' then 'application_approved' else 'application_rejected' end,
            jsonb_build_object('name', new.artist_name, 'reason', new.decision_reason), '/studio');
  return new;
end $$;
revoke execute on function public.notify_application_status() from public, anon, authenticated;
create trigger applications_notify after update of status on public.artist_applications for each row execute function public.notify_application_status();

create or replace function public.moderate_release(p_release uuid, p_status public.release_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status in ('removed','draft') and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.releases set status = p_status, removal_reason = case when p_status in ('removed','draft') then p_reason else null end where id = p_release;
  if not found then raise exception 'Release not found'; end if;
  perform public.write_audit('moderate_release', 'release', p_release::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;
