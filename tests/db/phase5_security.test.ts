import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, goLive, makeAdmin, query, service, superuser, user, type Live, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string;
let live: Live; // published + playable
let listener: string;
let other: string;
let draftTrack: string; // exists, owned by a real artist, never published
const RLS = /row-level security|permission denied|not available/;

beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
  live = await goLive(db.pool, admin, "p5");
  listener = await createUser(db.pool, "listener");
  other = await createUser(db.pool, "other");
  const owner = await createUser(db.pool, "draft-owner");
  const art = await createApprovedArtist(db.pool, admin, owner, "draft artist");
  const rel = await createDraftRelease(db.pool, owner, art);
  draftTrack = await createTrack(db.pool, owner, art, rel, "unpublished");
});
afterAll(async () => db.drop());

const newPlaylist = async (owner: string, isPublic = false) =>
  (await query<{ id: string }>(db.pool, user(owner), "insert into public.playlists (owner_id, name, is_public) values ($1, 'mix', $2) returning id", [owner, isPublic])).rows[0]!.id;
const record = (u: string | null, track: string, ev = randomUUID(), ms = 40000) =>
  query<{ ok: boolean }>(db.pool, service, "select public.record_play_event($1, $2, $3, $4) as ok", [u, track, ev, ms]);

describe("favorites", () => {
  it("ALLOWED: like and unlike a public track", async () => {
    await query(db.pool, user(listener), "insert into public.favorites (user_id, track_id) values ($1, $2)", [listener, live.trackId]);
    expect((await query(db.pool, user(listener), "select 1 from public.favorites where track_id = $1", [live.trackId])).rowCount).toBe(1);
    await query(db.pool, user(listener), "delete from public.favorites where user_id = $1 and track_id = $2", [listener, live.trackId]);
    expect((await query(db.pool, user(listener), "select 1 from public.favorites where track_id = $1", [live.trackId])).rowCount).toBe(0);
  });
  it("DENIED: unpublished track, forged user, anon", async () => {
    await expect(query(db.pool, user(listener), "insert into public.favorites (user_id, track_id) values ($1, $2)", [listener, draftTrack])).rejects.toThrow(RLS);
    await expect(query(db.pool, user(other), "insert into public.favorites (user_id, track_id) values ($1, $2)", [listener, live.trackId])).rejects.toThrow(RLS);
    await expect(query(db.pool, anon, "insert into public.favorites (user_id, track_id) values ($1, $2)", [listener, live.trackId])).rejects.toThrow(/permission denied/);
  });
  it("DENIED: a removed track cannot be newly liked; an existing like stops resolving to a track", async () => {
    const l2 = await goLive(db.pool, admin, "p5-fav2");
    await query(db.pool, user(listener), "insert into public.favorites (user_id, track_id) values ($1, $2)", [listener, l2.trackId]);
    await query(db.pool, user(admin), "select public.takedown_track($1, 'test')", [l2.trackId]);
    await expect(query(db.pool, user(other), "insert into public.favorites (user_id, track_id) values ($1, $2)", [other, l2.trackId])).rejects.toThrow(RLS);
    const joined = await query(db.pool, user(listener), "select f.track_id from public.favorites f join public.tracks t on t.id = f.track_id where f.track_id = $1", [l2.trackId]);
    expect(joined.rowCount).toBe(0);
  });
  it("DENIED: other users cannot read my likes", async () => {
    await query(db.pool, user(listener), "insert into public.favorites (user_id, track_id) values ($1, $2) on conflict do nothing", [listener, live.trackId]);
    expect((await query(db.pool, user(other), "select 1 from public.favorites")).rowCount).toBe(0);
  });
});

