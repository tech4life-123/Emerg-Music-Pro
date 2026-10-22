import type { SupabaseClient } from "@supabase/supabase-js";
import { isSlug, isUuid, likePattern, normalizeQuery } from "./query";
import type {
  ArtistSummary, CatalogRepo, Credit, Genre, ReleaseSummary, Result, SearchHit, TrackItem,
} from "./types";

// Explicit column lists on purpose: audio_path / audio_low_path / audio_std_path are NOT granted to clients,
// so `select *` on tracks would (correctly) fail.
const ARTIST_COLS = "id,slug,name";
const RELEASE_COLS = `id,title,type,published_at,artists!inner(${ARTIST_COLS})`;
const TRACK_COLS = "id,title,track_number,duration_ms,explicit,processing_status,genre_id";

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const err = <T,>(): Result<T> => ({ status: "error" });
const ok = <T,>(data: T): Result<T> => ({ status: "ok", data });
const notFound = <T,>(): Result<T> => ({ status: "not_found" });

function artist(r: Row | null): ArtistSummary | null {
  return r ? { id: String(r.id), slug: String(r.slug), name: String(r.name) } : null;
}
function release(r: Row): ReleaseSummary | null {
  const a = artist(one(r.artists as Row | Row[] | null));
  if (!a) return null; // artist not visible (e.g. suspended): the release is not publicly discoverable either
  return { id: String(r.id), title: String(r.title), type: String(r.type), publishedAt: (r.published_at as string | null) ?? null, artist: a };
}
const releases = (rows: Row[] | null): ReleaseSummary[] => (rows ?? []).map(release).filter((x): x is ReleaseSummary => x !== null);
function track(r: Row): TrackItem {
  return {
    id: String(r.id), title: String(r.title), trackNumber: (r.track_number as number | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null, explicit: Boolean(r.explicit), audioReady: r.processing_status === "ready",
  };
}
const genreOf = (r: Row | null): Genre | null => (r ? { slug: String(r.slug), name: String(r.name) } : null);

/** Catalog over Supabase using the caller's (anon or signed-in) session: Row Level Security is the boundary. */
export function createSupabaseCatalog(db: SupabaseClient): CatalogRepo {
  return {
    source: "supabase",

    async newReleases(limit) {
      const { data, error } = await db.from("releases").select(RELEASE_COLS).eq("status", "published")
        .order("published_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 60));
      return error ? err() : ok(releases(data as Row[]));
    },

    async genres() {
      const { data, error } = await db.from("genres").select("slug,name").order("sort", { ascending: true });
      return error ? err() : ok((data ?? []).map((g) => genreOf(g as Row)!));
    },

    async genre(slug) {
      if (!isSlug(slug)) return notFound();
      const { data: g, error } = await db.from("genres").select("id,slug,name").eq("slug", slug).maybeSingle();
      if (error) return err();
      if (!g) return notFound();
      const { data, error: e2 } = await db.from("releases").select(RELEASE_COLS).eq("status", "published").eq("genre_id", g.id)
        .order("published_at", { ascending: false }).limit(60);
      return e2 ? err() : ok({ genre: genreOf(g as Row)!, releases: releases(data as Row[]) });
    },

    async artist(slug) {
      if (!isSlug(slug)) return notFound();
      const { data: a, error } = await db.from("artists").select("id,slug,name,bio").eq("slug", slug).eq("status", "approved").maybeSingle();
      if (error) return err();
      if (!a) return notFound();
      const { data, error: e2 } = await db.from("releases").select(RELEASE_COLS).eq("status", "published").eq("artist_id", a.id)
        .order("published_at", { ascending: false });
      if (e2) return err();
      return ok({ artist: { ...artist(a as Row)!, bio: (a.bio as string | null) ?? null }, releases: releases(data as Row[]) });
    },

    async release(id) {
      if (!isUuid(id)) return notFound();
      const { data: r, error } = await db.from("releases")
        .select(`id,title,type,published_at,language,genres(slug,name),artists!inner(${ARTIST_COLS})`)
        .eq("id", id).eq("status", "published").maybeSingle();
      if (error) return err();
      if (!r) return notFound();
      const base = release(r as Row);
      if (!base) return notFound();
      const { data: t, error: e2 } = await db.from("tracks").select(TRACK_COLS).eq("release_id", id).order("track_number", { ascending: true });
      if (e2) return err();
      return ok({
        release: { ...base, language: ((r as Row).language as string | null) ?? null, genre: genreOf(one((r as Row).genres as Row | Row[] | null)) },
        tracks: (t ?? []).map((x) => track(x as Row)),
      });
    },

    async track(id) {
      if (!isUuid(id)) return notFound();
      const { data: t, error } = await db.from("tracks")
        .select(`${TRACK_COLS},genres:genre_id(slug,name),releases!inner(id,title,type,published_at,status,artists!inner(${ARTIST_COLS}))`)
        .eq("id", id).maybeSingle();
      if (error) return err();
      if (!t) return notFound();
      const rel = one((t as Row).releases as Row | Row[] | null);
      if (!rel || rel.status !== "published") return notFound();
      const rs = release(rel);
      if (!rs) return notFound();
      const { data: c, error: e2 } = await db.from("track_credits").select("name,role").eq("track_id", id).order("created_at");
      if (e2) return err();
      const credits: Credit[] = (c ?? []).map((x) => ({ name: String(x.name), role: String(x.role) }));
      return ok({ track: { ...track(t as Row), genre: genreOf(one((t as Row).genres as Row | Row[] | null)) }, release: rs, credits });
    },

    async search(raw) {
      const q = normalizeQuery(raw);
      if (!q) return ok({ artists: [], releases: [], tracks: [] } satisfies SearchHit);
      const pat = likePattern(q);
      const [a, r, t] = await Promise.all([
        db.from("artists").select(ARTIST_COLS).eq("status", "approved").ilike("name", pat).limit(10),
        db.from("releases").select(RELEASE_COLS).eq("status", "published").ilike("title", pat).limit(20),
        db.from("tracks").select(`id,title,releases!inner(id,title,type,published_at,status,artists!inner(${ARTIST_COLS}))`)
          .eq("releases.status", "published").ilike("title", pat).limit(20),
      ]);
      if (a.error || r.error || t.error) return err();
      const tracks = (t.data as Row[]).flatMap((x) => {
        const rs = release(one(x.releases as Row | Row[] | null) ?? {});
        return rs ? [{ id: String(x.id), title: String(x.title), release: rs }] : [];
      });
      return ok({ artists: (a.data as Row[]).map((x) => artist(x)!), releases: releases(r.data as Row[]), tracks });
    },
  };
}
