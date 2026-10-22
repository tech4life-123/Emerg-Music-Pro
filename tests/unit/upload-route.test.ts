import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorage } from "@/lib/media/storage";
import { signToken } from "@/lib/media/tokens";

const SECRET = "s".repeat(40);
const userId = randomUUID();
const artistId = randomUUID();
const trackId = randomUUID();
const key = `audio/${artistId}/${trackId}/original-${randomUUID()}.wav`;

const state = {
  viewer: { status: "signed_in", userId } as { status: string; userId?: string },
  canUpload: artistId as string | null,
  before: { audio_path: null as string | null, audio_low_path: null as string | null, audio_std_path: null as string | null },
  updateError: null as { message: string } | null,
  rpcError: null as { message: string } | null,
  calls: [] as string[],
};
let storage: LocalStorage;

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ MEDIA_SIGNING_SECRET: SECRET }) }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => state.viewer }));
vi.mock("@/lib/services/media", () => ({ canUploadToTrack: async () => state.canUpload, getStorage: () => storage }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.before }) }) }),
      update: (v: Record<string, unknown>) => ({
        eq: async () => {
          state.calls.push(`update:${v.audio_path}:${v.processing_status}`);
          return { error: state.updateError };
        },
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push(`rpc:${fn}:${args.p_track}`);
      return state.rpcError ? { data: null, error: state.rpcError } : { data: [{ job_id: "job-1", stale_paths: [] }], error: null };
    },
  }),
}));

const { PUT } = await import("@/app/api/upload/[token]/route");

const token = (over: Record<string, unknown> = {}) =>
  signToken({ typ: "upload", sub: userId, track: trackId, key, max: 1000, ct: "audio/wav", exp: Math.floor(Date.now() / 1000) + 300, ...over } as never, SECRET);
const put = (t: string, body = "RIFFdata", headers: Record<string, string> = {}) =>
  PUT(new Request("http://x/api/upload/t", { method: "PUT", body, headers: { "content-type": "audio/wav", "content-length": String(body.length), ...headers }, duplex: "half" } as RequestInit), {
    params: Promise.resolve({ token: t }),
  });

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "emerg-upload-"));
  storage = new LocalStorage(dir);
});
afterAll(async () => rm(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.viewer = { status: "signed_in", userId };
  state.canUpload = artistId;
  state.before = { audio_path: null, audio_low_path: null, audio_std_path: null };
  state.updateError = null;
  state.rpcError = null;
  state.calls = [];
});

describe("PUT /api/upload/[token]", () => {
  it("stores the original in QUARANTINE (originals bucket only), registers it, and queues a processing job", async () => {
    const res = await put(token());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ trackId, status: "queued", jobId: "job-1", size: 8 });
    expect(await storage.stat("originals", key)).toEqual({ size: 8 });
    expect(await storage.stat("renditions", key)).toBeNull();
    expect(state.calls).toEqual([`update:${key}:pending`, `rpc:enqueue_processing_job:${trackId}`]); // register first, then queue
  });

  it("deletes the previous original and its renditions when audio is replaced", async () => {
    const oldOriginal = `audio/${artistId}/${trackId}/original-old.wav`;
    const oldLow = `audio/${artistId}/${trackId}/low-old.m4a`;
    const oldStd = `audio/${artistId}/${trackId}/std-old.m4a`;
    const enc = (s: string) => (async function* () { yield new TextEncoder().encode(s); })();
    await storage.put("originals", oldOriginal, enc("old"), { maxBytes: 10 });
    await storage.put("renditions", oldLow, enc("l"), { maxBytes: 10 });
    await storage.put("renditions", oldStd, enc("s"), { maxBytes: 10 });
    state.before = { audio_path: oldOriginal, audio_low_path: oldLow, audio_std_path: oldStd };
    expect((await put(token({ key: `audio/${artistId}/${trackId}/original-new.wav` }))).status).toBe(201);
    expect(await storage.stat("originals", oldOriginal)).toBeNull();
    expect(await storage.stat("renditions", oldLow)).toBeNull();
    expect(await storage.stat("renditions", oldStd)).toBeNull();
  });

  it("removes the object again when the track cannot be updated (no unregistered leftovers)", async () => {
    const k = `audio/${artistId}/${trackId}/original-fail.wav`;
    state.updateError = { message: "trigger refused" };
    expect((await put(token({ key: k }))).status).toBe(500);
    expect(await storage.stat("originals", k)).toBeNull();
    expect(state.calls.some((c) => c.startsWith("rpc:"))).toBe(false); // nothing queued for an unregistered file
  });

  it("reports queue_failed (and does not claim success) when the job cannot be queued", async () => {
    state.rpcError = { message: "boom" };
    const res = await put(token({ key: `audio/${artistId}/${trackId}/original-q.wav` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "queue_failed" });
  });

  it("refuses bad tokens, other users, a release that left draft, wrong content type, and oversized bodies", async () => {
    expect((await put("garbage")).status).toBe(403);
    expect((await put(token({ exp: Math.floor(Date.now() / 1000) - 5 }))).status).toBe(403);
    state.viewer = { status: "signed_in", userId: randomUUID() };
    expect((await put(token())).status).toBe(403);
    state.viewer = { status: "signed_out" };
    expect((await put(token())).status).toBe(403);
    state.viewer = { status: "signed_in", userId };
    state.canUpload = null; // no longer a draft / not the owner
    expect((await put(token())).status).toBe(403);
    state.canUpload = artistId;
    expect((await put(token(), "RIFFdata", { "content-type": "audio/mpeg" })).status).toBe(415);
    expect((await put(token({ max: 4 }))).status).toBe(413);
    expect(state.calls).toEqual([]); // none of the refusals touched the database
  });

  it("a key outside the artist/track folder in a signed token is refused", async () => {
    expect((await put(token({ key: `audio/${randomUUID()}/${trackId}/original-x.wav` }))).status).toBe(403);
  });
});