describe("artist_follows", () => {
  it("ALLOWED: follow and unfollow an approved artist", async () => {
    await query(db.pool, user(listener), "insert into public.artist_follows (user_id, artist_id) values ($1, $2)", [listener, live.artistId]);
    const n = await query<{ n: number }>(db.pool, anon, "select public.artist_follower_count($1) as n", [live.artistId]);
    expect(n.rows[0]!.n).toBe(1);
    await query(db.pool, user(listener), "delete from public.artist_follows where user_id = $1 and artist_id = $2", [listener, live.artistId]);
  });
  it("DENIED: suspended artist, unknown artist, forged user, anon", async () => {
    const l = await goLive(db.pool, admin, "p5-susp");
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [l.artistId]);
    await expect(query(db.pool, user(listener), "insert into public.artist_follows (user_id, artist_id) values ($1, $2)", [listener, l.artistId])).rejects.toThrow(RLS);
    await expect(query(db.pool, user(listener), "insert into public.artist_follows (user_id, artist_id) values ($1, $2)", [listener, randomUUID()])).rejects.toThrow(RLS);
    await expect(query(db.pool, user(other), "insert into public.artist_follows (user_id, artist_id) values ($1, $2)", [listener, live.artistId])).rejects.toThrow(RLS);
    await expect(query(db.pool, anon, "insert into public.artist_follows (user_id, artist_id) values ($1, $2)", [listener, live.artistId])).rejects.toThrow(/permission denied/);
  });
});

describe("playlist_tracks", () => {
  it("ALLOWED: owner adds a public track, removes it, and re-orders", async () => {
    const pl = await newPlaylist(listener);
    await query(db.pool, user(listener), "insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, 0)", [pl, live.trackId]);
    await query(db.pool, user(listener), "update public.playlist_tracks set position = 5 where playlist_id = $1", [pl]);
    await query(db.pool, user(listener), "delete from public.playlist_tracks where playlist_id = $1", [pl]);
  });
  it("DENIED: unpublished track, someone else's playlist, anon", async () => {
    const pl = await newPlaylist(listener);
    await expect(query(db.pool, user(listener), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, draftTrack])).rejects.toThrow(RLS);
    await expect(query(db.pool, user(other), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, live.trackId])).rejects.toThrow(RLS);
    await expect(query(db.pool, anon, "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, live.trackId])).rejects.toThrow(/permission denied/);
  });
  it("private playlist items are invisible to others and anon", async () => {
    const pl = await newPlaylist(listener, false);
    await query(db.pool, user(listener), "insert into public.playlist_tracks (playlist_id, track_id) values ($1, $2)", [pl, live.trackId]);
    for (const who of [user(other), anon]) expect((await query(db.pool, who, "select 1 from public.playlist_tracks where playlist_id = $1", [pl])).rowCount).toBe(0);
    expect((await query(db.pool, user(listener), "select 1 from public.playlist_tracks where playlist_id = $1", [pl])).rowCount).toBe(1);
  });
  it("public playlist: visible to anon; after takedown the track id disappears for others but the owner still sees it and can remove it; re-order still works", async () => {
    const l = await goLive(db.pool, admin, "p5-pl");
    const pl = await newPlaylist(listener, true);
    await query(db.pool, user(listener), "insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, 0), ($1, $3, 1)", [pl, l.trackId, live.trackId]);
    expect((await query(db.pool, anon, "select 1 from public.playlist_tracks where playlist_id = $1", [pl])).rowCount).toBe(2);
    await query(db.pool, user(admin), "select public.takedown_track($1, 'test')", [l.trackId]);
    expect((await query(db.pool, anon, "select track_id from public.playlist_tracks where playlist_id = $1", [pl])).rows.map((r) => (r as { track_id: string }).track_id)).toEqual([live.trackId]);
    expect((await query(db.pool, user(other), "select 1 from public.playlist_tracks where playlist_id = $1", [pl])).rowCount).toBe(1);
    expect((await query(db.pool, user(listener), "select 1 from public.playlist_tracks where playlist_id = $1", [pl])).rowCount).toBe(2);
    await query(db.pool, user(listener), "update public.playlist_tracks set position = 9 where playlist_id = $1", [pl]);
    await query(db.pool, user(listener), "delete from public.playlist_tracks where playlist_id = $1 and track_id = $2", [pl, l.trackId]);
  });
});

