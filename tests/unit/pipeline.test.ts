import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/media/storage";
import { renditionPrefix, runOnce, type ClaimedJob, type JobStore } from "@/lib/worker/pipeline";
import { LocalFfmpegWorker } from "@/lib/worker/local-ffmpeg";

let dir: string;
let storage: LocalStorage;
const worker = new LocalFfmpegWorker();
const SAMPLE = path.resolve(__dirname, "../../fixtures/sample/sample-tone-440hz.wav");

const artist = randomUUID();
const track = randomUUID();
const originalKey = `audio/${artist}/${track}/original-${randomUUID()}.wav`;

class FakeStore implements JobStore {
  queue: ClaimedJob[] = [];
  completed: Array<{ lowKey: string; stdKey: string; durationMs: number }> = [];
  failures: Array<{ code: string; message: string; retry: boolean }> = [];
  completeResult: "succeeded" | "superseded" | "not_running" = "succeeded";
  async claim() {
    return this.queue.shift() ?? null;
  }
  async complete(_: string, r: { lowKey: string; stdKey: string; durationMs: number }) {
    this.completed.push(r);
    return this.completeResult;
  }
  async fail(_: string, code: string, message: string, retry: boolean) {
    this.failures.push({ code, message, retry });
    return retry ? ("requeued" as const) : ("failed" as const);
  }
}
let store: FakeStore;
const job = (key = originalKey): ClaimedJob => ({ jobId: randomUUID(), trackId: track, originalKey: key, attempts: 1 });
const run = () => runOnce({ storage, worker, store, tmpRoot: dir });
async function putOriginal(file: string, key = originalKey) {
  const { createReadStream } = await import("node:fs");
  await storage.put("originals", key, createReadStream(file), { maxBytes: 50_000_000 });
}
async function renditionKeys() {
  const root = path.join(dir, "store", "renditions", "audio", artist, track);
  return readdir(root).catch(() => [] as string[]);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "emerg-pipeline-"));
  storage = new LocalStorage(path.join(dir, "store"));
});
afterAll(async () => rm(dir, { recursive: true, force: true }));
beforeEach(async () => {
  store = new FakeStore();
  await rm(path.join(dir, "store"), { recursive: true, force: true });
});

describe("renditionPrefix", () => {
  it("keeps renditions in the same artist/track folder as the original", () => {
    expect(renditionPrefix(originalKey)).toBe(`audio/${artist}/${track}/`);
    expect(() => renditionPrefix("audio/x/y/z.wav")).toThrow();
    expect(() => renditionPrefix(`audio/${artist}/${track}/sub/x.wav`)).toThrow();
  });
});

describe("runOnce", () => {
  it("is idle when the queue is empty", async () => {
    expect(await run()).toBe("idle");
  });

  it("validates, transcodes two AAC renditions, stores them privately, and reports the real duration", async () => {
    await putOriginal(SAMPLE);
    store.queue.push(job());
    expect(await run()).toBe("succeeded");

    expect(store.failures).toEqual([]);
    const done = store.completed[0]!;
    expect(done.lowKey).toMatch(new RegExp(`^audio/${artist}/${track}/low-[0-9a-f-]{36}\\.m4a$`));
    expect(done.stdKey).toMatch(new RegExp(`^audio/${artist}/${track}/std-[0-9a-f-]{36}\\.m4a$`));
    expect(done.durationMs).toBeGreaterThan(1900);
    expect(done.durationMs).toBeLessThan(2100);

    // both renditions exist in the renditions bucket, are real AAC, and the std one is the higher bitrate
    const low = path.join(dir, "store", "renditions", done.lowKey);
    const std = path.join(dir, "store", "renditions", done.stdKey);
    const lowProbe = await worker.probe(low);
    const stdProbe = await worker.probe(std);
    expect(lowProbe.codec).toBe("aac");
    expect(stdProbe.codec).toBe("aac");
    expect((await readFile(std)).length).toBeGreaterThan((await readFile(low)).length);
    // the original is left alone in quarantine, and not copied into renditions
    expect(await storage.stat("originals", originalKey)).not.toBeNull();
    expect(await storage.stat("renditions", originalKey)).toBeNull();
  });

  it("rejects a file that only pretends to be audio (permanent failure, safe message, nothing stored)", async () => {
    const fake = path.join(dir, "fake.wav");
    await writeFile(fake, "MZ this is not audio, whatever the extension says\n".repeat(50));
    await putOriginal(fake);
    store.queue.push(job());
    expect(await run()).toBe("failed");
    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]).toMatchObject({ code: "unreadable", retry: false });
    expect(store.failures[0]!.message).not.toMatch(/\/|ffprobe|ffmpeg|Error|at /);
    expect(await renditionKeys()).toEqual([]);
    expect(store.completed).toEqual([]);
  });

  it("rejects audio that is too short", async () => {
    const short = path.join(dir, "short.wav");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", short]);
    await putOriginal(short);
    store.queue.push(job());
    expect(await run()).toBe("failed");
    expect(store.failures[0]).toMatchObject({ code: "too_short", retry: false });
  });

  it("a video-only file has no audio stream", async () => {
    const vid = path.join(dir, "video.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2", "-an", vid]);
    await putOriginal(vid);
    store.queue.push(job());
    expect(await run()).toBe("failed");
    expect(store.failures[0]).toMatchObject({ code: "no_audio_stream", retry: false });
  });

  it("a missing original is a retryable processing error that does not leak internals", async () => {
    store.queue.push(job(`audio/${artist}/${track}/original-${randomUUID()}.wav`));
    expect(await run()).toBe("requeued");
    expect(store.failures[0]).toMatchObject({ code: "processing_error", retry: true });
    expect(store.failures[0]!.message).toBe("We could not process this file. Try uploading it again.");
  });

  it("removes the renditions it made when the job was superseded by a newer upload", async () => {
    await putOriginal(SAMPLE);
    store.queue.push(job());
    store.completeResult = "superseded";
    expect(await run()).toBe("superseded");
    expect(await renditionKeys()).toEqual([]);
  });

  it("leaves no temporary files behind", async () => {
    await putOriginal(SAMPLE);
    store.queue.push(job());
    await run();
    const leftovers = (await readdir(dir)).filter((n) => n.startsWith("emerg-job-"));
    expect(leftovers).toEqual([]);
  });
});
