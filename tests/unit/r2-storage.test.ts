import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createR2Storage, createStorage, StorageError, type ObjectStorage } from "@/lib/media/storage";
import { startS3Mock, type S3Mock } from "../stubs/s3-mock";

let mock: S3Mock;
let r2: ObjectStorage;
beforeAll(async () => {
  mock = await startS3Mock();
  r2 = createR2Storage({
    accountId: "test", accessKeyId: "AKIATEST", secretAccessKey: "secret", bucketOriginals: "orig", bucketRenditions: "rend", endpoint: mock.endpoint,
  });
});
afterAll(async () => mock.close());

async function* chunks(buf: Buffer, size = 1024 * 1024) {
  for (let i = 0; i < buf.length; i += size) yield new Uint8Array(buf.subarray(i, i + size));
}
async function readAll(s: AsyncIterable<unknown>) {
  const out: Buffer[] = [];
  for await (const c of s) out.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(out);
}

// These tests drive the REAL AWS SDK against an in-process S3-compatible server. They prove our driver's wire behaviour,
// not that a real Cloudflare bucket is private; that still has to be verified against the real account.
describe("R2Storage over the S3 API (mock server)", () => {
  it("puts a small object into the right bucket and reports size + sha256", async () => {
    const data = randomBytes(10_000);
    const r = await r2.put("originals", "audio/a/b/original-1.wav", chunks(data), { maxBytes: 100_000, contentType: "audio/wav" });
    expect(r).toEqual({ size: 10_000, sha256: createHash("sha256").update(data).digest("hex") });
    expect(mock.objects.get("orig/audio/a/b/original-1.wav")?.equals(data)).toBe(true);
    expect(mock.objects.has("rend/audio/a/b/original-1.wav")).toBe(false);
  });

  it("uploads a large object (multipart) intact", async () => {
    const data = randomBytes(12 * 1024 * 1024);
    const r = await r2.put("renditions", "audio/a/b/std-1.m4a", chunks(data), { maxBytes: 20 * 1024 * 1024 });
    expect(r.size).toBe(data.length);
    expect(mock.objects.get("rend/audio/a/b/std-1.m4a")?.equals(data)).toBe(true);
  });

  it("enforces the size ceiling while streaming and leaves nothing behind", async () => {
    const data = randomBytes(12 * 1024 * 1024);
    await expect(r2.put("originals", "audio/a/b/big.wav", chunks(data), { maxBytes: 7 * 1024 * 1024 })).rejects.toMatchObject({ code: "too_large" });
    expect(mock.objects.has("orig/audio/a/b/big.wav")).toBe(false);
  });

  it("stat returns the size or null", async () => {
    await r2.put("originals", "audio/a/b/s.wav", chunks(Buffer.from("hello")), { maxBytes: 100 });
    expect(await r2.stat("originals", "audio/a/b/s.wav")).toEqual({ size: 5 });
    expect(await r2.stat("originals", "audio/a/b/missing.wav")).toBeNull();
  });

  it("reads whole objects and byte ranges", async () => {
    await r2.put("renditions", "audio/a/b/r.m4a", chunks(Buffer.from("0123456789")), { maxBytes: 100 });
    expect((await readAll(await r2.read("renditions", "audio/a/b/r.m4a"))).toString()).toBe("0123456789");
    expect((await readAll(await r2.read("renditions", "audio/a/b/r.m4a", { start: 2, end: 5 }))).toString()).toBe("2345");
  });

  it("reading a missing object is a not_found StorageError", async () => {
    await expect(r2.read("renditions", "audio/a/b/nope.m4a")).rejects.toMatchObject({ code: "not_found" });
  });

  it("remove deletes, and deleting a missing object is not an error", async () => {
    await r2.put("originals", "audio/a/b/d.wav", chunks(Buffer.from("x")), { maxBytes: 10 });
    await r2.remove("originals", "audio/a/b/d.wav");
    expect(await r2.stat("originals", "audio/a/b/d.wav")).toBeNull();
    await expect(r2.remove("originals", "audio/a/b/d.wav")).resolves.toBeUndefined();
  });

  it("rejects unsafe keys before any network call", async () => {
    for (const key of ["../x", "/abs", "a//b", "a b"]) {
      await expect(r2.put("originals", key, chunks(Buffer.from("x")), { maxBytes: 10 })).rejects.toBeInstanceOf(StorageError);
      await expect(r2.stat("originals", key)).rejects.toBeInstanceOf(StorageError);
      await expect(r2.read("originals", key)).rejects.toBeInstanceOf(StorageError);
      await expect(r2.remove("originals", key)).rejects.toBeInstanceOf(StorageError);
    }
  });
});

describe("createStorage", () => {
  const cfg = { accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucketOriginals: "o", bucketRenditions: "r" };
  it("builds the R2 driver only with a full configuration", () => {
    expect(createStorage({ driver: "r2", localDir: ".", r2: cfg }).driver).toBe("r2");
    expect(() => createStorage({ driver: "r2", localDir: "." })).toThrow(/configuration is missing/);
  });
  it("refuses one bucket for both originals and renditions (they must be separately scoped)", () => {
    expect(() => createStorage({ driver: "r2", localDir: ".", r2: { ...cfg, bucketRenditions: "o" } })).toThrow(/separate buckets/);
  });
});
