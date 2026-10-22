import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, goLive,
  makeAdmin, query, service, superuser, user, type TestDb,
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

const insertRecord = (who: string, rel: string, extra = "", vals: unknown[] = []) =>
  query(db.pool, user(who), `insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'owner', 'Holder', '{WW}', '2020-01-01' ${extra ? ", " + extra.split("=")[1] : ""})`, [rel, who, ...vals]);

describe("rights records", () => {
  it("ALLOWED: an artist declares rights (pending) on their own draft release", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = await declareRights(db.pool, alice, rel, { territories: ["LR", "GH"], termEnd: "2099-01-01" });
    const r = await query<{ review_status: string }>(db.pool, superuser, "select review_status from public.rights_records where id = $1", [id]);
    expect(r.rows[0]?.review_status).toBe("pending");
  });
  it("DENIED: declaring rights on someone else's release, or attributing it to someone else", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(insertRecord(bob, rel)).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(bob), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start) values ($1,$2,'owner','H','{WW}','2020-01-01')", [rel, alice])).rejects.toThrow(/row-level security/);
  });
  it("DENIED: a client cannot approve its own record, or touch review fields at all", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(query(db.pool, user(alice), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start, review_status) values ($1,$2,'owner','H','{WW}','2020-01-01','approved')", [rel, alice])).rejects.toThrow(/permission denied/);
    const id = await declareRights(db.pool, alice, rel);
    await expect(query(db.pool, user(alice), "update public.rights_records set review_status = 'approved' where id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(alice), "delete from public.rights_records where id = $1", [id])).rejects.toThrow(/permission denied/);
  });
  it("DENIED: invalid territories and impossible terms", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    for (const bad of ["{Liberia}", "{lr}", "{}", "{LR,USA}", "{L R}"]) {
      await expect(query(db.pool, user(alice), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start) values ($1,$2,'owner','H',$3,'2020-01-01')", [rel, alice, bad])).rejects.toThrow(/violates check|row-level/);
    }
    await expect(query(db.pool, user(alice), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start, term_end) values ($1,$2,'owner','H','{WW}','2020-01-01','2019-01-01')", [rel, alice])).rejects.toThrow(/violates check/);
  });
  it("DENIED: reading — other artists and anon see nothing; ALLOWED: owner and admin", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = await declareRights(db.pool, alice, rel);
    expect((await query(db.pool, user(bob), "select 1 from public.rights_records where id = $1", [id])).rowCount).toBe(0);
    await expect(query(db.pool, anon, "select 1 from public.rights_records")).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, user(alice), "select 1 from public.rights_records where id = $1", [id])).rowCount).toBe(1);
    expect((await query(db.pool, user(admin), "select 1 from public.rights_records where id = $1", [id])).rowCount).toBe(1);
  });
  it("DENIED: no new record once the release has been submitted", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await createTrack(db.pool, alice, aliceArtist, rel);
    await declareRights(db.pool, alice, rel);
    await query(db.pool, user(alice), "update public.releases set status = 'in_review' where id = $1", [rel]);
    await expect(insertRecord(alice, rel)).rejects.toThrow(/row-level security/);
  });
});

describe("rights review (admin only, audited)", () => {
  it("DENIED: non-admins; ALLOWED: admin, and the decision is written to the audit log", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = await declareRights(db.pool, alice, rel);
    await expect(query(db.pool, user(alice), "select public.review_rights_record($1,'approved',null)", [id])).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, anon, "select public.review_rights_record($1,'approved',null)", [id])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(admin), "select public.review_rights_record($1,'rejected',null)", [id])).rejects.toThrow(/note is required/);
    await expect(query(db.pool, user(admin), "select public.review_rights_record($1,'maybe','x')", [id])).rejects.toThrow(/Bad status/);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [id]);
    const row = await query<{ review_status: string; reviewed_by: string }>(db.pool, superuser, "select review_status, reviewed_by from public.rights_records where id = $1", [id]);
    expect(row.rows[0]).toEqual({ review_status: "approved", reviewed_by: admin });
    expect((await query(db.pool, superuser, "select 1 from public.audit_log where action = 'review_rights' and target_id = $1", [id])).rowCount).toBe(1);
  });
});

