import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseCatalog } from "@/lib/catalog/supabase-repo";
import type { CatalogRepo } from "@/lib/catalog/types";
import { ADMIN_URL, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, goLive, makeAdmin, query, superuser, type TestDb } from "../db/helpers";

/**
 * Drives the REAL catalog repo (src/lib/catalog/supabase-repo.ts) through a REAL PostgREST server over the migrated
 * database, as the anonymous role. This is what Supabase does in production, so embeds (`artists!inner`, `genres`),
 * filters and column grants are exercised for real, not against a stub.
 * Needs the PostgREST binary: `scripts/fetch-postgrest.sh` (or POSTGREST_BIN). Skipped when it is not available.
 */
const BIN = process.env.POSTGREST_BIN ?? ".tools/postgrest/postgrest";
const available = existsSync(BIN);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (secret: string, claims: object) => {
  const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${h}.${createHmac("sha256", secret).update(h).digest("base64url")}`;
};

describe.skipIf(!available)("catalog repo through PostgREST (anonymous visitor)", () => {
  let db: TestDb;
  let proc: ChildProcess;
  let repo: CatalogRepo;
  let base: string;
  const secret = randomBytes(32).toString("hex");
  let live: Awaited<ReturnType<typeof goLive>>;
  let draftReleaseId: string;
  let suspended: Awaited<ReturnType<typeof goLive>>;

  beforeAll(async () => {
    db = await createTestDb();
    const admin = await makeAdmin(db.pool);
    live = await goLive(db.pool, admin, "pgrst-live");
    suspended = await goLive(db.pool, admin, "pgrst-susp");
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [suspended.artistId]);
    const owner = await createUser(db.pool, "pgrst-draft");
    const artist = await createApprovedArtist(db.pool, admin, owner, "Draft Artist");
    draftReleaseId = await createDraftRelease(db.pool, owner, artist, "Hidden Draft");
    await createTrack(db.pool, owner, artist, draftReleaseId, "Hidden Draft Track");
    await declareRights(db.pool, owner, draftReleaseId);
    // genre on the live release so the `genres(...)` embed is exercised
    await query(db.pool, superuser, "update public.releases set genre_id = (select id from public.genres order by slug limit 1) where id = $1", [live.releaseId]);

    const dbName = (await db.pool.query<{ n: string }>("select current_database() n")).rows[0]!.n;
    const root = new Client({ connectionString: ADMIN_URL });
    await root.connect();
    await root.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$`);
    await root.query("grant anon, authenticated, service_role to authenticator");
    await root.end();

    const port = 33000 + Math.floor(Math.random() * 2000);
    base = `http://127.0.0.1:${port}`;
    const u = new URL(ADMIN_URL);
    proc = spawn(BIN, [], {
      env: {
        PATH: process.env.PATH ?? "",
        PGRST_DB_URI: `postgres://authenticator@${u.hostname}:${u.port}/${dbName}`,
        PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: secret,
        PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(port),
      } as unknown as NodeJS.ProcessEnv,
      stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    repo = createSupabaseCatalog(new PostgrestClient(base) as unknown as SupabaseClient);
  }, 60_000);

  afterAll(async () => {
    proc?.kill();
    await db?.drop();
  });

  it("lists only published releases of approved artists", async () => {
    const r = await repo.newReleases(50);
    expect(r.status).toBe("ok");
    const ids = r.status === "ok" ? r.data.map((x) => x.id) : [];
    expect(ids).toContain(live.releaseId);
    expect(ids).not.toContain(draftReleaseId);
    expect(ids).not.toContain(suspended.releaseId);
  });

  it("release page: artist + genre embeds resolve, and tracks come back without audio paths", async () => {
    const r = await repo.release(live.releaseId);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.release.artist.slug).toBeTruthy();
    expect(r.data.release.genre).not.toBeNull();
    expect(r.data.tracks).toHaveLength(1);
    expect(JSON.stringify(r.data)).not.toMatch(/audio_|storage_key|\/std\.m4a/);
    expect(r.data.tracks[0]!.audioReady).toBe(true);
  });

  it("track page works through the double-FK genre embed, and credits load", async () => {
    const r = await repo.track(live.trackId);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.data.release.id).toBe(live.releaseId);
  });

  it("not_found (never an error, never data) for draft, suspended-artist and unknown ids", async () => {
    for (const id of [draftReleaseId, suspended.releaseId, "00000000-0000-4000-8000-000000000000"]) {
      expect(await repo.release(id), `release ${id}`).toEqual({ status: "not_found" });
    }
    expect(await repo.track(suspended.trackId)).toEqual({ status: "not_found" });
    expect(await repo.artist("no-such-artist")).toEqual({ status: "not_found" });
  });

  it("artist and genre pages", async () => {
    const a = await db.pool.query<{ slug: string }>("select slug from public.artists where id = $1", [live.artistId]);
    const page = await repo.artist(a.rows[0]!.slug);
    expect(page.status === "ok" && page.data.releases.map((x) => x.id)).toEqual([live.releaseId]);
    const s = await db.pool.query<{ slug: string }>("select slug from public.artists where id = $1", [suspended.artistId]);
    expect(await repo.artist(s.rows[0]!.slug)).toEqual({ status: "not_found" });
    const g = await repo.genres();
    expect(g.status === "ok" && g.data.length).toBeGreaterThan(0);
  });

  it("search finds published items, hides unpublished/suspended, and treats wildcards literally", async () => {
    const hit = await repo.search("pgrst-live");
    expect(hit.status).toBe("ok");
    if (hit.status === "ok") {
      expect(hit.data.releases.map((x) => x.id)).toContain(live.releaseId);
      expect(hit.data.tracks.map((x) => x.id)).toContain(live.trackId);
      expect(hit.data.artists.length).toBeGreaterThan(0);
    }
    for (const q of ["Hidden Draft", "pgrst-susp"]) {
      const r = await repo.search(q);
      expect(r.status === "ok" && r.data.artists.length + r.data.releases.length + r.data.tracks.length, q).toBe(0);
    }
    for (const q of ["%%", "__", "\\\\", "a%b", "x,or(id.eq.1)", "')--"]) {
      const r = await repo.search(q);
      expect(r.status, q).toBe("ok");
      expect(r.status === "ok" && r.data.releases.length + r.data.tracks.length, q).toBe(0);
    }
  });

  it("direct API access cannot read audio paths or draft data", async () => {
    const asAnon = await fetch(`${base}/tracks?select=audio_std_path&id=eq.${live.trackId}`);
    expect(asAnon.status).toBeGreaterThanOrEqual(400);
    expect(await asAnon.text()).not.toContain("std.m4a");
    const star = await fetch(`${base}/tracks?select=*`);
    expect(star.status).toBeGreaterThanOrEqual(400);
    const drafts = await (await fetch(`${base}/releases?status=eq.draft&select=id`)).json();
    expect(drafts).toEqual([]);
    const rights = await fetch(`${base}/rights_records?select=id`);
    expect(rights.status).toBeGreaterThanOrEqual(400);
    const rpc = await fetch(`${base}/rpc/get_playback_target`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_track: live.trackId, p_country: "LR" }) });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
  });

  it("moved helpers are not API functions; anon cannot read artists.owner_id but can read public columns", async () => {
    for (const fn of ["is_admin", "owns_artist"]) {
      const r = await fetch(`${base}/rpc/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(r.status, fn).toBe(404);
    }
    expect((await fetch(`${base}/artists?select=owner_id`)).status).toBeGreaterThanOrEqual(400);
    const ok = await fetch(`${base}/artists?select=id,slug,name&id=eq.${live.artistId}`);
    expect(await ok.json()).toHaveLength(1);
  });

  it("a signed-in owner (JWT) sees their own draft that anon cannot", async () => {
    const owner = await db.pool.query<{ id: string }>("select owner_id id from public.artists where id = (select artist_id from public.releases where id = $1)", [draftReleaseId]);
    const token = jwt(secret, { role: "authenticated", sub: owner.rows[0]!.id });
    const res = await fetch(`${base}/releases?id=eq.${draftReleaseId}&select=id,status`, { headers: { authorization: `Bearer ${token}` } });
    expect(await res.json()).toEqual([{ id: draftReleaseId, status: "draft" }]);
  });
});
