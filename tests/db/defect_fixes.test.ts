import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, goLive, makeAdmin, query, superuser, user, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
});
afterAll(async () => db.drop());

describe("policy helpers are no longer public API functions", () => {
  it("public.is_admin / public.owns_artist do not exist; they live in the private schema and RLS still works", async () => {
    const r = await query<{ s: string; n: string }>(db.pool, superuser,
      "select n.nspname s, p.proname n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('is_admin','owns_artist')");
    expect(r.rows.map((x) => `${x.s}.${x.n}`).sort()).toEqual(["private.is_admin", "private.owns_artist"]);
    for (const who of [anon, user(admin)]) {
      await expect(query(db.pool, who, "select public.is_admin()")).rejects.toThrow(/does not exist/);
      await expect(query(db.pool, who, "select public.owns_artist(gen_random_uuid())")).rejects.toThrow(/does not exist/);
    }
    // policies that call the helpers still evaluate for every role
    expect((await query(db.pool, anon, "select 1 from public.releases")).rowCount).toBe(0);
    expect((await query(db.pool, user(admin), "select 1 from public.profiles")).rowCount).toBeGreaterThan(0);
  });
  it("the rewritten admin functions still enforce admin-only", async () => {
    const owner = await createUser(db.pool, "fix-nonadmin");
    await expect(query(db.pool, user(owner), "select public.moderate_release(gen_random_uuid(), 'removed', 'x')")).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, user(owner), "select public.review_rights_record(gen_random_uuid(), 'approved', null)")).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, user(owner), "select public.resolve_copyright_report(gen_random_uuid(), 'upheld', 'x')")).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, user(owner), "select public.approve_artist_application(gen_random_uuid())")).rejects.toThrow(/Admin only/);
  });
});

describe("account deletion keeps the audit trail", () => {
  it("deleting an admin who reviewed rights and moderated: succeeds, history stays, actor becomes NULL", async () => {
    const reviewer = await makeAdmin(db.pool, "fix-reviewer");
    const live = await goLive(db.pool, reviewer, "fix-del-admin");
    const before = (await query(db.pool, superuser, "select count(*)::int n from public.audit_log")).rows[0]!.n;
    expect(before).toBeGreaterThan(0);
    await query(db.pool, superuser, "delete from auth.users where id = $1", [reviewer]);
    const after = await query<{ n: number; nulls: number }>(db.pool, superuser,
      "select count(*)::int n, count(*) filter (where actor_id is null)::int nulls from public.audit_log");
    expect(after.rows[0]!.n).toBe(before); // nothing lost
    expect(after.rows[0]!.nulls).toBeGreaterThan(0);
    const rec = await query<{ review_status: string; reviewed_by: string | null }>(db.pool, superuser, "select review_status, reviewed_by from public.rights_records where id = $1", [live.rightsId]);
    expect(rec.rows[0]).toEqual({ review_status: "approved", reviewed_by: null });
  });
  it("deleting an artist owner removes their catalog but keeps audit rows", async () => {
    const live = await goLive(db.pool, admin, "fix-del-owner");
    await query(db.pool, superuser, "delete from auth.users where id = $1", [live.ownerId]);
    expect((await query(db.pool, superuser, "select 1 from public.releases where id = $1", [live.releaseId])).rowCount).toBe(0);
    expect((await query(db.pool, superuser, "select 1 from public.tracks where id = $1", [live.trackId])).rowCount).toBe(0);
    expect((await query(db.pool, superuser, "select 1 from public.audit_log where target_id = $1", [live.releaseId])).rowCount).toBeGreaterThan(0);
  });
  it("audit_log is STILL append-only: no edits, no other column changes, no deletes, no truncate", async () => {
    const row = (await query<{ id: string }>(db.pool, superuser, "select id from public.audit_log limit 1")).rows[0]!.id;
    for (const sql of [
      "update public.audit_log set action = 'forged' where id = $1",
      "update public.audit_log set actor_id = $2 where id = $1", // re-pointing an actor is not the FK action
      "delete from public.audit_log where id = $1",
    ]) {
      await expect(query(db.pool, superuser, sql, sql.includes("$2") ? [row, admin] : [row]), sql).rejects.toThrow(/append-only/);
    }
    await expect(query(db.pool, superuser, "truncate public.audit_log")).rejects.toThrow(/append-only/);
  });
});