describe("rights evidence references", () => {
  let rel: string, rec: string;
  beforeAll(async () => {
    rel = await createDraftRelease(db.pool, alice, aliceArtist);
    rec = await declareRights(db.pool, alice, rel);
  });
  const add = (who: string, path: string, record = rec) =>
    query(db.pool, user(who), "insert into public.rights_evidence (rights_record_id, kind, storage_path, added_by) values ($1,'contract',$2,$3)", [record, path, who]);

  it("ALLOWED: the owner attaches a reference under their own evidence folder", async () => {
    expect((await add(alice, `evidence/${aliceArtist}/${rel}/contract.pdf`)).rowCount).toBe(1);
  });
  it("DENIED: wrong folder, traversal, other artists", async () => {
    await expect(add(alice, `evidence/${bobArtist}/${rel}/x.pdf`)).rejects.toThrow(/row-level security/);
    await expect(add(alice, `evidence/${aliceArtist}/${rel}/../../etc/passwd`)).rejects.toThrow(/violates check|row-level/);
    await expect(add(bob, `evidence/${bobArtist}/${rel}/x.pdf`)).rejects.toThrow(/row-level security/);
  });
  it("DENIED: reading by others; ALLOWED: owner + admin", async () => {
    expect((await query(db.pool, user(bob), "select 1 from public.rights_evidence")).rowCount).toBe(0);
    expect(((await query(db.pool, user(alice), "select 1 from public.rights_evidence")).rowCount ?? 0)).toBeGreaterThan(0);
    expect(((await query(db.pool, user(admin), "select 1 from public.rights_evidence")).rowCount ?? 0)).toBeGreaterThan(0);
    await expect(query(db.pool, anon, "select 1 from public.rights_evidence")).rejects.toThrow(/permission denied/);
  });
  it("DENIED: no more evidence once the record has been reviewed", async () => {
    await query(db.pool, user(admin), "select public.review_rights_record($1,'changes_requested','need the signed contract')", [rec]);
    await expect(add(alice, `evidence/${aliceArtist}/${rel}/late.pdf`)).rejects.toThrow(/row-level security/);
  });
});

describe("publish gate", () => {
  async function release() {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await createTrack(db.pool, alice, aliceArtist, rel);
    return rel;
  }
  const publish = (rel: string) => query(db.pool, user(admin), "select public.moderate_release($1,'published',null)", [rel]);

  it("DENIED: no rights record, a pending one, a rejected one, an expired term, a not-yet-started term", async () => {
    const none = await release();
    await expect(publish(none)).rejects.toThrow(/approved, in-term rights record/);

    const pending = await release();
    await declareRights(db.pool, alice, pending);
    await expect(publish(pending)).rejects.toThrow(/approved, in-term/);

    const rejected = await release();
    const r1 = await declareRights(db.pool, alice, rejected);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'rejected','not ours')", [r1]);
    await expect(publish(rejected)).rejects.toThrow(/approved, in-term/);

    const expired = await release();
    const r2 = await declareRights(db.pool, alice, expired, { termStart: "2019-01-01", termEnd: "2020-01-01" });
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [r2]);
    await expect(publish(expired)).rejects.toThrow(/approved, in-term/);

    const future = await release();
    const r3 = await declareRights(db.pool, alice, future, { termStart: "2999-01-01" });
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [r3]);
    await expect(publish(future)).rejects.toThrow(/approved, in-term/);
  });
  it("DENIED: the artist still cannot publish, even with approved rights", async () => {
    const rel = await release();
    const r = await declareRights(db.pool, alice, rel);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [r]);
    await expect(query(db.pool, user(alice), "update public.releases set status = 'published' where id = $1", [rel])).rejects.toThrow(/Only an admin/);
  });
  it("ALLOWED: admin publishes with an approved, in-term record", async () => {
    const rel = await release();
    const r = await declareRights(db.pool, alice, rel);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [r]);
    await publish(rel);
    expect((await query<{ status: string }>(db.pool, superuser, "select status from public.releases where id = $1", [rel])).rows[0]?.status).toBe("published");
  });
});

