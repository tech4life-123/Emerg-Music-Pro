import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, genreId, goLive, makeAdmin,
  query, service, superuser, user, type Live, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string, alice: string, bob: string, aliceArtist: string, bobArtist: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
  alice = await createUser(db.pool, "alice");
  bob = await createUser(db.pool, "bob");
  aliceArtist = await createApprovedArtist(db.pool, admin, alice, "Alice Artist");
  bobArtist = await createApprovedArtist(db.pool, admin, bob, "Bob Artist");
});
afterAll(async () => db.drop());

describe("1. clients cannot set processing results on insert", () => {
  it("DENIED: processing_status / audio_low_path / audio_std_path on insert", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const g = await genreId(db.pool);
    for (const col of ["processing_status", "audio_low_path", "audio_std_path"]) {
      const id = randomUUID();
      const val = col === "processing_status" ? "ready" : `audio/${aliceArtist}/${id}/x.m4a`;
      await expect(
        query(db.pool, user(alice), `insert into public.tracks (id, release_id, artist_id, title, genre_id, ${col}) values ($1,$2,$3,'t',$4,$5)`, [id, rel, aliceArtist, g, val]),
      ).rejects.toThrow(/permission denied/);
    }
  });
  it("ALLOWED: a normal track insert into a draft release, starting as 'pending'", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = await createTrack(db.pool, alice, aliceArtist, rel, "Sample Track", { pending: true });
    expect((await query<{ processing_status: string }>(db.pool, superuser, "select processing_status from public.tracks where id = $1", [id])).rows[0]?.processing_status).toBe("pending");
  });
});

describe("2. audio is locked once a release leaves draft", () => {
  it("draft: ALLOWED to replace audio (resets processing) and to delete the track", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const trk = await createTrack(db.pool, alice, aliceArtist, rel);
    await query(db.pool, service, "select public.set_track_audio_variants($1,'ready',null,$2,1000)", [trk, `audio/${aliceArtist}/${trk}/s.m4a`]);
    await query(db.pool, user(alice), "update public.tracks set audio_path = $2 where id = $1", [trk, `audio/${aliceArtist}/${trk}/v2.wav`]);
    const r = await query<{ processing_status: string; audio_std_path: string | null }>(db.pool, superuser, "select processing_status, audio_std_path from public.tracks where id = $1", [trk]);
    expect(r.rows[0]).toEqual({ processing_status: "pending", audio_std_path: null });
    expect((await query(db.pool, user(alice), "delete from public.tracks where id = $1", [trk])).rowCount).toBe(1);
  });
  it("ALLOWED: deleting a whole draft release still cascades to its tracks", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await createTrack(db.pool, alice, aliceArtist, rel);
    expect((await query(db.pool, user(alice), "delete from public.releases where id = $1", [rel])).rowCount).toBe(1);
    expect((await query(db.pool, superuser, "select 1 from public.tracks where release_id = $1", [rel])).rowCount).toBe(0);
  });
  it("in_review and published: DENIED to add, replace or remove audio; ALLOWED to fix metadata", async () => {
    const live: Live = await goLive(db.pool, admin, "lock");
    for (const [label, who] of [["published", user(live.ownerId)]] as const) {
      await expect(query(db.pool, who, "update public.tracks set audio_path = $2 where id = $1", [live.trackId, `audio/${live.artistId}/${live.trackId}/new.wav`]), label).rejects.toThrow(/draft/);
      await expect(createTrack(db.pool, live.ownerId, live.artistId, live.releaseId, "late addition")).rejects.toThrow(/draft/);
      await expect(query(db.pool, who, "delete from public.tracks where id = $1", [live.trackId])).rejects.toThrow(/draft/);
      expect((await query(db.pool, who, "update public.tracks set title = 'Typo fixed' where id = $1", [live.trackId])).rowCount).toBe(1);
    }
    // same rule while in review
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const trk = await createTrack(db.pool, alice, aliceArtist, rel);
    await declareRights(db.pool, alice, rel);
    await query(db.pool, user(alice), "update public.releases set status = 'in_review' where id = $1", [rel]);
    await expect(query(db.pool, user(alice), "update public.tracks set audio_path = $2 where id = $1", [trk, `audio/${aliceArtist}/${trk}/n.wav`])).rejects.toThrow(/draft/);
  });
  it("service role is unrestricted; admins have no direct track-write policy; after admin sends it back to draft the artist can fix audio again", async () => {
    const live = await goLive(db.pool, admin, "lock2");
    const np = `audio/${live.artistId}/${live.trackId}/admin.wav`;
    expect((await query(db.pool, user(admin), "update public.tracks set audio_path = $2 where id = $1", [live.trackId, np])).rowCount).toBe(0); // RLS: no admin write policy on tracks
    expect((await query(db.pool, service, "update public.tracks set audio_path = $2 where id = $1", [live.trackId, np + "2"])).rowCount).toBe(1);
    await query(db.pool, user(admin), "select public.moderate_release($1, 'draft', 'please fix the audio')", [live.releaseId]);
    expect((await query(db.pool, user(live.ownerId), "update public.tracks set audio_path = $2 where id = $1", [live.trackId, np + "3"])).rowCount).toBe(1);
  });
  it("DENIED: another artist cannot touch it at all", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const trk = await createTrack(db.pool, alice, aliceArtist, rel);
    expect((await query(db.pool, user(bob), "update public.tracks set title = 'hijack' where id = $1", [trk])).rowCount).toBe(0);
    expect((await query(db.pool, user(bob), "delete from public.tracks where id = $1", [trk])).rowCount).toBe(0);
  });
});

