import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { escapeLike, formatDuration, isSlug, isUuid, likePattern, normalizeQuery, placeholderHues } from "@/lib/catalog/query";
import { createSampleCatalog } from "@/lib/catalog/sample-repo";
import { createSupabaseCatalog } from "@/lib/catalog/supabase-repo";

/** Minimal recording stand-in for the supabase-js query builder. */
function fakeDb(respond: (table: string, calls: [string, unknown[]][]) => { data: unknown; error: unknown }) {
  const log: { table: string; calls: [string, unknown[]][] }[] = [];
  const db = {
    from(table: string) {
      const entry = { table, calls: [] as [string, unknown[]][] };
      log.push(entry);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "ilike", "order", "limit", "or"]) b[m] = (...a: unknown[]) => (entry.calls.push([m, a]), b);
      b.maybeSingle = () => Promise.resolve(respond(table, entry.calls));
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(table, entry.calls)).then(res, rej);
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, log };
}
const art = { id: "11111111-1111-4111-8111-111111111111", slug: "a-b", name: "A B" };
const ID = "22222222-2222-4222-8222-222222222222";

describe("catalog input helpers", () => {
  it("validates ids and slugs strictly", () => {
    expect(isUuid(ID)).toBe(true);
    for (const bad of ["", "abc", `${ID}'`, "../x", 5, null]) expect(isUuid(bad)).toBe(false);
    expect(isSlug("sample-artist-1")).toBe(true);
    for (const bad of ["Bad Slug", "a/b", "-x", "x-", "a--b", "x".repeat(101), "a,b"]) expect(isSlug(bad)).toBe(false);
  });
  it("normalizes search text: trims, collapses, strips control chars, caps length, enforces a minimum", () => {
    expect(normalizeQuery("  hello   world ")).toBe("hello world");
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery(["x"])).toBeNull();
    expect(normalizeQuery("ab\u0000c\n")).toBe("ab c");
    expect(normalizeQuery("x".repeat(500))?.length).toBe(60);
  });
  it("escapes LIKE wildcards so input is matched literally", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
    expect(likePattern("a%b")).toBe("%a\\%b%");
  });
  it("formats durations and handles missing values", () => {
    expect(formatDuration(201000)).toBe("3:21");
    expect(formatDuration(59999)).toBe("1:00");
    for (const v of [null, -5, Number.NaN]) expect(formatDuration(v as number | null)).toBe("–:––");
  });
  it("derives stable placeholder artwork from the id", () => {
    expect(placeholderHues(ID)).toEqual(placeholderHues(ID));
    expect(placeholderHues(ID)).not.toEqual(placeholderHues("33333333-3333-4333-8333-333333333333"));
  });
});

describe("supabase catalog repo", () => {
  it("never selects audio path columns and only asks for published releases", async () => {
    const { db, log } = fakeDb((t) => ({ data: t === "releases" ? [] : [], error: null }));
    const repo = createSupabaseCatalog(db);
    await repo.newReleases(10);
    const rel = log.find((l) => l.table === "releases")!;
    expect(rel.calls).toContainEqual(["eq", ["status", "published"]]);
    // Release listings must join the artist with !inner so a release of a non-visible artist disappears.
    expect(JSON.stringify(rel.calls)).toContain("artists!inner");
    log.length = 0;
    await repo.release(ID);
    await repo.track(ID);
    for (const l of log) expect(JSON.stringify(l.calls)).not.toMatch(/audio_(low_|std_)?path|select\("\*"\)/);
  });
  it("rejects malformed ids/slugs as not_found WITHOUT querying the database", async () => {
    const { db, log } = fakeDb(() => ({ data: null, error: null }));
    const repo = createSupabaseCatalog(db);
    expect(await repo.release("nope")).toEqual({ status: "not_found" });
    expect(await repo.track("x'; drop table tracks;--")).toEqual({ status: "not_found" });
    expect(await repo.artist("Bad Slug")).toEqual({ status: "not_found" });
    expect(await repo.genre("a,b")).toEqual({ status: "not_found" });
    expect(log).toHaveLength(0);
  });
  it("search uses escaped ilike patterns on three tables, never a raw filter string, and skips short queries", async () => {
    const { db, log } = fakeDb(() => ({ data: [], error: null }));
    const repo = createSupabaseCatalog(db);
    expect(await repo.search("a")).toEqual({ status: "ok", data: { artists: [], releases: [], tracks: [] } });
    expect(log).toHaveLength(0);
    await repo.search("50%,or(id.eq.1)");
    expect(log.map((l) => l.table).sort()).toEqual(["artists", "releases", "tracks"]);
    for (const l of log) {
      expect(l.calls.some(([m]) => m === "or")).toBe(false);
      const ilike = l.calls.find(([m]) => m === "ilike")!;
      expect(ilike[1]).toEqual([expect.any(String), "%50\\%,or(id.eq.1)%"]);
    }
  });
  it("returns error (not empty) when the database fails, and not_found when nothing is visible", async () => {
    const bad = createSupabaseCatalog(fakeDb(() => ({ data: null, error: { message: "boom" } })).db);
    expect(await bad.newReleases(5)).toEqual({ status: "error" });
    expect(await bad.search("hello")).toEqual({ status: "error" });
    const empty = createSupabaseCatalog(fakeDb(() => ({ data: null, error: null })).db);
    expect(await empty.release(ID)).toEqual({ status: "not_found" });
    expect(await empty.artist("a-b")).toEqual({ status: "not_found" });
  });
  it("drops releases whose artist is not visible and a track whose release is not published", async () => {
    const rel = { id: ID, title: "T", type: "single", published_at: null };
    const repo = createSupabaseCatalog(fakeDb(() => ({ data: [{ ...rel, artists: art }, { ...rel, id: "x", artists: null }], error: null })).db);
    const r = await repo.newReleases(10);
    expect(r.status === "ok" && r.data.map((x) => x.id)).toEqual([ID]);
    const t = createSupabaseCatalog(fakeDb(() => ({ data: { id: ID, title: "t", releases: { ...rel, status: "removed", artists: art } }, error: null })).db);
    expect(await t.track(ID)).toEqual({ status: "not_found" });
  });
  it("flags tracks without processed audio so the UI can say so", async () => {
    const repo = createSupabaseCatalog(fakeDb((t) => (t === "releases"
      ? { data: { id: ID, title: "R", type: "album", published_at: null, language: "en", genres: null, artists: art }, error: null }
      : { data: [{ id: "t1", title: "One", track_number: 1, duration_ms: 1000, explicit: false, processing_status: "pending" }, { id: "t2", title: "Two", track_number: 2, duration_ms: 1000, explicit: true, processing_status: "ready" }], error: null })).db);
    const r = await repo.release(ID);
    expect(r.status === "ok" && r.data.tracks.map((t) => t.audioReady)).toEqual([false, true]);
  });
});

describe("sample catalog (preview-only source)", () => {
  const s = createSampleCatalog();
  it("is labelled as sample and honours the same contract", async () => {
    expect(s.source).toBe("sample");
    const n = await s.newReleases(5);
    expect(n.status === "ok" && n.data.length).toBeGreaterThan(0);
    expect(await s.release("bad")).toEqual({ status: "not_found" });
    const hit = await s.search("sample");
    expect(hit.status === "ok" && hit.data.artists.length).toBeGreaterThan(0);
    expect(await s.search("zzzz-nothing")).toEqual({ status: "ok", data: { artists: [], releases: [], tracks: [] } });
  });
});
