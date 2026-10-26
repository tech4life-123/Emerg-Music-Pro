import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { anon, createApprovedArtist, createTestDb, createUser, makeAdmin, query, superuser, user, type TestDb } from "./helpers";

let db: TestDb;
let admin: string;
beforeAll(async () => { db = await createTestDb(); admin = await makeAdmin(db.pool); });
afterAll(async () => db.drop());

const signUp = async (meta: Record<string, string>) => {
  const r = await query<{ id: string }>(db.pool, superuser, "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`u-${randomUUID().slice(0, 8)}@example.test`, JSON.stringify(meta)]);
  return r.rows[0]!.id;
};
const profile = async (id: string) => (await query<Record<string, unknown>>(db.pool, superuser, "select * from public.profiles where id = $1", [id])).rows[0]!;

describe("sign-up metadata", () => {
  it("stores a valid username (lowercased) and the terms version with a server timestamp", async () => {
    const id = await signUp({ display_name: "Ada", username: "Ada_Lib", terms_version: "2026-10" });
    const p = await profile(id);
    expect(p.username).toBe("ada_lib");
    expect(p.terms_version).toBe("2026-10");
    expect(p.terms_accepted_at).not.toBeNull();
  });
  it("a malformed, reserved or taken username never blocks account creation; it is stored as NULL", async () => {
    await signUp({ username: "taken_name" });
    for (const bad of ["x", "has space", "Admin", "emergmusic", "taken_name", "a".repeat(40)]) {
      const p = await profile(await signUp({ display_name: "N", username: bad }));
      expect(p.username, bad).toBeNull();
    }
  });
  it("no terms metadata means no recorded acceptance", async () => {
    expect((await profile(await signUp({ display_name: "NoTerms" }))).terms_accepted_at).toBeNull();
  });
});

describe("username rules", () => {
  it("username_available: false for bad, reserved or taken; true otherwise; callable by anon", async () => {
    await signUp({ username: "walter_m" });
    const q = (u: string) => query<{ a: boolean }>(db.pool, anon, "select public.username_available($1) as a", [u]).then((r) => r.rows[0]!.a);
    expect(await q("walter_m")).toBe(false);
    expect(await q("moderator")).toBe(false);
    expect(await q("Bad Name")).toBe(false);
    expect(await q("fresh_name1")).toBe(true);
  });
  it("users can set their own username once valid; duplicates, reserved and malformed are refused", async () => {
    const a = await createUser(db.pool, "uname-a"), b = await createUser(db.pool, "uname-b");
    await query(db.pool, user(a), "update public.profiles set username = 'alpha_one' where id = $1", [a]);
    await expect(query(db.pool, user(b), "update public.profiles set username = 'alpha_one' where id = $1", [b])).rejects.toThrow(/profiles_username_uidx|duplicate/);
    await expect(query(db.pool, user(b), "update public.profiles set username = 'support' where id = $1", [b])).rejects.toThrow(/not available/);
    await expect(query(db.pool, user(b), "update public.profiles set username = 'No Good' where id = $1", [b])).rejects.toThrow(/profiles_username_format/);
  });
});

describe("profile edits and role safety", () => {
  it("DENIED: changing role, terms fields or created_at; another user's profile", async () => {
    const a = await createUser(db.pool, "edit-a"), b = await createUser(db.pool, "edit-b");
    for (const col of ["role = 'admin'", "terms_version = 'x'", "terms_accepted_at = now()", "created_at = now()"]) {
      await expect(query(db.pool, user(a), `update public.profiles set ${col} where id = $1`, [a])).rejects.toThrow(/permission denied/);
    }
    const r = await query(db.pool, user(a), "update public.profiles set bio = 'hacked' where id = $1", [b]);
    expect(r.rowCount).toBe(0);
    expect((await profile(b)).bio).toBeNull();
  });
  it("ALLOWED: own bio, country, onboarding, visibility; bad values refused", async () => {
    const a = await createUser(db.pool, "edit-ok");
    await query(db.pool, user(a), "update public.profiles set bio = 'Hello', country = 'LR', onboarding_completed_at = now(), profile_public = true where id = $1", [a]);
    await expect(query(db.pool, user(a), "update public.profiles set country = 'Liberia' where id = $1", [a])).rejects.toThrow(/profiles_country_code/);
    await expect(query(db.pool, user(a), "update public.profiles set bio = $2 where id = $1", [a, "x".repeat(501)])).rejects.toThrow(/profiles_bio_len/);
  });
  it("accept_terms records a server timestamp; anon cannot call it", async () => {
    const a = await createUser(db.pool, "terms-a");
    await query(db.pool, user(a), "select public.accept_terms('2026-11')");
    const p = await profile(a);
    expect(p.terms_version).toBe("2026-11");
    expect(p.terms_accepted_at).not.toBeNull();
    await expect(query(db.pool, anon, "select public.accept_terms('x')")).rejects.toThrow(/permission denied/);
  });
});

describe("public profile (opt-in)", () => {
  it("private by default; public only when the owner turns it on; exposes only safe fields", async () => {
    const id = await signUp({ display_name: "Pat", username: "pat_p" });
    const get = (who = anon) => query<Record<string, unknown>>(db.pool, who, "select * from public.get_public_profile('pat_p')");
    expect((await get()).rowCount).toBe(0);
    await query(db.pool, user(id), "update public.profiles set profile_public = true, bio = 'hi' where id = $1", [id]);
    const r = await get();
    expect(r.rowCount).toBe(1);
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["avatar_url", "bio", "display_name", "following_count", "joined_at", "username"]);
    await query(db.pool, user(id), "update public.profiles set profile_public = false where id = $1", [id]);
    expect((await get()).rowCount).toBe(0);
  });
  it("profiles table itself stays unreadable to other users and anon", async () => {
    const id = await signUp({ username: "hidden_h" });
    const other = await createUser(db.pool, "peek");
    expect((await query(db.pool, user(other), "select 1 from public.profiles where id = $1", [id])).rowCount).toBe(0);
    await expect(query(db.pool, anon, "select 1 from public.profiles")).rejects.toThrow(/permission denied/);
  });
});