describe("3. only the trusted backend records processing results", () => {
  let trk: string;
  beforeAll(async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    trk = await createTrack(db.pool, alice, aliceArtist, rel, "Sample Track", { pending: true });
  });
  it("DENIED: artist, admin (via the API), anon", async () => {
    for (const who of [user(alice), user(admin), anon]) {
      await expect(query(db.pool, who, "select public.set_track_audio_variants($1,'ready',null,$2,1)", [trk, `audio/${aliceArtist}/${trk}/s.m4a`])).rejects.toThrow(/permission denied/);
    }
  });
  it("ALLOWED: service role; and it enforces integrity", async () => {
    await expect(query(db.pool, service, "select public.set_track_audio_variants($1,'ready',null,null,1)", [trk])).rejects.toThrow(/rendition exists/);
    await expect(query(db.pool, service, "select public.set_track_audio_variants($1,'bogus',null,null,1)", [trk])).rejects.toThrow(/Bad status/);
    await expect(query(db.pool, service, "select public.set_track_audio_variants($1,'ready',null,$2,1)", [trk, `audio/${bobArtist}/${trk}/s.m4a`])).rejects.toThrow(/own_folder/);
    await query(db.pool, service, "select public.set_track_audio_variants($1,'ready',null,$2,1500)", [trk, `audio/${aliceArtist}/${trk}/s.m4a`]);
    expect((await query<{ processing_status: string }>(db.pool, superuser, "select processing_status from public.tracks where id = $1", [trk])).rows[0]?.processing_status).toBe("ready");
  });
});

describe("4. audit_log is append-only", () => {
  it("DENIED: update, delete and truncate - even for the database owner", async () => {
    await query(db.pool, user(admin), "select public.moderate_release((select id from public.releases limit 1), 'draft', 'seed audit row')");
    await expect(query(db.pool, superuser, "update public.audit_log set action = 'forged'")).rejects.toThrow(/append-only/);
    await expect(query(db.pool, superuser, "delete from public.audit_log")).rejects.toThrow(/append-only/);
    await expect(query(db.pool, superuser, "truncate public.audit_log")).rejects.toThrow(/append-only/);
  });
  it("ALLOWED: new rows are still written by admin actions; clients still cannot insert", async () => {
    const before = (await query<{ n: string }>(db.pool, superuser, "select count(*) n from public.audit_log")).rows[0]!.n;
    await query(db.pool, user(admin), "select public.moderate_release((select id from public.releases limit 1), 'draft', 'another')");
    const after = (await query<{ n: string }>(db.pool, superuser, "select count(*) n from public.audit_log")).rows[0]!.n;
    expect(Number(after)).toBe(Number(before) + 1);
    await expect(query(db.pool, user(admin), "insert into public.audit_log (actor_id, action, target_type, target_id) values ($1,'a','b','c')", [admin])).rejects.toThrow(/permission denied/);
  });
});

describe("5. audio storage paths are not exposed to clients", () => {
  it("DENIED: anon and signed-in users cannot read path columns or `select *`; ALLOWED: public columns", async () => {
    const live = await goLive(db.pool, admin, "paths");
    for (const who of [anon, user(alice), user(live.ownerId)]) {
      for (const col of ["audio_path", "audio_low_path", "audio_std_path"]) {
        await expect(query(db.pool, who, `select ${col} from public.tracks where id = $1`, [live.trackId])).rejects.toThrow(/permission denied/);
      }
      await expect(query(db.pool, who, "select * from public.tracks where id = $1", [live.trackId])).rejects.toThrow(/permission denied/);
    }
    const pub = await query<{ title: string; processing_status: string }>(db.pool, anon, "select title, processing_status, duration_ms from public.tracks where id = $1", [live.trackId]);
    expect(pub.rowCount).toBe(1);
  });
  it("service role and the database owner can still read paths (backend/playback gate)", async () => {
    const r = await query(db.pool, service, "select audio_std_path from public.tracks where audio_std_path is not null limit 1");
    expect(r.rowCount).toBe(1);
  });
});
