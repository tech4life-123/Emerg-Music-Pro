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
    const res = await storage.put("originals", "t1/a.wav", chunks("hello ", "world"), { maxBytes: 100 });
    expect(res.size).toBe(11);
    expect(res.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(await storage.stat("originals", "t1/a.wav")).toEqual({ size: 11 });
    const got: Buffer[] = [];
    for await (const c of await storage.read("originals", "t1/a.wav", { start: 6, end: 10 })) got.push(c as Buffer);
    expect(Buffer.concat(got).toString()).toBe("world");
  });
  it("enforces the size ceiling WHILE streaming and leaves no partial file behind", async () => {
    await expect(storage.put("originals", "t2/big.wav", chunks("aaaa", "bbbb", "cccc"), { maxBytes: 10 })).rejects.toMatchObject({ code: "too_large" });
    expect(await storage.stat("originals", "t2/big.wav")).toBeNull();
    const leftovers = await readdir(path.join(dir, "originals", "t2")).catch(() => []);
    expect(leftovers).toEqual([]);
  });
  it("stores objects under the bucket directory", async () => {
    await storage.put("originals", "t1/a.wav", chunks("r"), { maxBytes: 10 });
    expect((await readFile(path.join(dir, "originals", "t1/a.wav"))).toString()).toBe("r");
    expect(await storage.stat("originals", "missing.wav")).toBeNull();
  });
  it("refuses traversal through every operation", async () => {
    await expect(storage.put("originals", "../escape.wav", chunks("x"), { maxBytes: 10 })).rejects.toMatchObject({ code: "invalid_key" });
    await expect(storage.stat("originals", "../../etc/passwd")).rejects.toMatchObject({ code: "invalid_key" });
    await expect(storage.read("originals", "../x")).rejects.toBeInstanceOf(StorageError);
    await expect(storage.read("originals", "t1/missing.wav")).rejects.toMatchObject({ code: "not_found" });
  });
  it("keeps originals and renditions in separate directories", async () => {
    await storage.put("renditions", "t3/r.m4a", chunks("r"), { maxBytes: 10 });
    expect(await storage.stat("originals", "t3/r.m4a")).toBeNull();
    expect(await storage.stat("renditions", "t3/r.m4a")).toEqual({ size: 1 });
    expect(createStorage({ driver: "local", localDir: dir }).driver).toBe("local");
  });
});
