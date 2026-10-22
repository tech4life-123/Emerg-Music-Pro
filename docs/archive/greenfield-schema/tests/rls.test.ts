import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addReadyRendition, addRole, anon, as, createArtist, createDraftTrack, createTestDb, createUser,
  declareRights, publishTrack, service, superuser, user, verifyArtist, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string;
let mod: string;
let listener: string;
let alice: string; // artist owner A
let bob: string; // artist owner B
let artistA: string;
let artistB: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createUser(db.pool, "admin");
  mod = await createUser(db.pool, "moderator");
  listener = await createUser(db.pool, "listener");
  alice = await createUser(db.pool, "alice");
  bob = await createUser(db.pool, "bob");
  await addRole(db.pool, admin, "admin");
  await addRole(db.pool, mod, "moderator");
  artistA = await createArtist(db.pool, alice, "Artist A");
  artistB = await createArtist(db.pool, bob, "Artist B");
  await verifyArtist(db.pool, mod, artistA);
  await verifyArtist(db.pool, mod, artistB);
});

afterAll(async () => {
  await db?.drop();
});

describe("bootstrap", () => {
  it("creates a profile and a listener role for every new auth user", async () => {
    const r = await as(db.pool, user(listener), async (c) => ({
      p: await c.query("select display_name from public.profiles where id = $1", [listener]),
      roles: await c.query("select role from public.user_roles where user_id = $1", [listener]),
    }));
    expect(r.p.rows[0].display_name).toBe("listener");
    expect(r.roles.rows.map((x) => x.role)).toEqual(["listener"]);
  });
});

describe("profiles", () => {
  it("ALLOWS a user to read and edit their own profile", async () => {
    await as(db.pool, user(listener), (c) =>
      c.query("update public.profiles set display_name = 'Renamed' where id = $1", [listener]),
    );
    const r = await as(db.pool, user(listener), (c) => c.query("select display_name from public.profiles"));
    expect(r.rows).toEqual([{ display_name: "Renamed" }]);
  });
  it("DENIES reading or editing someone else's profile", async () => {
    const seen = await as(db.pool, user(alice), (c) => c.query("select id from public.profiles where id = $1", [listener]));
    expect(seen.rowCount).toBe(0);
    const upd = await as(db.pool, user(alice), (c) =>
      c.query("update public.profiles set display_name = 'hacked' where id = $1", [listener]),
    );
    expect(upd.rowCount).toBe(0);
  });
  it("DENIES anonymous access and changing the primary key", async () => {
    await expect(as(db.pool, anon, (c) => c.query("select * from public.profiles"))).rejects.toThrow(/permission denied/);
    await expect(
      as(db.pool, user(listener), (c) => c.query("update public.profiles set id = gen_random_uuid() where id = $1", [listener])),
    ).rejects.toThrow(/permission denied/);
  });
  it("ALLOWS staff to read profiles", async () => {
    const r = await as(db.pool, user(mod), (c) => c.query("select count(*)::int as n from public.profiles"));
    expect(r.rows[0].n).toBeGreaterThanOrEqual(5);
  });
});

describe("roles", () => {
  it("DENIES a user inserting a role directly (self-escalation)", async () => {
    await expect(
      as(db.pool, user(listener), (c) => c.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [listener])),
    ).rejects.toThrow(/permission denied/);
  });
  it("DENIES grant_role for a non-admin, including a moderator", async () => {
    await expect(as(db.pool, user(listener), (c) => c.query("select public.grant_role($1, 'admin')", [listener]))).rejects.toThrow(/admin only/);
    await expect(as(db.pool, user(mod), (c) => c.query("select public.grant_role($1, 'admin')", [mod]))).rejects.toThrow(/admin only/);
  });
  it("DENIES anon calling the role RPCs", async () => {
    await expect(as(db.pool, anon, (c) => c.query("select public.grant_role($1, 'admin')", [listener]))).rejects.toThrow(/permission denied/);
  });
  it("ALLOWS an admin to grant a role, and the grant is audited", async () => {
    const target = await createUser(db.pool, "newmod");
    await as(db.pool, user(admin), (c) => c.query("select public.grant_role($1, 'moderator')", [target]));
    const log = await as(db.pool, user(admin), (c) =>
      c.query("select actor_kind, after_state from public.audit_logs where action = 'role.granted' and target_id = $1 order by id desc", [target]),
    );
    expect(log.rows[0].actor_kind).toBe("admin");
    expect(log.rows[0].after_state).toEqual({ role: "moderator" });
  });
  it("DENIES revoking the last admin", async () => {
    await expect(as(db.pool, user(admin), (c) => c.query("select public.revoke_role($1, 'admin')", [admin]))).rejects.toThrow(/last admin/);
  });
  it("lets users see only their own roles", async () => {
    const r = await as(db.pool, user(alice), (c) => c.query("select distinct user_id from public.user_roles"));
    expect(r.rows).toEqual([{ user_id: alice }]);
  });
});

