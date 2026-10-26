-- Phase 5B (B3): profile photos. PROPOSED. Not applied to the live project.
-- Live check before writing this: 1 bucket exists ("media", private), 0 profiles have an avatar_url, so nothing here rewrites data.
--
-- Design:
--  * New PUBLIC bucket "avatars": 512 KB cap, jpeg/png/webp only (no SVG, no executables). Files live at <user_id>/<random>.webp.
--    Public means a photo can be fetched by anyone who has its exact URL; names are random and the URL is only ever shown on a
--    profile the person made public. (A private bucket with signed URLs is possible but needs a server round-trip per image.)
--  * Each person can add, replace and delete ONLY objects in their own folder. Nobody can list or write another folder.
--  * profiles.avatar_url is stored as "avatars/<user_id>/<file>" (the constraint added in migration 0007 already demands this
--    shape, so a profile cannot point at someone else's file or an external tracking URL). That constraint was created NOT VALID;
--    with 0 rows holding an avatar it is safe to validate now.
-- The browser crops and re-encodes the picture to 512x512 WebP before upload (strips metadata); the bucket limits are the server-side backstop.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: add to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: list own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.profiles validate constraint profiles_avatar_own_folder;

-- Revert (safe while no photos exist):
--   drop policy "avatars: add to own folder" on storage.objects; drop policy "avatars: replace own" on storage.objects;
--   drop policy "avatars: delete own" on storage.objects; drop policy "avatars: list own" on storage.objects;
--   delete from storage.buckets where id = 'avatars';   -- Supabase requires the bucket be empty
