import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { anon, createTestDb, createUser, goLive, makeAdmin, query, service, superuser, user, type Live, type TestDb } from "./helpers";

let db: TestDb;
let admin: string;
let stranger: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
  stranger = await createUser(db.pool, "stranger");
});
afterAll(async () => db.drop());

const q = <T extends object = Record<string, unknown>>(who: Parameters<typeof query>[1], sql: string, args: unknown[] = []) => query<T>(db.pool, who, sql, args);
const status = async (id: string) => (await q<{ status: string }>(superuser, "select status::text from public.releases where id=$1", [id])).rows[0]!.status;
const RLS = /row-level security|permission denied/;

describe("release date", () => {
  it("the owner sets it; a stranger cannot", async () => {
    const l = await goLive(db.pool, admin, "d-date");
    await q(user(l.ownerId), "update public.releases set release_date = '2026-12-01' where id = $1", [l.releaseId]);
    expect((await q<{ d: string }>(superuser, "select release_date::text d from public.releases where id=$1", [l.releaseId])).rows[0]!.d).toBe("2026-12-01");
    await q(user(stranger), "update public.releases set release_date = '2020-01-01' where id = $1", [l.releaseId]);
    expect((await q<{ d: string }>(superuser, "select release_date::text d from public.releases where id=$1", [l.releaseId])).rows[0]!.d).toBe("2026-12-01");
  });
});

describe("withdrawal", () => {
  let l: Live;
  beforeAll(async () => { l = await goLive(db.pool, admin, "d-wd"); });

  it("a direct status update to withdrawn is refused, even for the owner", async () => {
    await expect(q(user(l.ownerId), "update public.releases set status = 'withdrawn' where id = $1", [l.releaseId])).rejects.toThrow(/Only an admin can set status/);
    expect(await status(l.releaseId)).toBe("published");
  });
  it("a stranger and anon cannot withdraw", async () => {
    await expect(q(user(stranger), "select public.withdraw_release($1)", [l.releaseId])).rejects.toThrow(/Release not found/);
    await expect(q(anon, "select public.withdraw_release($1)", [l.releaseId])).rejects.toThrow(/permission denied/);
  });
  it("the owner withdraws: hidden from the public, unplayable, audited", async () => {
    expect((await q(anon, "select 1 from public.releases where id=$1", [l.releaseId])).rowCount).toBe(1);
    await q(user(l.ownerId), "select public.withdraw_release($1)", [l.releaseId]);
    expect(await status(l.releaseId)).toBe("withdrawn");
    expect((await q(anon, "select 1 from public.releases where id=$1", [l.releaseId])).rowCount).toBe(0);
    expect((await q(anon, "select 1 from public.tracks where id=$1", [l.trackId])).rowCount).toBe(0);
    expect((await q(user(l.ownerId), "select 1 from public.releases where id=$1", [l.releaseId])).rowCount).toBe(1); // the artist still sees it
    const rec = await q<{ ok: boolean }>(service, "select public.record_play_event($1,$2,$3,40000) as ok", [stranger, l.trackId, randomUUID()]);
    expect(rec.rows[0]!.ok).toBe(false); // no plays are recorded for a withdrawn track
    expect((await q(superuser, "select 1 from public.audit_log where action='withdraw_release' and target_id=$1", [l.releaseId])).rowCount).toBe(1);
  });
  it("only a published release can be withdrawn", async () => {
    await expect(q(user(l.ownerId), "select public.withdraw_release($1)", [l.releaseId])).rejects.toThrow(/Only a published release/);
  });
  it("a stranger cannot reopen it; the owner reopens it as a draft, audited, and can resubmit", async () => {
    await expect(q(user(stranger), "select public.reopen_withdrawn_release($1)", [l.releaseId])).rejects.toThrow(/Release not found/);
    await expect(q(user(l.ownerId), "update public.releases set status = 'draft' where id = $1", [l.releaseId])).rejects.toThrow(/Only an admin can set status/);
    await q(user(l.ownerId), "select public.reopen_withdrawn_release($1)", [l.releaseId]);
    expect(await status(l.releaseId)).toBe("draft");
    expect((await q(superuser, "select 1 from public.audit_log where action='reopen_release' and target_id=$1", [l.releaseId])).rowCount).toBe(1);
    await q(user(l.ownerId), "update public.releases set status = 'in_review' where id = $1", [l.releaseId]);
    expect(await status(l.releaseId)).toBe("in_review");
  });
  it("only a withdrawn release can be reopened", async () => {
    await expect(q(user(l.ownerId), "select public.reopen_withdrawn_release($1)", [l.releaseId])).rejects.toThrow(/Only a withdrawn release/);
  });
  it("a draft cannot be withdrawn, and the old transitions still work (admin publishes again)", async () => {
    const l2 = await goLive(db.pool, admin, "d-wd2");
    await q(user(l2.ownerId), "select public.withdraw_release($1)", [l2.releaseId]);
    await q(user(l2.ownerId), "select public.reopen_withdrawn_release($1)", [l2.releaseId]);
    await expect(q(user(l2.ownerId), "select public.withdraw_release($1)", [l2.releaseId])).rejects.toThrow(/Only a published release/);
    await q(user(l2.ownerId), "update public.releases set status = 'in_review' where id = $1", [l2.releaseId]);
    await q(user(admin), "select public.moderate_release($1, 'published', null)", [l2.releaseId]);
    expect(await status(l2.releaseId)).toBe("published");
  });
});