describe("anonymous visitors cannot read the owning account of an artist", () => {
  it("DENIED: anon select of owner_id or *; ALLOWED: public columns; signed-in users keep owner_id", async () => {
    const live = await goLive(db.pool, admin, "fix-owner-col");
    await expect(query(db.pool, anon, "select owner_id from public.artists")).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, anon, "select * from public.artists")).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, anon, "select id, slug, name, bio, image_url, status, created_at from public.artists where id = $1", [live.artistId])).rowCount).toBe(1);
    expect((await query(db.pool, user(live.ownerId), "select owner_id from public.artists where id = $1", [live.artistId])).rows[0]).toEqual({ owner_id: live.ownerId });
  });
});

describe("rights records for already-published releases", () => {
  async function published(label: string) {
    return goLive(db.pool, admin, label);
  }
  const add = (who: string, rel: string, holder = "Holder") =>
    query(db.pool, user(who), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start) values ($1,$2,'owner',$3,'{LR}','2020-01-01') returning id", [rel, who, holder]);

  it("ALLOWED: the owner adds a PENDING record to their published release; it does not grant playback until an admin approves", async () => {
    const live = await published("fix-rights-pub");
    await query(db.pool, superuser, "delete from public.rights_records where id = $1", [live.rightsId]); // simulate a pre-rights-era release
    const target = (c = "LR") => query(db.pool, { role: "service_role" }, "select * from public.get_playback_target($1,$2,false)", [live.trackId, c]);
    expect((await target()).rowCount).toBe(0);
    const id = (await add(live.ownerId, live.releaseId)).rows[0]!.id as string;
    expect((await query<{ review_status: string }>(db.pool, superuser, "select review_status from public.rights_records where id = $1", [id])).rows[0]!.review_status).toBe("pending");
    expect((await target()).rowCount).toBe(0); // pending is not enough
    await query(db.pool, user(live.ownerId), "insert into public.rights_evidence (rights_record_id, kind, storage_path, added_by) values ($1,'contract',$2,$3)", [id, `evidence/${live.artistId}/${live.releaseId}/c.pdf`, live.ownerId]);
    await query(db.pool, user(admin), "select public.review_rights_record($1,'approved',null)", [id]);
    expect((await target("LR")).rowCount).toBe(1);
    expect((await target("US")).rowCount).toBe(0); // territory still enforced
  });
  it("DENIED: other artists, in_review and removed releases, and self-approval", async () => {
    const live = await published("fix-rights-deny");
    const other = await createUser(db.pool, "fix-other");
    await createApprovedArtist(db.pool, admin, other, "Other One");
    await expect(add(other, live.releaseId)).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(live.ownerId), "insert into public.rights_records (release_id, declared_by, basis, rights_holder_name, territories, term_start, review_status) values ($1,$2,'owner','H','{LR}','2020-01-01','approved')", [live.releaseId, live.ownerId])).rejects.toThrow(/permission denied/);
    await query(db.pool, user(admin), "select public.moderate_release($1,'removed','takedown')", [live.releaseId]);
    await expect(add(live.ownerId, live.releaseId)).rejects.toThrow(/row-level security|violates/);
    const review = await createDraftRelease(db.pool, live.ownerId, live.artistId, "in review rel");
    await createTrack(db.pool, live.ownerId, live.artistId, review);
    await declareRights(db.pool, live.ownerId, review);
    await query(db.pool, user(live.ownerId), "update public.releases set status = 'in_review' where id = $1", [review]);
    await expect(add(live.ownerId, review)).rejects.toThrow(/row-level security/);
  });
});
