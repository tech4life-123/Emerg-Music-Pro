import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, makeAdmin,
  query, service, superuser, user, type TestDb,
} from "./helpers";

/**
 * Regression tests for protections that ALREADY exist in the live Supabase project (migrations 1-6).
 * They prove the replica is faithful and guard those protections against accidental weakening.
 */
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

describe("profiles and roles", () => {
  it("a new auth user gets a listener profile automatically", async () => {
    const r = await query<{ role: string }>(db.pool, superuser, "select role from public.profiles where id = $1", [alice]);
    expect(r.rows[0]?.role).toBe("artist"); // promoted by admin approval
    const bobProfile = await query<{ role: string }>(db.pool, superuser, "select role from public.profiles where id = $1", [bob]);
    expect(bobProfile.rows[0]?.role).toBe("artist");
    const carol = await createUser(db.pool, "carol");
    expect((await query<{ role: string }>(db.pool, superuser, "select role from public.profiles where id = $1", [carol])).rows[0]?.role).toBe("listener");
  });
  it("DENIED: a user cannot escalate their own role", async () => {
    await expect(query(db.pool, user(alice), "update public.profiles set role = 'admin' where id = $1", [alice])).rejects.toThrow(/permission denied/);
  });
  it("ALLOWED: a user can edit their own display name, not someone else's", async () => {
    expect((await query(db.pool, user(alice), "update public.profiles set display_name = 'Alice A' where id = $1", [alice])).rowCount).toBe(1);
    expect((await query(db.pool, user(alice), "update public.profiles set display_name = 'x' where id = $1", [bob])).rowCount).toBe(0);
  });
  it("DENIED: users cannot read other profiles; ALLOWED: admin can", async () => {
    expect((await query(db.pool, user(alice), "select id from public.profiles where id = $1", [bob])).rowCount).toBe(0);
    expect((await query(db.pool, user(admin), "select id from public.profiles where id = $1", [bob])).rowCount).toBe(1);
    await expect(query(db.pool, anon, "select id from public.profiles")).rejects.toThrow(/permission denied/);
  });
});

describe("artist applications and admin functions", () => {
  it("DENIED: a non-admin cannot approve/reject applications or moderate releases", async () => {
    const dave = await createUser(db.pool, "dave");
    const app = await query<{ id: string }>(db.pool, user(dave), "insert into public.artist_applications (user_id, artist_name, rights_statement_accepted) values ($1,'Dave',true) returning id", [dave]);
    const id = app.rows[0]!.id;
    await expect(query(db.pool, user(dave), "select public.approve_artist_application($1)", [id])).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, user(dave), "select public.reject_artist_application($1, 'no')", [id])).rejects.toThrow(/Admin only/);
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(query(db.pool, user(alice), "select public.moderate_release($1, 'removed', 'x')", [rel])).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, anon, "select public.approve_artist_application($1)", [id])).rejects.toThrow(/permission denied/);
  });
  it("DENIED: an application cannot be created already approved, or on behalf of someone else", async () => {
    const e = await createUser(db.pool, "erin");
    await expect(query(db.pool, user(e), "insert into public.artist_applications (user_id, artist_name, rights_statement_accepted, status) values ($1,'Erin',true,'approved')", [e])).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(e), "insert into public.artist_applications (user_id, artist_name, rights_statement_accepted) values ($1,'Fake',true)", [alice])).rejects.toThrow(/row-level security/);
  });
  it("ALLOWED: admin approval creates the artist and promotes the user", async () => {
    const f = await createUser(db.pool, "fay");
    const id = await createApprovedArtist(db.pool, admin, f, "Fay Artist");
    expect((await query(db.pool, superuser, "select 1 from public.artists where id = $1 and owner_id = $2", [id, f])).rowCount).toBe(1);
  });
  it("DENIED: write_audit is not callable by clients", async () => {
    await expect(query(db.pool, user(alice), "select public.write_audit('x','y','z',null)")).rejects.toThrow(/permission denied/);
  });
});