describe("play_events: client writes closed, server recorder validated", () => {
  it("DENIED: direct insert by any client role, even for oneself", async () => {
    await expect(query(db.pool, user(listener), "insert into public.play_events (track_id, user_id, listened_ms) values ($1, $2, 30000)", [live.trackId, listener])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, anon, "insert into public.play_events (track_id, listened_ms) values ($1, 30000)", [live.trackId])).rejects.toThrow(/permission denied/);
  });
  it("DENIED: record_play_event is callable only by service_role", async () => {
    for (const who of [anon, user(listener), user(live.ownerId), user(admin)]) {
      await expect(query(db.pool, who, "select public.record_play_event($1, $2, $3, 1000)", [listener, live.trackId, randomUUID()])).rejects.toThrow(/permission denied/);
    }
  });
  it("ALLOWED: server records a play; duplicates are ignored; listened_ms is clamped to the track length", async () => {
    const ev = randomUUID();
    expect((await record(listener, live.trackId, ev, 999999)).rows[0]!.ok).toBe(true);
    expect((await record(listener, live.trackId, ev, 1000)).rows[0]!.ok).toBe(false); // duplicate callback
    const rows = await query<{ listened_ms: number }>(db.pool, superuser, "select listened_ms from public.play_events where client_event_id = $1", [ev]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.listened_ms).toBe(2000); // goLive sets duration_ms = 2000
  });
  it("DENIED: unpublished or removed tracks and malformed input are never recorded", async () => {
    expect((await record(listener, draftTrack)).rows[0]!.ok).toBe(false);
    const l = await goLive(db.pool, admin, "p5-ev");
    await query(db.pool, user(admin), "select public.takedown_track($1, 'test')", [l.trackId]);
    expect((await record(listener, l.trackId)).rows[0]!.ok).toBe(false);
    await expect(record(listener, live.trackId, randomUUID(), -5)).rejects.toThrow(/invalid listened_ms/);
    await expect(query(db.pool, service, "select public.record_play_event($1, $2, null, 10)", [listener, live.trackId])).rejects.toThrow(/client_event_id/);
  });
});

describe("play_events: listener privacy", () => {
  it("DENIED: the artist cannot read raw rows (no listener ids); other users cannot either; the listener sees only their own", async () => {
    await record(listener, live.trackId);
    await record(other, live.trackId);
    expect((await query(db.pool, user(live.ownerId), "select * from public.play_events")).rowCount).toBe(0);
    await expect(query(db.pool, anon, "select 1 from public.play_events")).rejects.toThrow(/permission denied/);
    const mine = await query<{ user_id: string }>(db.pool, user(listener), "select user_id from public.play_events");
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(mine.rows.every((r) => r.user_id === listener)).toBe(true);
  });
  it("ALLOWED: a listener clears their own history; they cannot clear someone else's", async () => {
    await record(other, live.trackId);
    await query(db.pool, user(listener), "delete from public.play_events where user_id <> $1", [listener]); // matches nothing visible
    expect(((await query(db.pool, superuser, "select 1 from public.play_events where user_id = $1", [other])).rowCount ?? 0)).toBeGreaterThan(0);
    await query(db.pool, user(listener), "delete from public.play_events");
    expect((await query(db.pool, superuser, "select 1 from public.play_events where user_id = $1", [listener])).rowCount).toBe(0);
  });
});

describe("artist_play_stats: aggregates only", () => {
  const range = [new Date(Date.now() - 86400000).toISOString().slice(0, 10), new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  it("ALLOWED: the artist sees counts; columns carry no user id; unique listeners are counted not named", async () => {
    const l = await goLive(db.pool, admin, "p5-stats");
    await record(listener, l.trackId);
    await record(listener, l.trackId);
    await record(other, l.trackId);
    const r = await query<{ track_id: string; plays: string; unique_listeners: string; listened_ms: string }>(
      db.pool, user(l.ownerId), "select * from public.artist_play_stats($1, $2, $3)", [l.artistId, ...range]);
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["day", "listened_ms", "plays", "track_id", "unique_listeners"]);
    expect(Number(r.rows[0]!.plays)).toBe(3);
    expect(Number(r.rows[0]!.unique_listeners)).toBe(2);
    expect(Number(r.rows[0]!.listened_ms)).toBe(6000);
    expect((await query(db.pool, user(admin), "select * from public.artist_play_stats($1, $2, $3)", [l.artistId, ...range])).rowCount).toBe(1);
  });
  it("DENIED: another artist, a plain listener, anon; bad ranges", async () => {
    for (const who of [user(live.ownerId), user(listener)]) {
      await expect(query(db.pool, who, "select * from public.artist_play_stats($1, $2, $3)", [(await goLive(db.pool, admin, "p5-x")).artistId, ...range])).rejects.toThrow(/Not allowed/);
    }
    await expect(query(db.pool, anon, "select * from public.artist_play_stats($1, $2, $3)", [live.artistId, ...range])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(live.ownerId), "select * from public.artist_play_stats($1, '2026-01-01', '2028-01-01')", [live.artistId])).rejects.toThrow(/Invalid date range/);
  });
});
