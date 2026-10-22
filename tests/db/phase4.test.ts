import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, goLive, makeAdmin, markReady, query, service, superuser, user, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
});
afterAll(async () => db.drop());

const submit = (owner: string, rel: string) => query(db.pool, user(owner), "update public.releases set status = 'in_review' where id = $1", [rel]);
const target = (track: string) => query(db.pool, service, "select * from public.get_playback_target($1, 'LR', false)", [track]);

describe("track-level takedown", () => {
  it("DENIED for non-admins; a reason is required; ALLOWED for admins and audited", async () => {
    const live = await goLive(db.pool, admin, "td1");
    for (const who of [anon, user(live.ownerId)]) {
      await expect(query(db.pool, who, "select public.takedown_track($1, 'x')", [live.trackId])).rejects.toThrow(/permission denied|Admin only/);
    }
    await expect(query(db.pool, user(admin), "select public.takedown_track($1, '  ')", [live.trackId])).rejects.toThrow(/reason is required/);
    await query(db.pool, user(admin), "select public.takedown_track($1, 'Rights holder complaint #12')", [live.trackId]);
    const audit = await query<{ action: string; detail: { reason: string } }>(db.pool, superuser, "select action, detail from public.audit_log where target_id = $1 and action = 'takedown_track'", [live.trackId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.detail.reason).toBe("Rights holder complaint #12");
    await expect(query(db.pool, user(admin), "select public.takedown_track($1, 'again')", [live.trackId])).rejects.toThrow(/already removed/);
  });

  it("a removed track disappears for the public and other users, stays visible to its owner and admins, and cannot be played", async () => {
    const live = await goLive(db.pool, admin, "td2");
    const other = await createUser(db.pool, "td2-other");
    expect((await target(live.trackId)).rowCount).toBe(1);
    expect((await query(db.pool, anon, "select id from public.tracks where id = $1", [live.trackId])).rowCount).toBe(1);

    await query(db.pool, user(admin), "select public.takedown_track($1, 'Removed')", [live.trackId]);
    expect((await target(live.trackId)).rowCount).toBe(0); // the very next authorization is refused
    expect((await query(db.pool, anon, "select id from public.tracks where id = $1", [live.trackId])).rowCount).toBe(0);
    expect((await query(db.pool, user(other), "select id from public.tracks where id = $1", [live.trackId])).rowCount).toBe(0);
    const owner = await query<{ removal_reason: string }>(db.pool, user(live.ownerId), "select removal_reason from public.tracks where id = $1", [live.trackId]);
    expect(owner.rows[0]?.removal_reason).toBe("Removed");
    expect((await query(db.pool, user(admin), "select id from public.tracks where id = $1", [live.trackId])).rowCount).toBe(1);
    // anon cannot even select the takedown columns
    await expect(query(db.pool, anon, "select removed_at from public.tracks")).rejects.toThrow(/permission denied/);
    // artists cannot undo it themselves
    await expect(query(db.pool, user(live.ownerId), "update public.tracks set removed_at = null where id = $1", [live.trackId])).rejects.toThrow(/permission denied/);
  });

  it("restore brings it back, only for admins, audited; the release's other tracks were never affected", async () => {
    const live = await goLive(db.pool, admin, "td3");
    await query(db.pool, user(admin), "select public.takedown_track($1, 'x')", [live.trackId]);
    await expect(query(db.pool, user(live.ownerId), "select public.restore_track($1)", [live.trackId])).rejects.toThrow(/Admin only/);
    await query(db.pool, user(admin), "select public.restore_track($1, 'Complaint withdrawn')", [live.trackId]);
    expect((await target(live.trackId)).rowCount).toBe(1);
    expect((await query(db.pool, superuser, "select 1 from public.audit_log where target_id = $1 and action = 'restore_track'", [live.trackId])).rowCount).toBe(1);
    await expect(query(db.pool, user(admin), "select public.restore_track($1)", [live.trackId])).rejects.toThrow(/not removed/);
  });

  it("tracks of a suspended artist are unreadable to the public even by direct query", async () => {
    const live = await goLive(db.pool, admin, "td4");
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [live.artistId]);
    expect((await query(db.pool, anon, "select id from public.tracks where id = $1", [live.trackId])).rowCount).toBe(0);
  });
});