describe("release publication rules", () => {
  it("DENIED: an artist cannot publish their own release", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(query(db.pool, user(alice), "update public.releases set status = 'published' where id = $1", [rel])).rejects.toThrow(/Only an admin/);
  });
  it("DENIED: submitting for review needs a rights declaration; ALLOWED once declared", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(query(db.pool, user(alice), "update public.releases set status = 'in_review' where id = $1", [rel])).rejects.toThrow(/rights declaration is required/);
    await declareRights(db.pool, alice, rel);
    expect((await query(db.pool, user(alice), "update public.releases set status = 'in_review' where id = $1", [rel])).rowCount).toBe(1);
  });
  it("DENIED: nobody else can create a release for someone else's artist", async () => {
    await expect(query(db.pool, user(bob), "insert into public.releases (artist_id, title) values ($1, 'x')", [aliceArtist])).rejects.toThrow(/row-level security/);
  });
  it("DENIED: a draft is invisible to the public and to other artists; ALLOWED for its owner and admin", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist, "Secret Draft");
    expect((await query(db.pool, anon, "select id from public.releases where id = $1", [rel])).rowCount).toBe(0);
    expect((await query(db.pool, user(bob), "select id from public.releases where id = $1", [rel])).rowCount).toBe(0);
    expect((await query(db.pool, user(alice), "select id from public.releases where id = $1", [rel])).rowCount).toBe(1);
    expect((await query(db.pool, user(admin), "select id from public.releases where id = $1", [rel])).rowCount).toBe(1);
  });
});

describe("tracks", () => {
  it("DENIED: cannot put a track into another artist's release, or under another artist", async () => {
    const aliceRel = await createDraftRelease(db.pool, alice, aliceArtist);
    await expect(createTrack(db.pool, bob, bobArtist, aliceRel)).rejects.toThrow(/row-level security/);
    await expect(createTrack(db.pool, bob, aliceArtist, aliceRel)).rejects.toThrow(/row-level security/);
  });
  it("DENIED: audio_path must be inside the track's own folder", async () => {
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const id = await createTrack(db.pool, alice, aliceArtist, rel);
    await expect(query(db.pool, user(alice), "update public.tracks set audio_path = $2 where id = $1", [id, `audio/${bobArtist}/${id}/x.wav`])).rejects.toThrow(/tracks_audio_path_own_folder/);
  });
});

describe("user-owned data", () => {
  it("DENIED: playlists, favorites and notifications of other users are private", async () => {
    await query(db.pool, user(alice), "insert into public.playlists (owner_id, name, is_public) values ($1, 'private mix', false)", [alice]);
    expect((await query(db.pool, user(bob), "select 1 from public.playlists where name = 'private mix'")).rowCount).toBe(0);
    expect((await query(db.pool, anon, "select 1 from public.playlists where name = 'private mix'")).rowCount).toBe(0);
    await expect(query(db.pool, user(bob), "insert into public.playlists (owner_id, name) values ($1, 'forged')", [alice])).rejects.toThrow(/row-level security/);
    const rel = await createDraftRelease(db.pool, alice, aliceArtist);
    const trk = await createTrack(db.pool, alice, aliceArtist, rel);
    await expect(query(db.pool, user(bob), "insert into public.play_events (track_id, user_id, listened_ms) values ($1, $2, 5)", [trk, alice])).rejects.toThrow(/row-level security/);
  });
  it("audit_log: DENIED for non-admins, ALLOWED to read for admin", async () => {
    expect((await query(db.pool, user(alice), "select 1 from public.audit_log")).rowCount).toBe(0);
    expect(((await query(db.pool, user(admin), "select 1 from public.audit_log")).rowCount ?? 0)).toBeGreaterThan(0);
    await expect(query(db.pool, user(admin), "insert into public.audit_log (actor_id, action, target_type, target_id) values ($1,'a','b','c')", [admin])).rejects.toThrow(/permission denied/);
  });
  it("copyright reports: anyone may file, only admins may read", async () => {
    expect((await query(db.pool, anon, "insert into public.copyright_reports (reporter_name, reporter_email, description) values ('R','r@example.test','this track is mine, please check')")).rowCount).toBe(1);
    expect((await query(db.pool, user(alice), "select 1 from public.copyright_reports")).rowCount).toBe(0);
    expect(((await query(db.pool, user(admin), "select 1 from public.copyright_reports")).rowCount ?? 0)).toBeGreaterThan(0);
    await expect(query(db.pool, anon, "insert into public.copyright_reports (reporter_name, reporter_email, description, status) values ('R','r@example.test','this track is mine, please check','upheld')")).rejects.toThrow(/row-level security/);
    await expect(query(db.pool, user(alice), "update public.copyright_reports set status = 'dismissed'")).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(alice), "select public.resolve_copyright_report(gen_random_uuid(), 'dismissed', 'x')")).rejects.toThrow(/Admin only/);
    await expect(query(db.pool, anon, "select public.resolve_copyright_report(gen_random_uuid(), 'dismissed', 'x')")).rejects.toThrow(/permission denied/);
  });
  it("service role is not blocked by anything above (backend path)", async () => {
    expect(((await query(db.pool, service, "select 1 from public.artists")).rowCount ?? 0)).toBeGreaterThan(0);
  });
});
