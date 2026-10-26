import { isSlug, isUuid, normalizeQuery } from "./query";
import type { ArtistSummary, CatalogRepo, Genre, ReleaseSummary, TrackItem } from "./types";

/**
 * SAMPLE DATA for local previews and screenshots ONLY (CATALOG_SOURCE=sample). Obviously fictional names, no audio,
 * no artwork. The UI shows a permanent "sample data" banner whenever this source is active.
 */
const A: ArtistSummary[] = [
  { id: "a0000000-0000-4000-8000-000000000001", slug: "sample-artist-one", name: "Sample Artist One" },
  { id: "a0000000-0000-4000-8000-000000000002", slug: "sample-artist-two", name: "Sample Artist Two" },
];
const G: Genre[] = [{ slug: "afrobeats", name: "Afrobeats" }, { slug: "hiplife", name: "Hiplife" }, { slug: "gospel", name: "Gospel" }];
const R: (ReleaseSummary & { genre: Genre; tracks: TrackItem[] })[] = [
  { id: "b0000000-0000-4000-8000-000000000001", title: "Sample Album Alpha", type: "album", publishedAt: "2026-10-20T00:00:00Z", artist: A[0]!, genre: G[0]!,
    tracks: [1, 2, 3].map((n) => ({ id: `c0000000-0000-4000-8000-00000000000${n}`, title: `Sample Track ${n}`, trackNumber: n, durationMs: 180000 + n * 12000, explicit: false, audioReady: false })) },
  { id: "b0000000-0000-4000-8000-000000000002", title: "Sample Single Beta", type: "single", publishedAt: "2026-10-18T00:00:00Z", artist: A[1]!, genre: G[1]!,
    tracks: [{ id: "c0000000-0000-4000-8000-000000000004", title: "Sample Single Beta", trackNumber: 1, durationMs: 201000, explicit: true, audioReady: false }] },
];
const summary = (r: (typeof R)[number]): ReleaseSummary => ({ id: r.id, title: r.title, type: r.type, publishedAt: r.publishedAt, artist: r.artist });
const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const nf = { status: "not_found" as const };

export function createSampleCatalog(): CatalogRepo {
  return {
    source: "sample",
    async newReleases(limit) { return ok(R.slice(0, limit).map(summary)); },
    async genres() { return ok(G); },
    async genre(slug) {
      const genre = isSlug(slug) ? G.find((g) => g.slug === slug) : undefined;
      return genre ? ok({ genre, releases: R.filter((r) => r.genre.slug === slug).map(summary) }) : nf;
    },
    async artist(slug) {
      const a = isSlug(slug) ? A.find((x) => x.slug === slug) : undefined;
      return a ? ok({ artist: { ...a, bio: "Sample biography. This artist does not exist.", artistType: null, country: null, hometown: null, links: [], verified: false, imagePath: null, headerPath: null, featuredReleaseId: null }, releases: R.filter((r) => r.artist.id === a.id).map(summary) }) : nf;
    },
    async release(id) {
      const r = isUuid(id) ? R.find((x) => x.id === id) : undefined;
      return r ? ok({ release: { ...summary(r), language: "en", genre: r.genre }, tracks: r.tracks }) : nf;
    },
    async track(id) {
      if (!isUuid(id)) return nf;
      for (const r of R) {
        const t = r.tracks.find((x) => x.id === id);
        if (t) return ok({ track: { ...t, genre: r.genre }, release: summary(r), credits: [{ name: r.artist.name, role: "Performer" }] });
      }
      return nf;
    },
    async search(raw) {
      const q = normalizeQuery(raw)?.toLowerCase();
      if (!q) return ok({ artists: [], releases: [], tracks: [] });
      return ok({
        artists: A.filter((a) => a.name.toLowerCase().includes(q)),
        releases: R.filter((r) => r.title.toLowerCase().includes(q)).map(summary),
        tracks: R.flatMap((r) => r.tracks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ id: t.id, title: t.title, release: summary(r) }))),
      });
    },
  };
}