describe("submission gate", () => {
  async function ready() {
    const owner = await createUser(db.pool, "sg-owner");
    const artist = await createApprovedArtist(db.pool, admin, owner, "SG Artist");
    const rel = await createDraftRelease(db.pool, owner, artist);
    return { owner, artist, rel };
  }
  it("explains what is missing, one thing at a time, then lets a complete release through", async () => {
    const { owner, artist, rel } = await ready();
    await expect(submit(owner, rel)).rejects.toThrow(/rights declaration is required/);
    await query(db.pool, user(owner), "insert into public.rights_declarations (release_id, user_id, statement_version) values ($1,$2,'v1')", [rel, owner]);
    await expect(submit(owner, rel)).rejects.toThrow(/Add a rights record/);
    await declareRightsRecordOnly(owner, rel);
    await expect(submit(owner, rel)).rejects.toThrow(/at least one track/);
    const trk = await createTrack(db.pool, owner, artist, rel, "T1", { pending: true });
    await expect(submit(owner, rel)).rejects.toThrow(/processed audio/);
    await markReady(db.pool, artist, trk);
    expect((await submit(owner, rel)).rowCount).toBe(1);
  });
  it("a failed track blocks submission; a removed track does not count", async () => {
    const { owner, artist, rel } = await ready();
    await declareRights(db.pool, owner, rel);
    const good = await createTrack(db.pool, owner, artist, rel, "Good");
    const bad = await createTrack(db.pool, owner, artist, rel, "Bad", { pending: true });
    await query(db.pool, service, "select public.set_track_audio_variants($1,'failed',null,null,null)", [bad]);
    await expect(submit(owner, rel)).rejects.toThrow(/processed audio/);
    await query(db.pool, user(admin), "select public.takedown_track($1, 'not wanted')", [bad]);
    expect((await submit(owner, rel)).rowCount).toBe(1);
    void good;
  });
  it("admins are not blocked by the artist-facing gate", async () => {
    const { owner, rel } = await ready();
    await query(db.pool, user(admin), "select public.moderate_release($1, 'removed', 'test')", [rel]);
    expect((await query<{ status: string }>(db.pool, superuser, "select status from public.releases where id = $1", [rel])).rows[0]!.status).toBe("removed");
    void owner;
  });
  async function declareRightsRecordOnly(owner: string, rel: string) {
    await query(db.pool, user(owner), `insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start)
      values ($1,$2,'owner','Fixture Holder','{WW}','2020-01-01')`, [rel, owner]);
  }
});