describe("cover art storage", () => {
  let l: Live;
  beforeAll(async () => { l = await goLive(db.pool, admin, "d-cov"); });
  const put = (who: Parameters<typeof query>[1], folder: string) => q(who, "insert into storage.objects (bucket_id, name) values ('covers', $1)", [`${folder}/${randomUUID()}/${randomUUID()}.webp`]);
  it("is public, 1 MB, webp/jpeg/png", async () => {
    const r = (await q<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(superuser, "select * from storage.buckets where id='covers'")).rows[0]!;
    expect(r.public).toBe(true); expect(Number(r.file_size_limit)).toBe(1048576);
    expect([...r.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
  it("the owner writes into their artist folder; others and anon cannot", async () => {
    expect((await put(user(l.ownerId), l.artistId)).rowCount).toBe(1);
    await expect(put(user(stranger), l.artistId)).rejects.toThrow(/row-level security/);
    await expect(put(user(l.ownerId), randomUUID())).rejects.toThrow(/row-level security/);
    await expect(put(anon, l.artistId)).rejects.toThrow(RLS);
  });
  it("cover_path must be inside the release's own folder", async () => {
    await q(user(l.ownerId), "update public.releases set cover_path = $2 where id = $1", [l.releaseId, `covers/${l.artistId}/${l.releaseId}/${randomUUID()}.webp`]);
    await expect(q(user(l.ownerId), "update public.releases set cover_path = $2 where id = $1", [l.releaseId, `covers/${randomUUID()}/${l.releaseId}/x.webp`])).rejects.toThrow(/releases_cover|check constraint|violates/);
  });
});

describe("rights evidence storage", () => {
  let l: Live;
  beforeAll(async () => { l = await goLive(db.pool, admin, "d-ev"); });
  const put = (who: Parameters<typeof query>[1], folder: string) => q(who, "insert into storage.objects (bucket_id, name) values ('evidence', $1)", [`${folder}/${randomUUID()}/${randomUUID()}.pdf`]);
  it("is PRIVATE, 5 MB, pdf/jpeg/png", async () => {
    const r = (await q<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(superuser, "select * from storage.buckets where id='evidence'")).rows[0]!;
    expect(r.public).toBe(false); expect(Number(r.file_size_limit)).toBe(5242880);
    expect([...r.allowed_mime_types].sort()).toEqual(["application/pdf", "image/jpeg", "image/png"]);
  });
  it("the owner adds and reads; a stranger and anon can neither add nor read; an admin reads", async () => {
    await put(user(l.ownerId), l.artistId);
    await expect(put(user(stranger), l.artistId)).rejects.toThrow(/row-level security/);
    await expect(put(anon, l.artistId)).rejects.toThrow(RLS);
    const n = async (who: Parameters<typeof query>[1]) => (await q(who, "select 1 from storage.objects where bucket_id='evidence'")).rowCount;
    expect(await n(user(l.ownerId))).toBe(1);
    expect(await n(user(admin))).toBe(1);
    expect(await n(user(stranger))).toBe(0);
    expect(await n(anon)).toBe(0);
  });
  it("nobody can edit or delete evidence through the API, not even the owner", async () => {
    const upd = await q(user(l.ownerId), "update storage.objects set name = name || 'x' where bucket_id='evidence'");
    expect(upd.rowCount).toBe(0);
    const del = await q(user(l.ownerId), "delete from storage.objects where bucket_id='evidence'");
    expect(del.rowCount).toBe(0);
    expect((await q(superuser, "select 1 from storage.objects where bucket_id='evidence'")).rowCount).toBe(1);
  });
});

describe("analytics hide small unique-listener counts", () => {
  const range = [new Date(Date.now() - 86400000).toISOString().slice(0, 10), new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  const play = (u: string, track: string) => q(service, "select public.record_play_event($1,$2,$3,40000)", [u, track, randomUUID()]);
  it("2 listeners: unique count is null (not the number) while plays and listening time are still shown", async () => {
    const l = await goLive(db.pool, admin, "d-an2");
    const u = await createUser(db.pool, "an2-a");
    await play(u, l.trackId); await play(u, l.trackId); await play(stranger, l.trackId);
    const t = (await q<{ plays: string; unique_listeners: string | null; listened_ms: string }>(user(l.ownerId), "select * from public.artist_listener_totals($1,$2,$3)", [l.artistId, ...range])).rows[0]!;
    expect(Number(t.plays)).toBe(3);
    expect(t.unique_listeners).toBeNull();
    expect(Number(t.listened_ms)).toBe(6000);
  });
  it("exactly 4 distinct listeners is hidden, exactly 5 is shown (totals and daily rows)", async () => {
    const l = await goLive(db.pool, admin, "d-an5");
    const users: string[] = [];
    for (let i = 0; i < 5; i++) users.push(await createUser(db.pool, `an5-${i}`));
    for (const u of users.slice(0, 4)) await play(u, l.trackId);
    const tot = async () => (await q<{ plays: string; unique_listeners: string | null }>(user(l.ownerId), "select * from public.artist_listener_totals($1,$2,$3)", [l.artistId, ...range])).rows[0]!;
    const day = async () => (await q<{ unique_listeners: string | null }>(user(l.ownerId), "select * from public.artist_play_summary($1,$2,$3)", [l.artistId, ...range])).rows[0]!;
    expect((await tot()).unique_listeners).toBeNull(); expect(Number((await tot()).plays)).toBe(4); expect((await day()).unique_listeners).toBeNull();
    await play(users[4]!, l.trackId);
    expect(Number((await tot()).unique_listeners)).toBe(5); expect(Number((await day()).unique_listeners)).toBe(5);
  });
  it("artists can no longer call the old exact-count function; admins and owners use the new ones; strangers are refused", async () => {
    const l = await goLive(db.pool, admin, "d-an-acl");
    await expect(q(user(l.ownerId), "select * from public.artist_play_stats($1,$2,$3)", [l.artistId, ...range])).rejects.toThrow(/permission denied/);
    await expect(q(user(admin), "select * from public.artist_play_stats($1,$2,$3)", [l.artistId, ...range])).rejects.toThrow(/permission denied/);
    expect((await q(user(admin), "select * from public.artist_listener_totals($1,$2,$3)", [l.artistId, ...range])).rowCount).toBe(1);
    await expect(q(user(stranger), "select * from public.artist_listener_totals($1,$2,$3)", [l.artistId, ...range])).rejects.toThrow(/Not allowed/);
    await expect(q(anon, "select * from public.artist_play_summary($1,$2,$3)", [l.artistId, ...range])).rejects.toThrow(/permission denied/);
    await expect(q(user(l.ownerId), "select * from public.artist_play_summary($1,'2026-01-01','2028-01-01')", [l.artistId])).rejects.toThrow(/Invalid date range/);
  });
});
