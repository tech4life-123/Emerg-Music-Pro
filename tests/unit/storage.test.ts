import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeKey, createStorage, LocalStorage, StorageError } from "@/lib/media/storage";

let dir: string;
let storage: LocalStorage;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "emerg-storage-"));
  storage = new LocalStorage(dir);
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

async function* chunks(...parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

describe("object keys", () => {
  it("rejects traversal, absolute, empty-segment, odd-character and oversized keys", () => {
    for (const k of ["../x", "a/../b", "/abs", "a//b", "a/./b", "", "a\\b", "a\0b", "a b", "é", "x".repeat(501)]) {
      expect(() => assertSafeKey(k), JSON.stringify(k)).toThrow(StorageError);
    }
    expect(() => assertSafeKey("0d2f/abc-123.wav")).not.toThrow();
  });
});

describe("LocalStorage", () => {
  it("stores bytes, returns size + sha256, and reads ranges back", async () => {
    const res = await storage.put("media", "t1/a.wav", chunks("hello ", "world"), { maxBytes: 100 });
    expect(res.size).toBe(11);
    expect(res.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(await storage.stat("media", "t1/a.wav")).toEqual({ size: 11 });
    const got: Buffer[] = [];
    for await (const c of storage.createReadStream("media", "t1/a.wav", { start: 6, end: 10 })) got.push(c as Buffer);
    expect(Buffer.concat(got).toString()).toBe("world");
  });
  it("enforces the size ceiling WHILE streaming and leaves no partial file behind", async () => {
    await expect(storage.put("media", "t2/big.wav", chunks("aaaa", "bbbb", "cccc"), { maxBytes: 10 })).rejects.toMatchObject({ code: "too_large" });
    expect(await storage.stat("media", "t2/big.wav")).toBeNull();
    const leftovers = await readdir(path.join(dir, "media", "t2")).catch(() => []);
    expect(leftovers).toEqual([]);
  });
  it("stores objects under the bucket directory", async () => {
    await storage.put("media", "t1/a.wav", chunks("r"), { maxBytes: 10 });
    expect((await readFile(path.join(dir, "media", "t1/a.wav"))).toString()).toBe("r");
    expect(await storage.stat("media", "missing.wav")).toBeNull();
  });
  it("refuses traversal through every operation", async () => {
    await expect(storage.put("media", "../escape.wav", chunks("x"), { maxBytes: 10 })).rejects.toMatchObject({ code: "invalid_key" });
    await expect(storage.stat("media", "../../etc/passwd")).rejects.toMatchObject({ code: "invalid_key" });
    expect(() => storage.createReadStream("media", "../x")).toThrow(StorageError);
  });
  it("the R2 driver is NOT enabled in Phase 1", () => {
    expect(() => createStorage({ driver: "r2", localDir: dir })).toThrow(/not enabled/);
    expect(createStorage({ driver: "local", localDir: dir }).driver).toBe("local");
  });
});
