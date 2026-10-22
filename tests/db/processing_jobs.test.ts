import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anon, createApprovedArtist, createDraftRelease, createTestDb, createTrack, createUser, makeAdmin, query, service, superuser, user, type TestDb,
} from "./helpers";

let db: TestDb;
let admin: string;
beforeAll(async () => {
  db = await createTestDb();
  admin = await makeAdmin(db.pool);
});
afterAll(async () => db.drop());

async function draftTrack(label: string) {
  const owner = await createUser(db.pool, `${label}-owner`);
  const artist = await createApprovedArtist(db.pool, admin, owner, `${label} artist`);
  const release = await createDraftRelease(db.pool, owner, artist);
  const track = await createTrack(db.pool, owner, artist, release, "Sample Track", { pending: true });
  return { owner, artist, release, track };
}
const enqueue = (track: string) => query<{ job_id: string; stale_paths: string[] }>(db.pool, service, "select * from public.enqueue_processing_job($1)", [track]);
const claim = () => query<{ job_id: string; track_id: string; original_key: string; attempts: number }>(db.pool, service, "select * from public.claim_processing_job(60)");
const trackRow = async (id: string) =>
  (await query<{ processing_status: string; audio_low_path: string | null; audio_std_path: string | null }>(db.pool, superuser,
    "select processing_status, audio_low_path, audio_std_path from public.tracks where id = $1", [id])).rows[0]!;

describe("who can touch jobs", () => {
  it("clients cannot call any job function; only service_role can", async () => {
    const t = await draftTrack("pj-perm");
    for (const who of [anon, user(t.owner), user(admin)]) {
      await expect(query(db.pool, who, "select * from public.enqueue_processing_job($1)", [t.track])).rejects.toThrow(/permission denied/);
      await expect(query(db.pool, who, "select * from public.claim_processing_job(60)")).rejects.toThrow(/permission denied/);
      await expect(query(db.pool, who, "select public.complete_processing_job(gen_random_uuid(), 'a', 'b', 1)")).rejects.toThrow(/permission denied/);
      await expect(query(db.pool, who, "select public.fail_processing_job(gen_random_uuid(), 'x', 'y')")).rejects.toThrow(/permission denied/);
    }
  });
  it("clients cannot write the table; the owner and an admin can read it; a stranger and anon cannot", async () => {
    const t = await draftTrack("pj-rls");
    const stranger = await createUser(db.pool, "pj-stranger");
    await enqueue(t.track);
    await expect(query(db.pool, user(t.owner), "insert into public.processing_jobs (track_id, original_key) values ($1, 'x')", [t.track])).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(t.owner), "update public.processing_jobs set status = 'succeeded'")).rejects.toThrow(/permission denied/);
    await expect(query(db.pool, user(t.owner), "delete from public.processing_jobs")).rejects.toThrow(/permission denied/);
    expect((await query(db.pool, user(t.owner), "select id, status from public.processing_jobs where track_id = $1", [t.track])).rowCount).toBe(1);
    expect((await query(db.pool, user(admin), "select id from public.processing_jobs where track_id = $1", [t.track])).rowCount).toBe(1);
    expect((await query(db.pool, user(stranger), "select id from public.processing_jobs where track_id = $1", [t.track])).rowCount).toBe(0);
    await expect(query(db.pool, anon, "select id from public.processing_jobs")).rejects.toThrow(/permission denied/);
    // original_key (a storage path) is not readable by clients
    await expect(query(db.pool, user(t.owner), "select original_key from public.processing_jobs")).rejects.toThrow(/permission denied/);
  });
});

