import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/media/storage";
import { runOnce } from "@/lib/worker/pipeline";
import { LocalFfmpegWorker } from "@/lib/worker/local-ffmpeg";
import { createSupabaseJobStore } from "@/lib/worker/supabase-store";
import { ADMIN_URL, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, makeAdmin, query, user, type TestDb } from "../db/helpers";

/**
 * The whole audio pipeline against a REAL PostgREST server over the migrated database: the service-role RPCs the worker
 * uses (claim / complete / fail), the artist-facing job status through RLS, and the playback gate that finally lets the
 * rendition out. Storage is local disk and FFmpeg is real. Skipped when the PostgREST binary is not available.
 */
const BIN = process.env.POSTGREST_BIN ?? ".tools/postgrest/postgrest";
const available = existsSync(BIN);
const SAMPLE = path.resolve(__dirname, "../../fixtures/sample/sample-tone-440hz.wav");

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (secret: string, claims: object) => {
  const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${h}.${createHmac("sha256", secret).update(h).digest("base64url")}`;
};

describe.skipIf(!available)("audio pipeline through PostgREST", () => {
  let db: TestDb;
  let proc: ChildProcess;
  let tmp: string;
  let storage: LocalStorage;
  let admin: string;
  let base: string;
  const secret = randomBytes(32).toString("hex");
  const worker = new LocalFfmpegWorker();

  const asService = () => new PostgrestClient(base, { headers: { Authorization: `Bearer ${jwt(secret, { role: "service_role" })}` } });
  const asUser = (uid: string) => new PostgrestClient(base, { headers: { Authorization: `Bearer ${jwt(secret, { role: "authenticated", sub: uid })}` } });

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "emerg-e2e-"));
    storage = new LocalStorage(path.join(tmp, "store"));
    db = await createTestDb();
    admin = await makeAdmin(db.pool);

    const dbName = (await db.pool.query<{ n: string }>("select current_database() n")).rows[0]!.n;
    const root = new Client({ connectionString: ADMIN_URL });
    await root.connect();
    await root.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$`);
    await root.query("grant anon, authenticated, service_role to authenticator");
    await root.end();

    const port = 35000 + Math.floor(Math.random() * 2000);
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
  }, 60_000);

  afterAll(async () => {
    proc?.kill();
    await db?.drop();
    await rm(tmp, { recursive: true, force: true });
  });

  async function publishedTrack(label: string) {
    const owner = await createUser(db.pool, `${label}-owner`);
    const artist = await createApprovedArtist(db.pool, admin, owner, `${label} artist`);
    const release = await createDraftRelease(db.pool, owner, artist);
    const track = await createTrack(db.pool, owner, artist, release);
    const rights = await declareRights(db.pool, owner, release);
    await query(db.pool, user(owner), "update public.releases set status = 'in_review' where id = $1", [release]);
    await query(db.pool, user(admin), "select public.review_rights_record($1, 'approved', null)", [rights]);
    await query(db.pool, user(admin), "select public.moderate_release($1, 'published', null)", [release]);
    return { owner, artist, release, track, originalKey: `audio/${artist}/${track}/original.wav` };
  }
  const store = () => createSupabaseJobStore(asService() as unknown as SupabaseClient);
  const drain = () => runOnce({ storage, worker, store: store(), tmpRoot: tmp });
  async function enqueue(track: string) {
    const r = await asService().rpc("enqueue_processing_job", { p_track: track });
    expect(r.error).toBeNull();
    return r;
  }

  it("upload -> queued -> processed -> ready -> playable, with the artist seeing each state", async () => {
    const t = await publishedTrack("e2e-ok");
    await storage.put("originals", t.originalKey, createReadStream(SAMPLE), { maxBytes: 50_000_000 });

    // the track was marked ready only so the release could be submitted; queueing a fresh upload resets it to pending
    const gate = (country = "LR") => asService().rpc("get_playback_target", { p_track: t.track, p_country: country, p_low: false });
    await enqueue(t.track);
    // before processing: published but NOT playable (track not ready)
    expect((await gate()).data).toEqual([]);
    const queued = await asUser(t.owner).from("processing_jobs").select("status, error_code").eq("track_id", t.track);
    expect(queued.data).toEqual([{ status: "queued", error_code: null }]);

    // the artist cannot see the storage key
    const peek = await asUser(t.owner).from("processing_jobs").select("original_key").eq("track_id", t.track);
    expect(peek.error?.message).toMatch(/permission denied/);

    // drain the shared queue until this track is done (other tests may have queued jobs)
    let outcome = await drain();
    for (let i = 0; i < 5 && outcome === "idle"; i++) outcome = await drain();
    expect(outcome).toBe("succeeded");

    const done = await asUser(t.owner).from("processing_jobs").select("status, attempts").eq("track_id", t.track);
    expect(done.data).toEqual([{ status: "succeeded", attempts: 1 }]);

    const target = (await gate()).data as Array<{ variant: string; storage_key: string; duration_ms: number }>;
    expect(target).toHaveLength(1);
    expect(target[0]!.storage_key).toMatch(new RegExp(`^audio/${t.artist}/${t.track}/std-`));
    expect(target[0]!.duration_ms).toBeGreaterThan(1900);
    expect(await storage.stat("renditions", target[0]!.storage_key)).not.toBeNull();
    expect(await storage.stat("originals", target[0]!.storage_key)).toBeNull();

    // low-bandwidth listeners get the low rendition
    const low = (await gate("LR")).data as Array<{ variant: string }>;
    expect(low[0]!.variant).toBe("std");
    const lowReq = (await asService().rpc("get_playback_target", { p_track: t.track, p_country: "LR", p_low: true })).data as Array<{ variant: string; storage_key: string }>;
    expect(lowReq[0]!.variant).toBe("low");
    expect(lowReq[0]!.storage_key).toMatch(/\/low-/);
  });

  it("a fake audio file fails with a safe message the artist can read, and never becomes playable", async () => {
    const t = await publishedTrack("e2e-bad");
    const bad = path.join(tmp, "bad.wav");
    await writeFile(bad, "not audio\n".repeat(200));
    await storage.put("originals", t.originalKey, createReadStream(bad), { maxBytes: 50_000_000 });
    await enqueue(t.track);
    let outcome = await drain();
    for (let i = 0; i < 5 && outcome === "idle"; i++) outcome = await drain();
    expect(outcome).toBe("failed");

    const seen = await asUser(t.owner).from("processing_jobs").select("status, error_code, error_message").eq("track_id", t.track);
    expect(seen.data).toEqual([{ status: "failed", error_code: "unreadable", error_message: "We could not read this file as audio. Export it again and upload a WAV, FLAC, MP3, or M4A file." }]);
    expect((await asService().rpc("get_playback_target", { p_track: t.track, p_country: "LR", p_low: false })).data).toEqual([]);
  });

  it("listeners and other artists cannot read jobs or call the worker functions over HTTP", async () => {
    const t = await publishedTrack("e2e-priv");
    await enqueue(t.track);
    const stranger = await createUser(db.pool, "e2e-stranger");
    expect((await asUser(stranger).from("processing_jobs").select("id").eq("track_id", t.track)).data).toEqual([]);
    for (const c of [new PostgrestClient(base), asUser(stranger), asUser(t.owner)]) {
      expect((await c.rpc("claim_processing_job", { p_lease_seconds: 60 })).error?.message).toMatch(/permission denied|not allowed|Could not find/i);
      expect((await c.rpc("enqueue_processing_job", { p_track: t.track })).error).not.toBeNull();
    }
  });
});