describe("audit_logs", () => {
  it("DENIES non-admins (listener, artist, moderator) reading the audit log", async () => {
    for (const who of [listener, alice, mod]) {
      const r = await as(db.pool, user(who), (c) => c.query("select id from public.audit_logs"));
      expect(r.rowCount).toBe(0);
    }
    await expect(as(db.pool, anon, (c) => c.query("select id from public.audit_logs"))).rejects.toThrow(/permission denied/);
  });
  it("ALLOWS admins to read it", async () => {
    const r = await as(db.pool, user(admin), (c) => c.query("select count(*)::int as n from public.audit_logs"));
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
  it("DENIES any direct write by clients", async () => {
    await expect(
      as(db.pool, user(admin), (c) => c.query("insert into public.audit_logs (actor_kind, action, target_type) values ('x','x','x')")),
    ).rejects.toThrow(/permission denied/);
  });
  it("is append-only even for the database owner (update/delete/truncate blocked)", async () => {
    await expect(as(db.pool, superuser, (c) => c.query("update public.audit_logs set action = 'tamper'"))).rejects.toThrow(/append-only/);
    await expect(as(db.pool, superuser, (c) => c.query("delete from public.audit_logs"))).rejects.toThrow(/append-only/);
    await expect(as(db.pool, superuser, (c) => c.query("truncate public.audit_logs"))).rejects.toThrow(/append-only/);
  });
});

describe("artists", () => {
  it("makes the creator an owner member and an 'artist' role holder, with an audit record", async () => {
    const carol = await createUser(db.pool, "carol");
    const id = await createArtist(db.pool, carol, "Carol Band");
    const r = await as(db.pool, user(carol), async (c) => ({
      m: await c.query("select role from public.artist_members where artist_id = $1 and user_id = $2", [id, carol]),
      roles: await c.query("select role from public.user_roles where user_id = $1 order by role", [carol]),
    }));
    expect(r.m.rows).toEqual([{ role: "owner" }]);
    expect(r.roles.rows.map((x) => x.role).sort()).toEqual(["artist", "listener"]);
    const a = await as(db.pool, user(admin), (c) => c.query("select 1 from public.audit_logs where action = 'artist.created' and target_id = $1", [id]));
    expect(a.rowCount).toBe(1);
  });
  it("DENIES direct inserts into artists and anonymous create_artist", async () => {
    await expect(
      as(db.pool, user(listener), (c) => c.query("insert into public.artists (slug, name) values ('sneaky', 'Sneaky')")),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db.pool, anon, (c) => c.query("select public.create_artist('x','xx')"))).rejects.toThrow(/permission denied/);
  });
  it("hides unverified artists from the public but not from their members or staff", async () => {
    const dave = await createUser(db.pool, "dave");
    const id = await createArtist(db.pool, dave, "Dave Unverified");
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.artists where id = $1", [id]))).rowCount).toBe(0);
    expect((await as(db.pool, user(listener), (c) => c.query("select 1 from public.artists where id = $1", [id]))).rowCount).toBe(0);
    expect((await as(db.pool, user(dave), (c) => c.query("select 1 from public.artists where id = $1", [id]))).rowCount).toBe(1);
    expect((await as(db.pool, user(mod), (c) => c.query("select 1 from public.artists where id = $1", [id]))).rowCount).toBe(1);
  });
  it("shows verified artists to anonymous visitors", async () => {
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.artists where id = $1", [artistA]))).rowCount).toBe(1);
  });
  it("DENIES a member self-verifying, but ALLOWS requesting verification", async () => {
    const erin = await createUser(db.pool, "erin");
    const id = await createArtist(db.pool, erin, "Erin Self");
    await expect(
      as(db.pool, user(erin), (c) => c.query("update public.artists set verification = 'verified' where id = $1", [id])),
    ).rejects.toThrow(/only staff may change artist verification/);
    await as(db.pool, user(erin), (c) => c.query("update public.artists set verification = 'pending' where id = $1", [id]));
    await as(db.pool, user(mod), (c) => c.query("update public.artists set verification = 'verified' where id = $1", [id]));
    const log = await as(db.pool, user(admin), (c) =>
      c.query("select after_state from public.audit_logs where action = 'artist.verification_changed' and target_id = $1 order by id", [id]),
    );
    expect(log.rows.map((r) => r.after_state.verification)).toEqual(["pending", "verified"]);
  });
  it("DENIES editing another artist's profile", async () => {
    const r = await as(db.pool, user(bob), (c) => c.query("update public.artists set bio = 'defaced' where id = $1", [artistA]));
    expect(r.rowCount).toBe(0);
  });
  it("ALLOWS a member to edit their own artist profile", async () => {
    const r = await as(db.pool, user(alice), (c) => c.query("update public.artists set bio = 'Real bio' where id = $1", [artistA]));
    expect(r.rowCount).toBe(1);
  });
});

describe("genres", () => {
  it("ALLOWS public read, DENIES non-admin writes, ALLOWS admin writes", async () => {
    await as(db.pool, user(admin), (c) => c.query("insert into public.genres (slug, name) values ('afrobeats', 'Afrobeats')"));
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.genres"))).rowCount).toBe(1);
    await expect(
      as(db.pool, user(mod), (c) => c.query("insert into public.genres (slug, name) values ('hiplife', 'Hiplife')")),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db.pool, anon, (c) => c.query("insert into public.genres (slug, name) values ('x','x')"))).rejects.toThrow(/permission denied/);
  });
});