describe("genre interests and deletion requests", () => {
  it("user_genres: own only", async () => {
    const a = await createUser(db.pool, "g-a"), b = await createUser(db.pool, "g-b");
    const g = (await query<{ id: string }>(db.pool, superuser, "select id from public.genres limit 1")).rows[0]!.id;
    await query(db.pool, user(a), "insert into public.user_genres (user_id, genre_id) values ($1, $2)", [a, g]);
    expect((await query(db.pool, user(b), "select 1 from public.user_genres")).rowCount).toBe(0);
    await expect(query(db.pool, user(b), "insert into public.user_genres (user_id, genre_id) values ($1, $2)", [a, g])).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, anon, "select 1 from public.user_genres")).rejects.toThrow(/permission denied/);
  });
  it("deletion request: one pending per user, private, cancellable by the owner, visible to admin, not completable by the user", async () => {
    const a = await createUser(db.pool, "del-a"), b = await createUser(db.pool, "del-b");
    await query(db.pool, user(a), "insert into public.account_deletion_requests (user_id) values ($1)", [a]);
    await expect(query(db.pool, user(a), "insert into public.account_deletion_requests (user_id) values ($1)", [a])).rejects.toThrow(/duplicate|one_pending/);
    await expect(query(db.pool, user(b), "insert into public.account_deletion_requests (user_id) values ($1)", [a])).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(a), "insert into public.account_deletion_requests (user_id, status) values ($1, 'completed')", [b])).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, user(b), "select 1 from public.account_deletion_requests")).rowCount).toBe(0);
    expect((await query(db.pool, user(admin), "select 1 from public.account_deletion_requests where user_id = $1", [a])).rowCount).toBe(1);
    await expect(query(db.pool, user(a), "update public.account_deletion_requests set status = 'completed' where user_id = $1", [a])).rejects.toThrow(/permission denied/);
    await query(db.pool, user(a), "delete from public.account_deletion_requests where user_id = $1", [a]);
    expect((await query(db.pool, user(admin), "select 1 from public.account_deletion_requests where user_id = $1", [a])).rowCount).toBe(0);
  });
});

describe("verified email gate on artist applications", () => {
  it("DENIED until the email is confirmed; ALLOWED after; the approval flow still works", async () => {
    const id = await signUp({ display_name: "Unverified" });
    await query(db.pool, superuser, "update auth.users set email_confirmed_at = null where id = $1", [id]);
    const apply = () => query<{ id: string }>(db.pool, user(id), "insert into public.artist_applications (user_id, artist_name, rights_statement_accepted) values ($1, 'Gate Band', true) returning id", [id]);
    await expect(apply()).rejects.toThrow(/row-level security/);
    await query(db.pool, superuser, "update auth.users set email_confirmed_at = now() where id = $1", [id]);
    const app = await apply();
    const artistId = await query<{ id: string }>(db.pool, user(admin), "select public.approve_artist_application($1) as id", [app.rows[0]!.id]);
    expect(artistId.rows[0]!.id).toBeTruthy();
  });
  it("the helper is not callable by anon", async () => {
    await expect(query(db.pool, anon, "select private.email_verified()")).rejects.toThrow(/permission denied/);
  });
  it("existing helper flow (createApprovedArtist) still works for confirmed users", async () => {
    const owner = await createUser(db.pool, "conf-owner");
    expect(await createApprovedArtist(db.pool, admin, owner, "Conf Band")).toBeTruthy();
  });
});