describe("copyright reports: the public can file, nothing more", () => {
  it("files against a release; the artist is derived server-side and clients cannot write status or resolution fields", async () => {
    const live = await goLive(db.pool, admin, "rep1");
    const ins = "insert into public.copyright_reports (release_id, reporter_name, reporter_email, description) values ($1,'Reporter','r@example.test','This recording is mine and was not licensed.')";
    expect((await query(db.pool, anon, ins, [live.releaseId])).rowCount).toBe(1);
    const row = await query<{ artist_id: string; status: string; resolved_at: string | null }>(db.pool, superuser, "select artist_id, status, resolved_at from public.copyright_reports where release_id = $1", [live.releaseId]);
    expect(row.rows[0]).toMatchObject({ artist_id: live.artistId, status: "received", resolved_at: null });
    for (const col of ["status", "resolution_note", "resolved_at", "artist_id", "id", "created_at"]) {
      const val = col === "status" ? "'dismissed'" : col === "resolution_note" ? "'x'" : col === "resolved_at" ? "now()" : col === "artist_id" ? `'${live.artistId}'` : col === "id" ? "gen_random_uuid()" : "now()";
      await expect(query(db.pool, anon, `insert into public.copyright_reports (release_id, description, ${col}) values ($1,'This recording is mine and was not licensed.', ${val})`, [live.releaseId]), col).rejects.toThrow(/permission denied/);
    }
  });
  it("REGRESSION: a reported release (or its owner's account) can still be deleted; the report survives with no release", async () => {
    const live = await goLive(db.pool, admin, "rep-del");
    await query(db.pool, anon, "insert into public.copyright_reports (release_id, reporter_name, reporter_email, description) values ($1,'Reporter','r@example.test','This recording is mine and was not licensed.')", [live.releaseId]);
    await query(db.pool, superuser, "delete from auth.users where id = $1", [live.ownerId]); // cascades artist -> release
    const row = await query<{ release_id: string | null; artist_id: string | null }>(db.pool, superuser, "select release_id, artist_id from public.copyright_reports where reporter_email = 'r@example.test' order by created_at desc limit 1");
    expect(row.rows[0]).toEqual({ release_id: null, artist_id: null });
  });
  it("rejects unknown releases, a track from another release, bad emails and too-short descriptions; anon cannot read reports back", async () => {
    const a = await goLive(db.pool, admin, "rep2a");
    const b = await goLive(db.pool, admin, "rep2b");
    const desc = "'This recording is mine and was not licensed.'";
    await expect(query(db.pool, anon, `insert into public.copyright_reports (release_id, reporter_name, reporter_email, description) values (gen_random_uuid(), 'R', 'r@example.test', ${desc})`)).rejects.toThrow(/Release not found/);
    await expect(query(db.pool, anon, `insert into public.copyright_reports (release_id, track_id, reporter_name, reporter_email, description) values ($1, $2, 'R', 'r@example.test', ${desc})`, [a.releaseId, b.trackId])).rejects.toThrow(/does not belong/);
    await expect(query(db.pool, anon, `insert into public.copyright_reports (release_id, reporter_name, reporter_email, description) values ($1, 'R', 'not-an-email', ${desc})`, [a.releaseId])).rejects.toThrow(/email_check/);
    await expect(query(db.pool, anon, "insert into public.copyright_reports (release_id, reporter_name, reporter_email, description) values ($1, 'R', 'r@example.test', 'short')", [a.releaseId])).rejects.toThrow(/description_check/);
    await expect(query(db.pool, anon, "insert into public.copyright_reports (description) values ('This recording is mine and was not licensed.')")).rejects.toThrow(/Release not found/);
    await expect(query(db.pool, anon, "select id from public.copyright_reports")).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, user(a.ownerId), "select id from public.copyright_reports")).rowCount).toBe(0); // artists cannot read reports about themselves either
  });
});

describe("other write surfaces", () => {
  it("an artist application cannot set decision fields, must accept the rights statement, and only one can be pending", async () => {
    const u = await createUser(db.pool, "app-user");
    const cols = "user_id, artist_name, rights_statement_accepted";
    await expect(query(db.pool, user(u), `insert into public.artist_applications (${cols}) values ($1,'No',false)`, [u])).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(u), `insert into public.artist_applications (${cols}, decision_reason) values ($1,'Yes',true,'pre-approved')`, [u])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(u), `insert into public.artist_applications (${cols}, reviewed_at) values ($1,'Yes',true, now())`, [u])).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, user(u), `insert into public.artist_applications (${cols}, bio, links) values ($1,'Yes',true,'A bio','{https://example.test}')`, [u])).rowCount).toBe(1);
    await expect(query(db.pool, user(u), `insert into public.artist_applications (${cols}) values ($1,'Again',true)`, [u])).rejects.toThrow(/one_pending_per_user/);
  });
  it("a release cannot be created with publication fields pre-filled", async () => {
    const owner = await createUser(db.pool, "rel-owner");
    const artist = await createApprovedArtist(db.pool, admin, owner, "Rel Artist");
    for (const col of ["published_at", "removal_reason", "status", "updated_at"]) {
      const val = col === "published_at" || col === "updated_at" ? "now()" : col === "status" ? "'draft'" : "'x'";
      await expect(query(db.pool, user(owner), `insert into public.releases (artist_id, title, ${col}) values ($1,'T',${val})`, [artist]), col).rejects.toThrow(/permission denied/);
    }
    expect((await query(db.pool, user(owner), "insert into public.releases (artist_id, title, type, language) values ($1,'T','ep','en')", [artist])).rowCount).toBe(1);
  });
});