describe("releases and tracks: publication rules", () => {
  it("DENIES an unverified artist creating releases", async () => {
    const frank = await createUser(db.pool, "frank");
    const id = await createArtist(db.pool, frank, "Frank Unverified");
    await expect(
      as(db.pool, user(frank), (c) => c.query("insert into public.releases (artist_id, title) values ($1, 'x')", [id])),
    ).rejects.toThrow(/row-level security/);
  });
  it("ALLOWS a verified member to create a draft, DENIES creating one pre-published or for another artist", async () => {
    const ok = await as(db.pool, user(alice), (c) => c.query("insert into public.releases (artist_id, title) values ($1, 'Draft') returning status", [artistA]));
    expect(ok.rows[0].status).toBe("draft");
    // BEFORE-INSERT trigger fires ahead of RLS WITH CHECK; both layers deny, either message is correct.
    await expect(
      as(db.pool, user(alice), (c) => c.query("insert into public.releases (artist_id, title, status) values ($1, 'x', 'published')", [artistA])),
    ).rejects.toThrow(/row-level security|new rows must start as draft/);
    await expect(
      as(db.pool, user(alice), (c) => c.query("insert into public.releases (artist_id, title) values ($1, 'x')", [artistB])),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db.pool, anon, (c) => c.query("insert into public.releases (artist_id, title) values ($1, 'x')", [artistA]))).rejects.toThrow(/permission denied/);
  });
  it("DENIES attaching a track to another artist's release (composite FK)", async () => {
    const { releaseId } = await createDraftTrack(db.pool, alice, artistA, "Mine");
    await expect(
      as(db.pool, user(bob), (c) =>
        c.query("insert into public.tracks (release_id, artist_id, title, track_number) values ($1, $2, 'Smuggled', 2)", [releaseId, artistB]),
      ),
    ).rejects.toThrow(/foreign key|violates/);
  });
  it("keeps drafts private: invisible to anon, other artists and listeners; visible to owner and staff", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "Secret Draft");
    for (const who of [anon, user(bob), user(listener)]) {
      expect((await as(db.pool, who, (c) => c.query("select 1 from public.tracks where id = $1", [trackId]))).rowCount).toBe(0);
    }
    expect((await as(db.pool, user(alice), (c) => c.query("select 1 from public.tracks where id = $1", [trackId]))).rowCount).toBe(1);
    expect((await as(db.pool, user(mod), (c) => c.query("select 1 from public.tracks where id = $1", [trackId]))).rowCount).toBe(1);
  });
  it("DENIES another artist editing or deleting my draft", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "Hands Off");
    expect((await as(db.pool, user(bob), (c) => c.query("update public.tracks set title = 'x' where id = $1", [trackId]))).rowCount).toBe(0);
    expect((await as(db.pool, user(bob), (c) => c.query("delete from public.tracks where id = $1", [trackId]))).rowCount).toBe(0);
  });
  it("DENIES a member approving or publishing their own work (illegal transitions)", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "Self Publish");
    for (const target of ["approved", "published", "withdrawn"]) {
      await expect(
        as(db.pool, user(alice), (c) => c.query(`update public.tracks set status = '${target}' where id = $1`, [trackId])),
      ).rejects.toThrow(/illegal status transition/);
    }
  });
  it("ALLOWS submitting for review, then LOCKS the row against member edits", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "Submit Me");
    await as(db.pool, user(alice), (c) => c.query("update public.tracks set status = 'in_review' where id = $1", [trackId]));
    const edit = await as(db.pool, user(alice), (c) => c.query("update public.tracks set title = 'changed after submit' where id = $1", [trackId]));
    expect(edit.rowCount).toBe(0);
  });
  it("DENIES a moderator publishing a track that has no approved rights", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "No Rights");
    await as(db.pool, user(alice), (c) => c.query("update public.tracks set status = 'in_review' where id = $1", [trackId]));
    await as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'approved' where id = $1", [trackId]));
    await expect(
      as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'published' where id = $1", [trackId])),
    ).rejects.toThrow(/without approved, in-term rights/);
  });
  it("DENIES publishing when rights are only pending or have expired", async () => {
    const { trackId } = await createDraftTrack(db.pool, alice, artistA, "Pending Rights");
    await declareRights(db.pool, alice, trackId); // stays pending
    await as(db.pool, user(alice), (c) => c.query("update public.tracks set status = 'in_review' where id = $1", [trackId]));
    await as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'approved' where id = $1", [trackId]));
    await expect(
      as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'published' where id = $1", [trackId])),
    ).rejects.toThrow(/without approved/);

    const t2 = await createDraftTrack(db.pool, alice, artistA, "Expired Rights");
    const rid = await declareRights(db.pool, alice, t2.trackId);
    await as(db.pool, superuser, (c) => c.query("update public.rights_records set review_status='approved', term_end = current_date - 1 where id = $1", [rid]));
    await as(db.pool, user(alice), (c) => c.query("update public.tracks set status = 'in_review' where id = $1", [t2.trackId]));
    await as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'approved' where id = $1", [t2.trackId]));
    await expect(
      as(db.pool, user(mod), (c) => c.query("update public.tracks set status = 'published' where id = $1", [t2.trackId])),
    ).rejects.toThrow(/without approved/);
  });
  it("makes a fully approved track public, and the status changes are audited", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Goes Live");
    await publishTrack(db.pool, { ownerId: alice, staffId: mod, ...t });
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.tracks where id = $1", [t.trackId]))).rowCount).toBe(1);
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.releases where id = $1", [t.releaseId]))).rowCount).toBe(1);
    const log = await as(db.pool, user(admin), (c) =>
      c.query("select after_state->>'status' as s from public.audit_logs where action = 'tracks.status_changed' and target_id = $1 order by id", [t.trackId]),
    );
    expect(log.rows.map((r) => r.s)).toEqual(["in_review", "approved", "published"]);
  });
  it("keeps a published track hidden while its release is still unpublished", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Release Not Live");
    const rid = await declareRights(db.pool, alice, t.trackId);
    await as(db.pool, user(alice), (c) => c.query("update public.tracks set status = 'in_review' where id = $1", [t.trackId]));
    await as(db.pool, user(mod), async (c) => {
      await c.query("update public.rights_records set review_status = 'approved' where id = $1", [rid]);
      await c.query("update public.tracks set status = 'approved' where id = $1", [t.trackId]);
      await c.query("update public.tracks set status = 'published' where id = $1", [t.trackId]);
    });
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.tracks where id = $1", [t.trackId]))).rowCount).toBe(0);
  });
  it("hides content from anon if the artist stops being verified", async () => {
    const carolId = await createUser(db.pool, "gina");
    const ar = await createArtist(db.pool, carolId, "Gina Revoked");
    await verifyArtist(db.pool, mod, ar);
    const t = await createDraftTrack(db.pool, carolId, ar, "Soon Hidden");
    await publishTrack(db.pool, { ownerId: carolId, staffId: mod, ...t });
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.tracks where id = $1", [t.trackId]))).rowCount).toBe(1);
    await as(db.pool, user(mod), (c) => c.query("update public.artists set verification = 'rejected' where id = $1", [ar]));
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.tracks where id = $1", [t.trackId]))).rowCount).toBe(0);
  });
});