describe("job lifecycle", () => {
  it("enqueue -> claim -> complete makes the track ready with its renditions", async () => {
    const t = await draftTrack("pj-ok");
    const q = await enqueue(t.track);
    expect(q.rows[0]!.stale_paths).toEqual([]);
    expect((await trackRow(t.track)).processing_status).toBe("pending");
    let got = await claim();
    // other tests share the DB queue; keep claiming until ours appears
    while (got.rows[0] && got.rows[0].track_id !== t.track) got = await claim();
    const job = got.rows[0]!;
    expect(job.attempts).toBe(1);
    expect(job.original_key).toBe(`audio/${t.artist}/${t.track}/original.wav`);
    expect((await trackRow(t.track)).processing_status).toBe("processing");
    const low = `audio/${t.artist}/${t.track}/low-1.m4a`;
    const std = `audio/${t.artist}/${t.track}/std-1.m4a`;
    expect((await query<{ r: string }>(db.pool, service, "select public.complete_processing_job($1, $2, $3, 183000) r", [job.job_id, low, std])).rows[0]!.r).toBe("succeeded");
    expect(await trackRow(t.track)).toEqual({ processing_status: "ready", audio_low_path: low, audio_std_path: std });
    // finishing twice is a no-op
    expect((await query<{ r: string }>(db.pool, service, "select public.complete_processing_job($1, $2, $3, 1) r", [job.job_id, low, std])).rows[0]!.r).toBe("not_running");
  });

  it("a rendition path outside the artist's own folder is rejected by the existing constraint", async () => {
    const t = await draftTrack("pj-path");
    await enqueue(t.track);
    let got = await claim();
    while (got.rows[0] && got.rows[0].track_id !== t.track) got = await claim();
    await expect(query(db.pool, service, "select public.complete_processing_job($1, 'audio/other/x/low.m4a', null, 1000)", [got.rows[0]!.job_id])).rejects.toThrow();
    expect((await trackRow(t.track)).processing_status).toBe("processing");
  });

  it("two workers never get the same job (SKIP LOCKED)", async () => {
    const t = await draftTrack("pj-race");
    await enqueue(t.track);
    const results = await Promise.all(Array.from({ length: 6 }, () => claim()));
    const mine = results.flatMap((r) => r.rows).filter((r) => r.track_id === t.track);
    expect(mine).toHaveLength(1);
  });

  it("a non-retryable failure fails the job and the track, with a safe message the artist can read", async () => {
    const t = await draftTrack("pj-fail");
    await enqueue(t.track);
    let got = await claim();
    while (got.rows[0] && got.rows[0].track_id !== t.track) got = await claim();
    await query(db.pool, service, "select public.fail_processing_job($1, 'no_audio_stream', 'No audio stream found in the file.', false)", [got.rows[0]!.job_id]);
    expect((await trackRow(t.track)).processing_status).toBe("failed");
    const seen = await query<{ status: string; error_code: string; error_message: string }>(db.pool, user(t.owner),
      "select status, error_code, error_message from public.processing_jobs where track_id = $1", [t.track]);
    expect(seen.rows[0]).toEqual({ status: "failed", error_code: "no_audio_stream", error_message: "No audio stream found in the file." });
  });

  it("a retryable failure re-queues until max_attempts, then fails", async () => {
    const t = await draftTrack("pj-retry");
    await enqueue(t.track);
    for (let attempt = 1; attempt <= 3; attempt++) {
      let got = await claim();
      while (got.rows[0] && got.rows[0].track_id !== t.track) got = await claim();
      expect(got.rows[0]!.attempts).toBe(attempt);
      const r = await query<{ r: string }>(db.pool, service, "select public.fail_processing_job($1, 'storage_error', 'Temporary problem.', true) r", [got.rows[0]!.job_id]);
      expect(r.rows[0]!.r).toBe(attempt < 3 ? "requeued" : "failed");
    }
    expect((await trackRow(t.track)).processing_status).toBe("failed");
  });

  it("an expired lease is picked up again; after max attempts it is failed as a timeout", async () => {
    const t = await draftTrack("pj-lease");
    await enqueue(t.track);
    let first = await claim();
    while (first.rows[0] && first.rows[0].track_id !== t.track) first = await claim();
    const id = first.rows[0]!.job_id;
    await query(db.pool, superuser, "update public.processing_jobs set locked_until = now() - interval '1 minute' where id = $1", [id]);
    let again = await claim();
    while (again.rows[0] && again.rows[0].track_id !== t.track) again = await claim();
    expect(again.rows[0]!.job_id).toBe(id);
    expect(again.rows[0]!.attempts).toBe(2);
    await query(db.pool, superuser, "update public.processing_jobs set locked_until = now() - interval '1 minute', attempts = 3 where id = $1", [id]);
    await claim(); // sweeps
    const row = (await query<{ status: string; error_code: string }>(db.pool, superuser, "select status, error_code from public.processing_jobs where id = $1", [id])).rows[0]!;
    expect(row).toEqual({ status: "failed", error_code: "timeout" });
    expect((await trackRow(t.track)).processing_status).toBe("failed");
  });
});

describe("replacing an upload", () => {
  it("clears stale renditions, supersedes the old job, and the old job can no longer publish", async () => {
    const t = await draftTrack("pj-replace");
    await enqueue(t.track);
    let got = await claim();
    while (got.rows[0] && got.rows[0].track_id !== t.track) got = await claim();
    const oldJob = got.rows[0]!.job_id;
    // artist uploads a different file while the first job is still running (service role registers it, as the route does)
    const newKey = `audio/${t.artist}/${t.track}/original-2.flac`;
    // (the existing tracks_reset_processing trigger clears renditions whenever audio_path changes, so set the stale one afterwards)
    await query(db.pool, superuser, "update public.tracks set audio_path = $2 where id = $1", [t.track, newKey]);
    await query(db.pool, superuser, "update public.tracks set audio_low_path = $2 where id = $1", [t.track, `audio/${t.artist}/${t.track}/old-low.m4a`]);
    const q = await enqueue(t.track);
    expect(q.rows[0]!.stale_paths).toEqual([`audio/${t.artist}/${t.track}/old-low.m4a`]);
    expect(await trackRow(t.track)).toMatchObject({ processing_status: "pending", audio_low_path: null, audio_std_path: null });
    const r = await query<{ r: string }>(db.pool, service, "select public.complete_processing_job($1, $2, null, 1000) r", [oldJob, `audio/${t.artist}/${t.track}/low-old.m4a`]);
    expect(r.rows[0]!.r).toBe("not_running");
    const jobs = await query<{ status: string; error_code: string | null }>(db.pool, superuser, "select status, error_code from public.processing_jobs where track_id = $1 order by created_at", [t.track]);
    expect(jobs.rows).toEqual([{ status: "failed", error_code: "superseded" }, { status: "queued", error_code: null }]);
  });

  it("enqueue refuses a track with no original", async () => {
    const t = await draftTrack("pj-noorig");
    await query(db.pool, superuser, "alter table public.tracks disable trigger tracks_audio_lock");
    await query(db.pool, superuser, "update public.tracks set audio_path = null where id = $1", [t.track]);
    await query(db.pool, superuser, "alter table public.tracks enable trigger tracks_audio_lock");
    await expect(enqueue(t.track)).rejects.toThrow(/no uploaded original/);
  });
});
