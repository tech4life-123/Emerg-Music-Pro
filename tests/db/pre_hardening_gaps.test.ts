import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, makeAdmin,
  query, superuser, user, anon, type TestDb,
} from "./helpers";
import { randomUUID } from "node:crypto";

/**
 * CHARACTERIZATION tests of the schema as it exists in the live project TODAY (migrations up to the drift
 * capture, i.e. WITHOUT the hardening migrations). They assert that each gap below is REAL and exploitable.
 * If one of these ever fails, the gap was closed. See hardening.test.ts for the fixed behavior.
 * (rights_records does not exist in this state, so the rights flow here uses declarations only.)
 */
let db: TestDb;
let admin: string, alice: string, aliceArtist: string;
beforeAll(async () => {
  db = await createTestDb({ upTo: "20261022000000_capture_unrecorded_live_changes.sql" });
  admin = await makeAdmin(db.pool);
  alice = await createUser(db.pool, "alice");
  aliceArtist = await createApprovedArtist(db.pool, admin, alice, "Alice Artist");
});
afterAll(async () => db.drop());

async function publishedRelease() {
  const rel = await createDraftRelease(db.pool, alice, aliceArtist, "Live release");
  const trk = await createTrack(db.pool, alice, aliceArtist, rel, "Sample Track", { pending: true });
  await query(db.pool, user(alice), "insert into public.rights_declarations (release_id, user_id, statement_version) values ($1,$2,'v1')", [rel, alice]);
  await query(db.pool, user(alice), "update public.releases set status = 'in_review' where id = $1", [rel]);
  await query(db.pool, user(admin), "select public.moderate_release($1, 'published', null)", [rel]);
  return { rel, trk };
}

describe("GAPS in the live schema before hardening", () => {
  it("GAP 1: an artist can insert a track that is already 'ready' with arbitrary variant paths", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = randomUUID();
    const g = (await query<{ id: string }>(db.pool, superuser, "select id from public.genres limit 1")).rows[0]!.id;
    const r = await query(db.pool, user(alice), `insert into public.tracks (id, release_id, artist_id, title, genre_id, processing_status, audio_std_path)
      values ($1,$2,$3,'sneaky',$4,'ready',$5)`, [id, rel, aliceArtist, g, `audio/${aliceArtist}/${id}/unvalidated.exe`]);
    expect(r.rowCount).toBe(1);
  });
  it("GAP 2: after a release is PUBLISHED the artist can still swap in brand-new audio (bypasses moderation)", async () => {
    const { rel, trk } = await publishedRelease();
    const swap = await query(db.pool, user(alice), "update public.tracks set audio_path = $2 where id = $1", [trk, `audio/${aliceArtist}/${trk}/swapped.wav`]);
    expect(swap.rowCount).toBe(1);
    await createTrack(db.pool, alice, aliceArtist, rel, "added after approval", { pending: true }); // also allowed
  });
  it("GAP 3: any artist can mark their own track 'ready' via set_track_audio_variants", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const trk = await createTrack(db.pool, alice, aliceArtist, rel, "Sample Track", { pending: true });
    await query(db.pool, user(alice), "select public.set_track_audio_variants($1,'ready',null,$2,1000)", [trk, `audio/${aliceArtist}/${trk}/x.m4a`]);
    const r = await query<{ processing_status: string }>(db.pool, superuser, "select processing_status from public.tracks where id = $1", [trk]);
    expect(r.rows[0]?.processing_status).toBe("ready");
  });
  it("GAP 4: the audit log can be tampered with by the table owner", async () => {
    await query(db.pool, user(admin), "select public.moderate_release((select id from public.releases limit 1), 'draft', 'seed audit row')");
    await expect(query(db.pool, superuser, "update public.audit_log set action = 'forged'")).resolves.toBeDefined();
    await expect(query(db.pool, superuser, "delete from public.audit_log")).resolves.toBeDefined();
  });
  it("GAP 5: audio storage paths of published tracks are readable by anyone (anon)", async () => {
    const { trk } = await publishedRelease();
    await query(db.pool, superuser, "update public.tracks set audio_std_path = $2, processing_status = 'ready' where id = $1", [trk, `audio/${aliceArtist}/${trk}/std.m4a`]);
    const r = await query<{ audio_std_path: string }>(db.pool, anon, "select audio_std_path from public.tracks where id = $1", [trk]);
    expect(r.rows[0]?.audio_std_path).toContain("std.m4a");
  });
  it("GAP 6: a release can be published with NO rights evidence beyond a checkbox-style declaration", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await declareRights; // (declaration only)
    await query(db.pool, user(alice), "insert into public.rights_declarations (release_id, user_id, statement_version) values ($1,$2,'v1')", [rel, alice]);
    await query(db.pool, user(admin), "select public.moderate_release($1, 'published', null)", [rel]);
    const r = await query<{ status: string }>(db.pool, superuser, "select status from public.releases where id = $1", [rel]);
    expect(r.rows[0]?.status).toBe("published"); // no territory, no term, no review of evidence
  });
});