describe("playback gate: get_playback_target", () => {
  const target = (track: string, country: string | null, low = false) =>
    query<{ variant: string; storage_key: string }>(db.pool, service, "select * from public.get_playback_target($1, $2, $3)", [track, country, low]);

  it("DENIED for every client role; ALLOWED for the service role only", async () => {
    const live = await goLive(db.pool, admin, "gate-roles");
    for (const who of [anon, user(alice), user(live.ownerId), user(admin)]) {
      await expect(query(db.pool, who, "select * from public.get_playback_target($1,'LR',false)", [live.trackId])).rejects.toThrow(/permission denied/);
    }
    expect((await target(live.trackId, "LR")).rowCount).toBe(1);
  });
  it("returns the standard rendition, or the low one for data saver", async () => {
    const live = await goLive(db.pool, admin, "gate-variant");
    expect((await target(live.trackId, "LR")).rows[0]).toMatchObject({ variant: "std", storage_key: `audio/${live.artistId}/${live.trackId}/std.m4a` });
    expect((await target(live.trackId, "LR", true)).rows[0]).toMatchObject({ variant: "low", storage_key: `audio/${live.artistId}/${live.trackId}/low.m4a` });
  });
  it("territory: worldwide matches everyone; a country list matches only those; unknown country matches only worldwide", async () => {
    const ww = await goLive(db.pool, admin, "gate-ww", { territories: ["WW"] });
    for (const c of ["LR", "US", null, "", "  "]) expect((await target(ww.trackId, c)).rowCount, `WW/${c}`).toBe(1);

    const lr = await goLive(db.pool, admin, "gate-lr", { territories: ["LR", "GH"] });
    expect((await target(lr.trackId, "LR")).rowCount).toBe(1);
    expect((await target(lr.trackId, "lr")).rowCount).toBe(1);
    expect((await target(lr.trackId, "GH")).rowCount).toBe(1);
    for (const c of ["US", "NG", null, "", "  ", "??"]) expect((await target(lr.trackId, c)).rowCount, `LR-only/${c}`).toBe(0);
  });
  it("DENIED when the track is not ready, the release is not published, or the artist is suspended", async () => {
    const live = await goLive(db.pool, admin, "gate-state");
    await query(db.pool, superuser, "update public.tracks set processing_status = 'processing' where id = $1", [live.trackId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(0);
    await query(db.pool, superuser, "update public.tracks set processing_status = 'ready' where id = $1", [live.trackId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(1);
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [live.artistId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(0);

    const draft = await createDraftRelease(db.pool, alice, aliceArtist);
    const t = await createTrack(db.pool, alice, aliceArtist, draft);
    expect((await target(t, "LR")).rowCount).toBe(0);
    expect((await target("00000000-0000-0000-0000-000000000000", "LR")).rowCount).toBe(0);
  });
  it("DENIED once the rights term ends or the record is withdrawn", async () => {
    const live = await goLive(db.pool, admin, "gate-term", { termStart: "2020-01-01", termEnd: "2099-01-01" });
    expect((await target(live.trackId, "LR")).rowCount).toBe(1);
    await query(db.pool, superuser, "update public.rights_records set term_end = current_date - 1 where id = $1", [live.rightsId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(0);
    await query(db.pool, superuser, "update public.rights_records set term_end = null where id = $1", [live.rightsId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(1);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'rejected','license withdrawn')", [live.rightsId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(0);
  });
  it("TAKEDOWN: moderate_release(removed) blocks the very next authorization and is audited", async () => {
    const live = await goLive(db.pool, admin, "gate-takedown");
    expect((await target(live.trackId, "LR")).rowCount).toBe(1);
    await expect(query(db.pool, user(admin), "select public.moderate_release($1,'removed','  ')", [live.releaseId])).rejects.toThrow(/reason is required/);
    await query(db.pool, user(admin), "select public.moderate_release($1,'removed','rights holder complaint')", [live.releaseId]);
    expect((await target(live.trackId, "LR")).rowCount).toBe(0);
    expect((await query(db.pool, superuser, "select 1 from public.audit_log where action = 'moderate_release' and target_id = $1 and detail->>'status' = 'removed'", [live.releaseId])).rowCount).toBe(1);
    expect((await query(db.pool, anon, "select 1 from public.releases where id = $1", [live.releaseId])).rowCount).toBe(0);
  });
});
