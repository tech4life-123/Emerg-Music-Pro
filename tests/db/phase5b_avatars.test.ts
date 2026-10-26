import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { anon, createTestDb, createUser, query, superuser, user, type TestDb } from "./helpers";

let db: TestDb;
let a: string;
let b: string;
beforeAll(async () => { db = await createTestDb(); a = await createUser(db.pool, "ava"); b = await createUser(db.pool, "ben"); });
afterAll(async () => db.drop());

const put = (who: ReturnType<typeof user> | typeof anon, uid: string, name = `${randomUUID()}.webp`) =>
  query(db.pool, who, "insert into storage.objects (bucket_id, name) values ('avatars', $1) returning id", [`${uid}/${name}`]);

describe("avatars bucket", () => {
  it("is public, capped at 512 KB, and only accepts webp, jpeg and png", async () => {
    const r = (await query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(db.pool, superuser, "select * from storage.buckets where id = 'avatars'")).rows[0]!;
    expect(r.public).toBe(true);
    expect(Number(r.file_size_limit)).toBe(524288);
    expect([...r.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(r.allowed_mime_types).not.toContain("image/svg+xml");
  });
});

describe("avatar objects: own folder only", () => {
  it("a person can add, list and delete files in their own folder", async () => {
    const r = await put(user(a), a);
    expect(r.rowCount).toBe(1);
    expect((await query(db.pool, user(a), "select 1 from storage.objects where bucket_id='avatars'")).rowCount).toBe(1);
    expect((await query(db.pool, user(a), "delete from storage.objects where bucket_id='avatars' and name like $1", [`${a}/%`])).rowCount).toBe(1);
  });
  it("cannot add into someone else's folder", async () => {
    await expect(put(user(b), a)).rejects.toThrow(/row-level security/);
  });
  it("cannot add to the bucket root or a folder named after a guessed id", async () => {
    await expect(query(db.pool, user(b), "insert into storage.objects (bucket_id, name) values ('avatars', 'x.webp')")).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(b), "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${randomUUID()}/x.webp`])).rejects.toThrow(/row-level security/);
  });
  it("cannot see, replace or delete another person's files", async () => {
    await put(user(a), a);
    expect((await query(db.pool, user(b), "select 1 from storage.objects where bucket_id='avatars'")).rowCount).toBe(0);
    expect((await query(db.pool, user(b), "update storage.objects set name = $1 where bucket_id='avatars'", [`${b}/steal.webp`])).rowCount).toBe(0);
    expect((await query(db.pool, user(b), "delete from storage.objects where bucket_id='avatars'")).rowCount).toBe(0);
  });
  it("anonymous visitors cannot write or list through the API", async () => {
    await expect(put(anon, a)).rejects.toThrow(/permission denied|row-level security/);
    expect((await query(db.pool, anon, "select 1 from storage.objects where bucket_id='avatars'")).rowCount).toBe(0);
  });
  it("policies do not leak to other buckets", async () => {
    await query(db.pool, superuser, "insert into storage.buckets (id, name) values ('media','media') on conflict do nothing");
    await expect(query(db.pool, user(a), "insert into storage.objects (bucket_id, name) values ('media', $1)", [`${a}/x.webp`])).rejects.toThrow(/row-level security/);
  });
});

describe("profiles.avatar_url", () => {
  it("accepts a path in the person's own folder", async () => {
    const r = await query(db.pool, user(a), "update public.profiles set avatar_url = $2 where id = $1", [a, `avatars/${a}/pic.webp`]);
    expect(r.rowCount).toBe(1);
  });
  it("rejects another person's folder and external URLs", async () => {
    await expect(query(db.pool, user(a), "update public.profiles set avatar_url = $2 where id = $1", [a, `avatars/${b}/pic.webp`])).rejects.toThrow(/profiles_avatar_own_folder/);
    await expect(query(db.pool, user(a), "update public.profiles set avatar_url = 'https://tracker.example/x.png' where id = $1", [a])).rejects.toThrow(/profiles_avatar_own_folder/);
  });
  it("the constraint is validated", async () => {
    const r = await query<{ convalidated: boolean }>(db.pool, superuser, "select convalidated from pg_constraint where conname = 'profiles_avatar_own_folder'");
    expect(r.rows[0]!.convalidated).toBe(true);
  });
});
