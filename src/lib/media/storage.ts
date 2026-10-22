import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

/**
 * Two PRIVATE buckets. Object keys are the exact paths stored on the track:
 *  - "originals"  : uploaded files, untrusted until validated (tracks.audio_path). Never streamed to listeners.
 *  - "renditions" : transcoded output made by our worker (tracks.audio_low_path / audio_std_path). The only thing playback serves.
 */
export type Bucket = "originals" | "renditions";

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
  put(bucket: Bucket, key: string, source: AsyncIterable<Uint8Array>, opts: { maxBytes: number; contentType?: string }): Promise<PutResult>;
  stat(bucket: Bucket, key: string): Promise<{ size: number } | null>;
  /** Throws StorageError("not_found") when the object does not exist. Range is inclusive, like HTTP. */
  read(bucket: Bucket, key: string, range?: { start: number; end: number }): Promise<Readable>;
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

  async put(bucket: Bucket, key: string, source: AsyncIterable<Uint8Array>, opts: { maxBytes: number; contentType?: string }): Promise<PutResult> {
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

  async read(bucket: Bucket, key: string, range?: { start: number; end: number }): Promise<Readable> {
    const full = this.resolve(bucket, key);
    if (!(await this.stat(bucket, key))) throw new StorageError("object not found", "not_found");
    return createReadStream(full, range);
  }

  async remove(bucket: Bucket, key: string): Promise<void> {
    await rm(this.resolve(bucket, key), { force: true });
  }
}

/**
 * Cloudflare R2 through its S3-compatible API. SERVER-ONLY: credentials come from the environment and never reach
 * the browser. Buckets must be private (no public access, no custom domain); the browser only ever talks to this
 * app, which streams after an authorization check.
 */
export class R2Storage implements ObjectStorage {
  readonly driver = "r2" as const;

  constructor(
    private readonly client: S3Client,
    private readonly buckets: Record<Bucket, string>,
  ) {}

  async put(bucket: Bucket, key: string, source: AsyncIterable<Uint8Array>, opts: { maxBytes: number; contentType?: string }): Promise<PutResult> {
    assertSafeKey(key);
    const hash = createHash("sha256");
    let size = 0;
    async function* counted() {
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > opts.maxBytes) throw new StorageError("object exceeds the allowed size", "too_large");
        hash.update(chunk);
        yield chunk;
      }
    }
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.buckets[bucket], Key: key, Body: Readable.from(counted()), ContentType: opts.contentType ?? "application/octet-stream" },
      queueSize: 2,
      leavePartsOnError: false,
    });
    try {
      await upload.done();
    } catch (err) {
      await upload.abort().catch(() => undefined);
      if (err instanceof StorageError) throw err;
      // The SDK may wrap the stream error; fall back on our own accounting.
      if (size > opts.maxBytes) throw new StorageError("object exceeds the allowed size", "too_large");
      throw err;
    }
    return { size, sha256: hash.digest("hex") };
  }

  async stat(bucket: Bucket, key: string) {
    assertSafeKey(key);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
      return { size: Number(head.ContentLength ?? 0) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async read(bucket: Bucket, key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
      );
      if (!res.Body) throw new StorageError("object not found", "not_found");
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new StorageError("object not found", "not_found");
      throw err;
    }
  }

  async remove(bucket: Bucket, key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key })); // S3 delete is idempotent
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketOriginals: string;
  bucketRenditions: string;
  /** Tests only: point the SDK at a local S3-compatible server. Never set in production. */
  endpoint?: string;
}

export function createR2Storage(cfg: R2Config): R2Storage {
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // R2 does not support the SDK's newer default CRC checksums on every call; only send them when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return new R2Storage(client, { originals: cfg.bucketOriginals, renditions: cfg.bucketRenditions });
}

export function createStorage(config: { driver: "local" | "r2"; localDir: string; r2?: R2Config }): ObjectStorage {
  if (config.driver === "r2") {
    if (!config.r2) throw new StorageError("R2 is selected but its configuration is missing.", "not_enabled");
    if (config.r2.bucketOriginals === config.r2.bucketRenditions) {
      throw new StorageError("Originals and renditions must be separate buckets.", "not_enabled");
    }
    return createR2Storage(config.r2);
  }
  return new LocalStorage(config.localDir);
}
