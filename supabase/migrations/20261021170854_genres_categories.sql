create table public.genre_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort int not null default 0
);
create table public.genres (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.genre_categories(id) on delete restrict,
  slug text not null unique,
  name text not null,
  sort int not null default 0
);
alter table public.genre_categories enable row level security;
alter table public.genres enable row level security;
create policy "categories: public read" on public.genre_categories for select to anon, authenticated using (true);
create policy "genres: public read" on public.genres for select to anon, authenticated using (true);
grant select on public.genre_categories, public.genres to anon, authenticated;

alter table public.tracks add column genre_id uuid references public.genres(id);
alter table public.tracks add column secondary_genre_id uuid references public.genres(id);
create index tracks_genre_idx on public.tracks(genre_id);
alter table public.tracks add constraint tracks_genre_required check (genre_id is not null) not valid;
alter table public.tracks add constraint tracks_secondary_differs check (secondary_genre_id is null or secondary_genre_id <> genre_id);

alter table public.releases add constraint releases_cover_own_folder
  check (cover_path is null or cover_path like 'covers/' || artist_id::text || '/' || id::text || '/%');
alter table public.artists add constraint artists_image_own_folder
  check (image_url is null or image_url like 'artists/' || id::text || '/%');

with c as (
  insert into public.genre_categories (slug, name, sort) values
    ('urban', 'Urban & Hip-Hop', 1), ('afro-pop', 'Afro & Pop', 2), ('soul-rnb', 'Soul & R&B', 3),
    ('reggae-dancehall', 'Reggae & Dancehall', 4), ('gospel', 'Gospel & Worship', 5),
    ('traditional', 'Traditional & Roots', 6), ('jazz', 'Jazz & Instrumental', 7)
  returning id, slug
)
insert into public.genres (category_id, slug, name, sort)
select c.id, g.slug, g.name, g.sort from c join (values
  ('urban','hipco','Hipco',1), ('urban','kolokwa-rap','Kolokwa Rap',2), ('urban','hip-hop','Hip-Hop',3), ('urban','trap','Trap',4), ('urban','drill','Drill',5),
  ('afro-pop','afrobeats','Afrobeats',1), ('afro-pop','afro-pop','Afro-pop',2), ('afro-pop','amapiano','Amapiano',3), ('afro-pop','pop','Pop',4),
  ('soul-rnb','rnb','R&B',1), ('soul-rnb','soul','Soul',2), ('soul-rnb','neo-soul','Neo-soul',3),
  ('reggae-dancehall','reggae','Reggae',1), ('reggae-dancehall','dancehall','Dancehall',2), ('reggae-dancehall','dub','Dub',3),
  ('gospel','gospel','Gospel',1), ('gospel','worship','Worship',2), ('gospel','choir','Choir',3),
  ('traditional','highlife','Highlife',1), ('traditional','palm-wine','Palm-wine',2), ('traditional','folk','Folk',3), ('traditional','cultural','Cultural',4),
  ('jazz','jazz','Jazz',1), ('jazz','instrumental','Instrumental',2), ('jazz','beats','Beats',3)
) as g(cat, slug, name, sort) on g.cat = c.slug;
