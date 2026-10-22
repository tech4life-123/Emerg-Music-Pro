import { randomUUID } from "node:crypto";
import { Client, Pool, type PoolClient } from "pg";
import { applyMigrations } from "../../scripts/lib/migrate";

/**
 * Admin connection used to create throwaway databases. Local Postgres only.
 * Override with TEST_DATABASE_URL (must point at a server you are happy to create databases on).
 */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

export type Who =
  | { role: "anon" }
  | { role: "authenticated"; uid: string }
  | { role: "service_role" }
  | { role: "superuser" };

export interface TestDb {
  pool: Pool;
  drop: () => Promise<void>;
}

export async function createTestDb(opts: { upTo?: string } = {}): Promise<TestDb> {
  const name = `emerg_t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const setup = new Client({ connectionString: url.toString() });
  await setup.connect();
  try {
    await applyMigrations(setup, { shim: true, upTo: opts.upTo });
  } finally {
    await setup.end();
  }
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  return {
    pool,
    drop: async () => {
      await pool.end();
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/**
 * Run `fn` inside ONE transaction as the given database role, emulating how Supabase/PostgREST
 * sets `role` and the JWT claims. Commits on success, rolls back (and rethrows) on any error.
 */
export async function as<T>(pool: Pool, who: Who, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (who.role !== "superuser") {
      await c.query(`set local role ${who.role}`);
      await c.query("select set_config('request.jwt.claim.role', $1, true)", [who.role]);
    }
    if (who.role === "authenticated") {
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [who.uid]);
    }
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export const user = (uid: string): Who => ({ role: "authenticated", uid });
export const anon: Who = { role: "anon" };
export const service: Who = { role: "service_role" };
export const superuser: Who = { role: "superuser" };

// ---------- seeding helpers: every step goes through the same entry points the app uses ----------

let cachedGenre: string | undefined;
export async function genreId(pool: Pool): Promise<string> {
  if (!cachedGenre) {
    const r = await as(pool, superuser, (c) => c.query<{ id: string }>("select id from public.genres order by slug limit 1"));
    cachedGenre = r.rows[0]!.id;
  }
  return cachedGenre;
}

export async function createUser(pool: Pool, label: string): Promise<string> {
  const res = await as(pool, superuser, (c) =>
    c.query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
      `${label}-${randomUUID().slice(0, 8)}@example.test`,
      JSON.stringify({ display_name: label }),
    ]),
  );
  return res.rows[0]!.id;
}

/** Bootstrap an admin the only way it is possible: directly as the database owner (SQL editor). */
export async function makeAdmin(pool: Pool, label = "admin"): Promise<string> {
  const id = await createUser(pool, label);
  await as(pool, superuser, (c) => c.query("update public.profiles set role = 'admin' where id = $1", [id]));
  return id;
}

/** Application -> admin approval, exactly like production. Returns the artist id. */
export async function createApprovedArtist(pool: Pool, adminId: string, ownerId: string, name: string): Promise<string> {
  const app = await as(pool, user(ownerId), (c) =>
    c.query<{ id: string }>(
      "insert into public.artist_applications (user_id, artist_name, rights_statement_accepted) values ($1, $2, true) returning id",
      [ownerId, name],
    ),
  );
  const res = await as(pool, user(adminId), (c) =>
    c.query<{ id: string }>("select public.approve_artist_application($1) as id", [app.rows[0]!.id]),
  );
  return res.rows[0]!.id;
}

export async function createDraftRelease(pool: Pool, ownerId: string, artistId: string, title = "Sample Release"): Promise<string> {
  const r = await as(pool, user(ownerId), (c) =>
    c.query<{ id: string }>("insert into public.releases (artist_id, title) values ($1, $2) returning id", [artistId, title]),
  );
  return r.rows[0]!.id;
}

/**
 * Creates a track through the same INSERT an artist would do. By default the track is then marked processed (`ready`) the way the
 * worker would, because a release can only be SUBMITTED once every track is ready. Pass { pending: true } to keep it unprocessed.
 */
export async function createTrack(
  pool: Pool, ownerId: string, artistId: string, releaseId: string, title = "Sample Track", opts: { pending?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  const genre = await genreId(pool);
  await as(pool, user(ownerId), (c) =>
    c.query(
      `insert into public.tracks (id, release_id, artist_id, title, track_number, audio_path, genre_id)
       values ($1, $2, $3, $4, 1, $5, $6)`,
      [id, releaseId, artistId, title, `audio/${artistId}/${id}/original.wav`, genre],
    ),
  );
  if (!opts.pending) await markReady(pool, artistId, id);
  return id;
}

/** What the worker does when it finishes: record renditions and set the track `ready`. */
export async function markReady(pool: Pool, artistId: string, trackId: string): Promise<void> {
  await as(pool, service, (c) =>
    c.query("select public.set_track_audio_variants($1, 'ready', $2, $3, 2000)", [trackId, `audio/${artistId}/${trackId}/low.m4a`, `audio/${artistId}/${trackId}/std.m4a`]),
  );
}

export interface RightsOptions {
  territories?: string[];
  termStart?: string;
  termEnd?: string | null;
}

/** Declaration (existing table) + rights record (new table). Returns the rights record id. */
export async function declareRights(pool: Pool, ownerId: string, releaseId: string, o: RightsOptions = {}): Promise<string> {
  await as(pool, user(ownerId), (c) =>
    c.query("insert into public.rights_declarations (release_id, user_id, statement_version) values ($1, $2, 'v1')", [releaseId, ownerId]),
  );
  const r = await as(pool, user(ownerId), (c) =>
    c.query<{ id: string }>(
      `insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start, term_end)
       values ($1, $2, 'owner', 'Sample Rights Holder (test fixture)', $3, $4, $5) returning id`,
      [releaseId, ownerId, o.territories ?? ["WW"], o.termStart ?? "2020-01-01", o.termEnd ?? null],
    ),
  );
  return r.rows[0]!.id;
}

export const query = <T extends object = Record<string, unknown>>(pool: Pool, who: Who, sql: string, params: unknown[] = []) =>
  as(pool, who, (c) => c.query<T>(sql, params));

export interface Live {
  adminId: string;
  ownerId: string;
  artistId: string;
  releaseId: string;
  trackId: string;
  rightsId: string;
}

/** Drive a release all the way to published + playable through the real state machine. */
export async function goLive(pool: Pool, adminId: string, label: string, o: RightsOptions = {}): Promise<Live> {
  const ownerId = await createUser(pool, `${label}-owner`);
  const artistId = await createApprovedArtist(pool, adminId, ownerId, `${label} artist`);
  const releaseId = await createDraftRelease(pool, ownerId, artistId, `${label} release`);
  const trackId = await createTrack(pool, ownerId, artistId, releaseId, `${label} track`);
  const rightsId = await declareRights(pool, ownerId, releaseId, o);
  await query(pool, user(ownerId), "update public.releases set status = 'in_review' where id = $1", [releaseId]);
  await query(pool, user(adminId), "select public.review_rights_record($1, 'approved', null)", [rightsId]);
  await query(pool, user(adminId), "select public.moderate_release($1, 'published', null)", [releaseId]);
  await query(pool, service, "select public.set_track_audio_variants($1, 'ready', $2, $3, 2000)", [
    trackId,
    `audio/${artistId}/${trackId}/low.m4a`,
    `audio/${artistId}/${trackId}/std.m4a`,
  ]);
  return { adminId, ownerId, artistId, releaseId, trackId, rightsId };
}
