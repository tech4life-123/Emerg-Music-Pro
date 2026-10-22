import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, declareRights, goLive, makeAdmin, query, superuser, user, type TestDb,
} from "./helpers";

/** PRD acceptance: "Published catalog items are discoverable; draft, rejected, and withdrawn items do not appear publicly." */
let db: TestDb;
let admin: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
});
afterAll(async () => db.drop());

// The exact shapes the catalog repo issues (inner join on artists), run as the anonymous role.
const publicReleases = (who = anon) =>
  query<{ id: string }>(db.pool, who, "select r.id from public.releases r join public.artists a on a.id = r.artist_id where r.status = 'published'");
const publicTracks = (releaseId: string) =>
  query<{ id: string }>(db.pool, anon, "select id from public.tracks where release_id = $1", [releaseId]);

describe("public catalog visibility (anonymous visitor)", () => {
  it("ALLOWED: a published release of an approved artist and its tracks are visible", async () => {
    const live = await goLive(db.pool, admin, "vis-ok");
    expect((await publicReleases()).rows.map((r) => r.id)).toContain(live.releaseId);
    expect((await publicTracks(live.releaseId)).rowCount).toBe(1);
    expect((await query(db.pool, anon, "select 1 from public.artists where id = $1", [live.artistId])).rowCount).toBe(1);
  });

  it("DENIED: draft, in_review and removed releases (and their tracks) are invisible", async () => {
    const owner = await createUser(db.pool, "vis-states");
    const artist = await createApprovedArtist(db.pool, admin, owner, "States Artist");
    const draft = await createDraftRelease(db.pool, owner, artist, "draft one");
    await createTrack(db.pool, owner, artist, draft);
    const review = await createDraftRelease(db.pool, owner, artist, "review one");
    await createTrack(db.pool, owner, artist, review);
    await declareRights(db.pool, owner, review);
    await query(db.pool, user(owner), "update public.releases set status = 'in_review' where id = $1", [review]);
    const gone = await goLive(db.pool, admin, "vis-removed");
    await query(db.pool, user(admin), "select public.moderate_release($1,'removed','takedown')", [gone.releaseId]);
    for (const id of [draft, review, gone.releaseId]) {
      expect((await query(db.pool, anon, "select 1 from public.releases where id = $1", [id])).rowCount, `release ${id}`).toBe(0);
      expect((await publicTracks(id)).rowCount, `tracks of ${id}`).toBe(0);
    }
  });

  it("DENIED: a suspended artist's published release disappears from the public catalog and its tracks are unreadable", async () => {
    const live = await goLive(db.pool, admin, "vis-suspended");
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [live.artistId]);
    expect((await query(db.pool, anon, "select 1 from public.artists where id = $1", [live.artistId])).rowCount).toBe(0);
    expect((await publicReleases()).rows.map((r) => r.id)).not.toContain(live.releaseId);
    expect((await query(db.pool, anon, "select 1 from public.releases where id = $1", [live.releaseId])).rowCount).toBe(0);
    expect((await publicTracks(live.releaseId)).rowCount).toBe(0);
  });

  it("an admin still sees a suspended artist's release; the suspended artist's own owner loses access (existing owns_artist rule)", async () => {
    const live = await goLive(db.pool, admin, "vis-owner");
    await query(db.pool, superuser, "update public.artists set status = 'suspended' where id = $1", [live.artistId]);
    expect((await query(db.pool, user(live.ownerId), "select 1 from public.releases where id = $1", [live.releaseId])).rowCount).toBe(0);
    expect((await query(db.pool, user(admin), "select 1 from public.releases where id = $1", [live.releaseId])).rowCount).toBe(1);
  });

  it("DENIED: audio storage paths are not selectable, and search patterns with wildcards are matched literally", async () => {
    const live = await goLive(db.pool, admin, "vis-cols");
    await expect(query(db.pool, anon, "select audio_std_path from public.tracks where id = $1", [live.trackId])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, anon, "select * from public.tracks where id = $1", [live.trackId])).rejects.toThrow(/permission denied/);
    // '%' escaped as the repo does must not match every row
    const all = await query(db.pool, anon, "select 1 from public.releases where title ilike $1", ["%\\%%"]);
    expect(all.rowCount).toBe(0);
  });
});
