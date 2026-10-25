/**
 * Runs the whole app against a LOCAL stack, with no Supabase or Cloudflare account and $0 cost:
 *   local Postgres (the real migrations) -> PostgREST (the HTTP layer Supabase uses) -> a tiny /rest/v1 shim -> Next.js
 * and seeds ONE published release with fictional placeholder tracks (synthesized tones from fixtures/sample) that go through
 * the REAL upload-to-ready pipeline: original in quarantine, ffprobe validation, AAC renditions, rights approved, published.
 *
 * Needs: the local Postgres from tests (see README), `scripts/fetch-postgrest.sh`, ffmpeg.
 *   npx tsx --conditions=react-server scripts/local-stack.ts      # prints the env for `npm run dev`, then keeps running
 *
 * NOT for production: the Supabase shim, the generated JWT secret and the seeded data exist only on this machine.
 * Sign-in uses a TEST-ONLY auth shim (scripts/lib/auth-shim.ts). Seeded accounts (password "preview-password-1"):
 *   admin@preview.test (administrator), artist@preview.test (approved artist who owns the seeded release),
 *   and listener@preview.test / other@preview.test (plain listeners).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { LocalStorage } from "../src/lib/media/storage";
import { LocalFfmpegWorker } from "../src/lib/worker/local-ffmpeg";
import { runOnce } from "../src/lib/worker/pipeline";
import { createSupabaseJobStore } from "../src/lib/worker/supabase-store";
import { ADMIN_URL, createApprovedArtist, createDraftRelease, createUser, declareRights, makeAdmin, query, user, as, superuser } from "../tests/db/helpers";
import { applyMigrations } from "./lib/migrate";
import { createAuthShim } from "./lib/auth-shim";

const ROOT = path.resolve(__dirname, "..");
const BIN = process.env.POSTGREST_BIN ?? path.join(ROOT, ".tools/postgrest/postgrest");
const STATE = path.join(ROOT, ".local-stack");
const DB = "emerg_local";
const PGRST_PORT = Number(process.env.PGRST_PORT ?? 3010);
const API_PORT = Number(process.env.API_PORT ?? 3011);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (secret: string, claims: object) => {
  const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })}`;
  return `${h}.${createHmac("sha256", secret).update(h).digest("base64url")}`;
};

async function main() {
  if (!existsSync(BIN)) throw new Error("PostgREST not found. Run scripts/fetch-postgrest.sh first.");
  await rm(STATE, { recursive: true, force: true });
  await mkdir(STATE, { recursive: true });
  // A synthesized 90 s tone (long enough to seek and navigate while it plays). No copyrighted audio is used anywhere.
  const SAMPLE = path.join(STATE, "tone-90s.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=90:sample_rate=16000", "-ac", "1", SAMPLE]);

  // 1. Fresh database with the real migrations.
  const root = new Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`drop database if exists ${DB} with (force)`);
  await root.query(`create database ${DB}`);
  await root.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end $$`);
  await root.query("grant anon, authenticated, service_role to authenticator");
  await root.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB}`;
  const setup = new Client({ connectionString: u.toString() });
  await setup.connect();
  await applyMigrations(setup, { shim: true });
  await setup.end();

  // 2. PostgREST + the /rest/v1 prefix supabase-js expects.
  const secret = randomBytes(32).toString("hex");
  const pgrst: ChildProcess = spawn(BIN, [], {
    env: {
      PATH: process.env.PATH ?? "",
      PGRST_DB_URI: `postgres://authenticator@${u.hostname}:${u.port}/${DB}`,
      PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(PGRST_PORT),
    } as unknown as NodeJS.ProcessEnv,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${PGRST_PORT}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const authPool = new (await import("pg")).Pool({ connectionString: u.toString(), max: 2 });
  const authShim = createAuthShim({ secret, pool: authPool });
  const api = createServer((req, res) => {
    const target = (req.url ?? "/").replace(/^\/rest\/v1/, "") || "/";
    if (req.url?.startsWith("/auth/")) return void authShim.handle(req, res);
    const up = request({ host: "127.0.0.1", port: PGRST_PORT, path: target, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  }).listen(API_PORT, "127.0.0.1");

  // 3. Seed through the same entry points the app uses, then run the REAL pipeline.
  const pool = (await import("pg")).Pool;
  const db = new pool({ connectionString: u.toString(), max: 3 });
  const admin = await makeAdmin(db);
  const owner = await createUser(db, "preview-artist");
  const artist = await createApprovedArtist(db, admin, owner, "Preview Artist (fictional)");
  const PW = "preview-password-1";
  await query(db, superuser, "update auth.users set email = 'admin@preview.test' where id = $1", [admin]);
  await query(db, superuser, "update auth.users set email = 'artist@preview.test' where id = $1", [owner]);
  authShim.register("admin@preview.test", admin, PW);
  authShim.register("artist@preview.test", owner, PW);
  // Two plain listeners for the Phase 5 library tests (likes, follows, private playlists, cross-user privacy).
  for (const label of ["listener", "other"]) {
    const id = await createUser(db, `preview-${label}`);
    await query(db, superuser, "update auth.users set email = $2 where id = $1", [id, `${label}@preview.test`]);
    authShim.register(`${label}@preview.test`, id, PW);
  }
  const release = await createDraftRelease(db, owner, artist, "Placeholder Tones (sample)");
  const genre = (await query<{ id: string }>(db, superuser, "select id from public.genres order by slug limit 1")).rows[0]!.id;
  await query(db, superuser, "update public.releases set genre_id = $2 where id = $1", [release, genre]);
  const storage = new LocalStorage(path.join(STATE, "storage"));
  const names = ["Tone One", "Tone Two", "Tone Three"];
  const tracks: string[] = [];
  for (const [i, title] of names.entries()) {
    const id = crypto.randomUUID();
    const key = `audio/${artist}/${id}/original-${crypto.randomUUID()}.wav`;
    await as(db, user(owner), (c) => c.query(
      `insert into public.tracks (id, release_id, artist_id, title, track_number, audio_path, genre_id) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, release, artist, title, i + 1, key, genre]));
    await storage.put("originals", key, createReadStream(SAMPLE), { maxBytes: 50_000_000, contentType: "audio/wav" });
    tracks.push(id);
  }
  const serviceKey = jwt(secret, { role: "service_role" });
  const svc = new PostgrestClient(base, { headers: { Authorization: `Bearer ${serviceKey}` } });
  for (const id of tracks) {
    const r = await svc.rpc("enqueue_processing_job", { p_track: id });
    if (r.error) throw new Error(r.error.message);
  }
  const store = createSupabaseJobStore(svc as unknown as SupabaseClient);
  const worker = new LocalFfmpegWorker();
  while ((await runOnce({ storage, worker, store })) !== "idle") { /* drain */ }
  const rights = await declareRights(db, owner, release);
  await query(db, user(owner), "update public.releases set status = 'in_review' where id = $1", [release]);
  await query(db, user(admin), "select public.review_rights_record($1, 'approved', null)", [rights]);
  await query(db, user(admin), "select public.moderate_release($1, 'published', null)", [release]);
  await db.end();

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(secret, { role: "anon" }),
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    MEDIA_SIGNING_SECRET: randomBytes(32).toString("hex"),
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: path.join(STATE, "storage"),
  };
  await writeFile(path.join(STATE, "env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ event: "local_stack_ready", release, tracks, envFile: path.join(STATE, "env") }));

  const stop = () => { pgrst.kill(); api.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
