import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, goLive, makeAdmin, query, superuser, user, type Live, type TestDb } from "./helpers";

let db: TestDb;
let live: Live;
let u: string;
beforeAll(async () => {
  db = await createTestDb();
  const admin = await makeAdmin(db.pool);
  live = await goLive(db.pool, admin, "lim");
  u = await createUser(db.pool, "lim-user");
});
afterAll(async () => db.drop());

const setLimit = (key: string, v: number) => query(db.pool, superuser, "update private.app_limits set value = $2 where key = $1", [key, v]);
const mkPlaylist = (owner: string) => query<{ id: string }>(db.pool, user(owner), "insert into public.playlists (owner_id, name) values ($1, 'p') returning id", [owner]);

describe("approved limits (decision E)", () => {
  it("defaults are 200 / 500 / 5000", async () => {
    const r = await query<{ key: string; value: number }>(db.pool, superuser, "select key, value from private.app_limits order by key");
    expect(Object.fromEntries(r.rows.map((x) => [x.key, x.value]))).toEqual({ max_liked_tracks_per_user: 5000, max_playlists_per_user: 200, max_tracks_per_playlist: 500 });
  });
  it("DENIED: clients cannot read or change the limits table or call its helper", async () => {
    await expect(query(db.pool, user(u), "select * from private.app_limits")).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(u), "update private.app_limits set value = 999999")).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(u), "select private.limit_of('max_playlists_per_user')")).rejects.toThrow(/permission denied/);
  });
  it("playlists: the Nth+1 direct insert is refused with a clear message; other users are unaffected; raising the limit takes effect at once", async () => {
    await setLimit("max_playlists_per_user", 3);
    for (let i = 0; i < 3; i++) await mkPlaylist(u);
    await expect(mkPlaylist(u)).rejects.toThrow(/up to 3 playlists/);
    const other = await createUser(db.pool, "lim-other");
    await mkPlaylist(other);
    await setLimit("max_playlists_per_user", 4);
    await mkPlaylist(u);
  });
  it("playlists: parallel requests cannot overshoot the limit", async () => {
    await setLimit("max_playlists_per_user", 2);
    const racer = await createUser(db.pool, "racer");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => mkPlaylist(racer)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await query(db.pool, user(racer), "select 1 from public.playlists")).rowCount).toBe(2);
  });
  it("playlist tracks: limit per playlist is enforced on direct inserts (replacing nothing, deleting frees a slot)", async () => {
    await setLimit("max_tracks_per_playlist", 1);
    await setLimit("max_playlists_per_user", 200);
    const owner = await createUser(db.pool, "pt-owner");
    const pl = (await mkPlaylist(owner)).rows[0]!.id;
    await query(db.pool, user(owner), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, live.trackId]);
    const l2 = await goLive(db.pool, await makeAdmin(db.pool, "admin2"), "lim2");
    await expect(query(db.pool, user(owner), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, l2.trackId])).rejects.toThrow(/up to 1 tracks/);
    await query(db.pool, user(owner), "delete from public.playlist_tracks where playlist_id = $1", [pl]);
    await query(db.pool, user(owner), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, l2.trackId]);
  });
  it("likes: limit per user is enforced on direct inserts", async () => {
    await setLimit("max_liked_tracks_per_user", 1);
    const liker = await createUser(db.pool, "liker");
    const l2 = await goLive(db.pool, await makeAdmin(db.pool, "admin3"), "lim3");
    await query(db.pool, user(liker), "insert into public.favorites (user_id, track_id) values ($1, $2)", [liker, live.trackId]);
    await expect(query(db.pool, user(liker), "insert into public.favorites (user_id, track_id) values ($1, $2)", [liker, l2.trackId])).rejects.toThrow(/like up to 1 tracks/);
  });
});
