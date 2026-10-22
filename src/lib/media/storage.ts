import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, rename, rm, stat as fsStat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";

/** One private bucket. Object keys are the exact paths stored in tracks.audio_path / audio_low_path / audio_std_path. */
export type Bucket = "media";

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_key" | "too_large" | "not_found" | "not_enabled",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface PutResult {
  size: number;
  sha256: string;
}

export interface ObjectStorage {
  readonly driver: "local" | "r2";
  put(bucket: Bucket, key: string, source: AsyncIterable<Uint8Array>, opts: { maxBytes: number }): Promise<PutResult>;
  stat(bucket: Bucket, key: string): Promise<{ size: number } | null>;
  createReadStream(bucket: Bucket, key: string, range?: { start: number; end: number }): ReadStream;
  remove(bucket: Bucket, key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/** Object keys are always generated server-side, but we validate again at the storage boundary. */
export function assertSafeKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 500 ||
    !SAFE_KEY.test(key) ||
    key.split("/").some((seg) => seg === ".." || seg === "." || seg === "")
  ) {
    throw new StorageError("invalid object key", "invalid_key");
  }
}

/** $0 development driver: files on local disk. NOT for production use. */
export class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly base: string;

  constructor(baseDir: string) {
    this.base = path.resolve(baseDir);
  }

  private resolve(bucket: Bucket, key: string): string {
    assertSafeKey(key);
    const root = path.join(this.base, bucket);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new StorageError("invalid object key", "invalid_key");
    return full;
  }

  async put(bucket: Bucket, key: string, source: AsyncIterable<Uint8Array>, opts: { maxBytes: number }): Promise<PutResult> {
    const target = this.resolve(bucket, key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.part`;
    const out = createWriteStream(tmp, { flags: "wx" });
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > opts.maxBytes) throw new StorageError("object exceeds the allowed size", "too_large");
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((res) => out.once("drain", res));
      }
      await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
      await rename(tmp, target); // atomic: readers never see a partial object
      return { size, sha256: hash.digest("hex") };
    } catch (err) {
      // The write stream opens its file lazily: wait until it is fully closed before removing the partial file,
      // otherwise a late open can recreate it after the rm.
      await new Promise<void>((res) => {
        if (out.closed) return res();
        out.once("close", () => res());
        out.destroy();
      });
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async stat(bucket: Bucket, key: string) {
    try {
      const s = await fsStat(this.resolve(bucket, key));
      return s.isFile() ? { size: s.size } : null;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      return null;
    }
  }

  createReadStream(bucket: Bucket, key: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.resolve(bucket, key), range);
  }

  async remove(bucket: Bucket, key: string): Promise<void> {
    await rm(this.resolve(bucket, key), { force: true });
  }
}

/**
 * R2 is intentionally NOT implemented in Phase 1: enabling it can incur charges beyond the free
 * tier and requires explicit owner approval plus real-bucket security testing.
 */
export function createStorage(config: { driver: "local" | "r2"; localDir: string }): ObjectStorage {
  if (config.driver === "r2") {
    throw new StorageError(
      "The R2 storage driver is not enabled. It requires explicit approval (metered billing beyond the free tier). Use STORAGE_DRIVER=local.",
      "not_enabled",
    );
  }
  return new LocalStorage(config.localDir);
}