describe("rights and evidence", () => {
  it("ALLOWS a member to declare rights, DENIES other artists, DENIES pre-approved declarations", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Rights Track");
    const rid = await declareRights(db.pool, alice, t.trackId);
    expect(rid).toBeTruthy();
    await expect(declareRights(db.pool, bob, t.trackId)).rejects.toThrow(/row-level security/);
    await expect(
      as(db.pool, user(alice), (c) =>
        c.query(
          `insert into public.rights_records (track_id, declared_by, basis, rights_holder_name, territories, term_start, declaration_text, review_status)
           values ($1, $2, 'owner', 'x', '{LR}', current_date, 'x', 'approved')`,
          [t.trackId, alice],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security|pending/);
  });
  it("DENIES a member approving their own rights and editing review fields", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Self Approve");
    const rid = await declareRights(db.pool, alice, t.trackId);
    await expect(
      as(db.pool, user(alice), (c) => c.query("update public.rights_records set review_status = 'approved' where id = $1", [rid])),
    ).rejects.toThrow(/only staff may decide rights/);
    await expect(
      as(db.pool, user(alice), (c) => c.query("update public.rights_records set review_notes = 'trust me' where id = $1", [rid])),
    ).rejects.toThrow(/only staff may set review fields/);
    await expect(
      as(db.pool, user(alice), (c) => c.query("update public.rights_records set reviewed_by = $2 where id = $1", [rid, alice])),
    ).rejects.toThrow(/permission denied/);
  });
  it("records the deciding staff member and audits the decision (attribution cannot be forged)", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Decision Track");
    const rid = await declareRights(db.pool, alice, t.trackId);
    await as(db.pool, user(mod), (c) =>
      c.query("update public.rights_records set review_status = 'approved', review_notes = 'Contract verified' where id = $1", [rid]),
    );
    const r = await as(db.pool, user(mod), (c) => c.query("select reviewed_by, reviewed_at from public.rights_records where id = $1", [rid]));
    expect(r.rows[0].reviewed_by).toBe(mod);
    expect(r.rows[0].reviewed_at).not.toBeNull();
    const log = await as(db.pool, user(admin), (c) =>
      c.query("select actor_id, after_state from public.audit_logs where action = 'rights.decision' and target_id = $1", [rid]),
    );
    expect(log.rows[0].actor_id).toBe(mod);
    expect(log.rows[0].after_state).toEqual({ review_status: "approved" });
  });
  it("rejects malformed territories, term ranges and checksums", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Validation");
    const base = (territories: string, start: string, end: string) =>
      as(db.pool, user(alice), (c) =>
        c.query(
          `insert into public.rights_records (track_id, declared_by, basis, rights_holder_name, territories, term_start, term_end, declaration_text)
           values ($1, $2, 'owner', 'x', $3::text[], $4::date, $5::date, 'x')`,
          [t.trackId, alice, territories, start, end],
        ),
      );
    await expect(base("{lr}", "2026-01-01", "2027-01-01")).rejects.toThrow(/check constraint/);
    await expect(base("{}", "2026-01-01", "2027-01-01")).rejects.toThrow(/check constraint/);
    await expect(base("{LR}", "2027-01-01", "2026-01-01")).rejects.toThrow(/check constraint/);
    await expect(base("{LR,WW}", "2026-01-01", "2027-01-01")).resolves.toBeTruthy();
  });
  it("shows rights and evidence only to the owning artist and staff", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Evidence Track");
    const rid = await declareRights(db.pool, alice, t.trackId);
    await as(db.pool, user(alice), (c) =>
      c.query(
        "insert into public.rights_evidence (rights_record_id, kind, storage_key, sha256, size_bytes, uploaded_by) values ($1,'contract','evidence/a.pdf',$2,10,$3)",
        [rid, "a".repeat(64), alice],
      ),
    );
    const count = (who: Parameters<typeof as>[1], table: string) =>
      as(db.pool, who, (c) => c.query(`select 1 from public.${table}`)).then((r) => r.rowCount);
    expect(await count(user(alice), "rights_evidence")).toBe(1);
    expect(await count(user(mod), "rights_evidence")).toBe(1);
    expect(await count(user(bob), "rights_evidence")).toBe(0);
    expect(await count(user(listener), "rights_records")).toBe(0);
    await expect(count(anon, "rights_evidence")).rejects.toThrow(/permission denied/);
    await expect(count(anon, "rights_records")).rejects.toThrow(/permission denied/);
    await expect(
      as(db.pool, user(bob), (c) =>
        c.query("insert into public.rights_evidence (rights_record_id, kind, storage_key, sha256, size_bytes, uploaded_by) values ($1,'other','evidence/b.pdf',$2,10,$3)", [rid, "b".repeat(64), bob]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("audio_assets: never client readable", () => {
  it("DENIES anon and authenticated (including staff and the owning artist) any access", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Assets");
    await addReadyRendition(db.pool, t.trackId);
    for (const who of [anon, user(alice), user(mod), user(admin), user(listener)]) {
      await expect(as(db.pool, who, (c) => c.query("select storage_key from public.audio_assets"))).rejects.toThrow(/permission denied/);
    }
    await expect(
      as(db.pool, user(alice), (c) =>
        c.query("insert into public.audio_assets (track_id, kind, storage_bucket, storage_key, size_bytes, sha256) values ($1,'original','originals','x',1,$2)", [t.trackId, "c".repeat(64)]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("ALLOWS the service role, and rejects path traversal keys and duplicate uploads", async () => {
    const t = await createDraftTrack(db.pool, alice, artistA, "Svc");
    const ins = (key: string, sha: string) =>
      as(db.pool, service, (c) =>
        c.query("insert into public.audio_assets (track_id, kind, storage_bucket, storage_key, size_bytes, sha256) values ($1,'original','originals',$2,5,$3)", [t.trackId, key, sha]),
      );
    await ins("originals/ok.wav", "d".repeat(64));
    await expect(ins("../escape.wav", "e".repeat(64))).rejects.toThrow(/check constraint/);
    await expect(ins("/abs.wav", "f".repeat(64))).rejects.toThrow(/check constraint/);
    await expect(ins("originals/other-name.wav", "d".repeat(64))).rejects.toThrow(/duplicate key/); // same checksum => idempotent
  });
});

describe("playback authorization gate (get_playback_target)", () => {
  async function liveTrack(territories: string[]) {
    const t = await createDraftTrack(db.pool, alice, artistA, "Playable");
    await publishTrack(db.pool, { ownerId: alice, staffId: mod, ...t, territories });
    await addReadyRendition(db.pool, t.trackId, 64);
    await addReadyRendition(db.pool, t.trackId, 160);
    return t;
  }
  const target = (trackId: string, country: string | null, max: number | null = null) =>
    as(db.pool, service, (c) => c.query("select * from public.get_playback_target($1, $2, $3)", [trackId, country, max]));

  it("DENIES browsers (anon / authenticated) from resolving storage targets at all", async () => {
    const t = await liveTrack(["LR"]);
    await expect(as(db.pool, anon, (c) => c.query("select * from public.get_playback_target($1,'LR')", [t.trackId]))).rejects.toThrow(/permission denied/);
    await expect(as(db.pool, user(alice), (c) => c.query("select * from public.get_playback_target($1,'LR')", [t.trackId]))).rejects.toThrow(/permission denied/);
  });
  it("ALLOWS the server for a live, rights-cleared track in territory, choosing the best allowed bitrate", async () => {
    const t = await liveTrack(["LR"]);
    expect((await target(t.trackId, "LR")).rows[0].bitrate_kbps).toBe(160);
    expect((await target(t.trackId, "lr", 96)).rows[0].bitrate_kbps).toBe(64); // data-saver cap, case-insensitive country
  });
  it("DENIES outside the licensed territory, with unknown country, but ALLOWS worldwide rights", async () => {
    const t = await liveTrack(["LR"]);
    expect((await target(t.trackId, "GH")).rowCount).toBe(0);
    expect((await target(t.trackId, null)).rowCount).toBe(0);
    const w = await liveTrack(["WW"]);
    expect((await target(w.trackId, "GH")).rowCount).toBe(1);
  });
  it("DENIES drafts and tracks whose rendition is not ready", async () => {
    const d = await createDraftTrack(db.pool, alice, artistA, "Draft");
    await addReadyRendition(db.pool, d.trackId);
    expect((await target(d.trackId, "LR")).rowCount).toBe(0);
    const n = await createDraftTrack(db.pool, alice, artistA, "NotReady");
    await publishTrack(db.pool, { ownerId: alice, staffId: mod, ...n });
    await addReadyRendition(db.pool, n.trackId, 96, "processing");
    expect((await target(n.trackId, "LR")).rowCount).toBe(0);
  });
  it("takedown BLOCKS new playback authorization immediately and writes audit + case records", async () => {
    const t = await liveTrack(["LR"]);
    expect((await target(t.trackId, "LR")).rowCount).toBe(1);

    await expect(as(db.pool, user(alice), (c) => c.query("select public.takedown_track($1,'x')", [t.trackId]))).rejects.toThrow(/staff only/);
    await expect(as(db.pool, user(mod), (c) => c.query("select public.takedown_track($1,'  ')", [t.trackId]))).rejects.toThrow(/reason is required/);

    const caseId = (await as(db.pool, user(mod), (c) => c.query("select public.takedown_track($1,$2) as id", [t.trackId, "Claim from rights holder #1"]))).rows[0].id;
    expect((await target(t.trackId, "LR")).rowCount).toBe(0);
    expect((await as(db.pool, anon, (c) => c.query("select 1 from public.tracks where id = $1", [t.trackId]))).rowCount).toBe(0);

    const audit = await as(db.pool, user(admin), (c) =>
      c.query("select action, metadata from public.audit_logs where target_id = $1 and (action = 'track.takedown' or action = 'tracks.status_changed') order by id", [t.trackId]),
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toContain("track.takedown");
    expect(audit.rows.find((r) => r.action === "track.takedown").metadata.case_id).toBe(caseId);
    const c = await as(db.pool, user(mod), (x) => x.query("select kind, status from public.moderation_cases where id = $1", [caseId]));
    expect(c.rows[0]).toEqual({ kind: "takedown", status: "open" });

    // taking down twice is refused, never silently succeeds
    await expect(as(db.pool, user(mod), (x) => x.query("select public.takedown_track($1,'again')", [t.trackId]))).rejects.toThrow(/track is not live/);
    const cases = await as(db.pool, user(mod), (x) => x.query("select count(*)::int as n from public.moderation_cases where track_id = $1", [t.trackId]));
    expect(cases.rows[0].n).toBe(1); // the refused second takedown left no duplicate case
  });
  it("the owning artist CANNOT reinstate a taken-down track", async () => {
    const t = await liveTrack(["LR"]);
    await as(db.pool, user(mod), (c) => c.query("select public.takedown_track($1,'policy')", [t.trackId]));
    // RLS hides non-draft rows from member updates: 0 rows affected, no exception.
    const attempt = await as(db.pool, user(alice), (c) =>
      c.query("update public.tracks set status = 'published' where id = $1", [t.trackId]),
    );
    expect(attempt.rowCount).toBe(0);
    const state = await as(db.pool, user(mod), (c) => c.query("select status from public.tracks where id = $1", [t.trackId]));
    expect(state.rows[0].status).toBe("withdrawn");
    expect((await target(t.trackId, "LR")).rowCount).toBe(0);
  });
});

describe("moderation_cases", () => {
  it("is staff only", async () => {
    await as(db.pool, user(mod), (c) => c.query("insert into public.moderation_cases (kind, summary) values ('abuse_report', 'self-contained test case')"));
    expect((await as(db.pool, user(alice), (c) => c.query("select 1 from public.moderation_cases"))).rowCount).toBe(0);
    expect((await as(db.pool, user(listener), (c) => c.query("select 1 from public.moderation_cases"))).rowCount).toBe(0);
    expect((await as(db.pool, user(mod), (c) => c.query("select 1 from public.moderation_cases"))).rowCount).toBeGreaterThan(0);
    await expect(
      as(db.pool, user(alice), (c) => c.query("insert into public.moderation_cases (kind, summary) values ('abuse_report','x')")),
    ).rejects.toThrow(/row-level security/);
  });
});
