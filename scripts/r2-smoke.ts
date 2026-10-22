/**
 * Verifies a REAL Cloudflare R2 setup end to end with your credentials. It has NOT been run by the author (no credentials
 * and no network route to R2 from the build sandbox): run it yourself before trusting STORAGE_DRIVER=r2.
 *
 *   STORAGE_DRIVER=r2 npm run r2:smoke        (reads .env.local; needs the five R2_* variables)
 *
 * What it checks, per bucket: write, stat, read, byte-range read, delete, and that an UNauthenticated request for the same
 * object is refused (the bucket is not publicly readable). It only touches keys under `smoke/` and deletes them again.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { parseServerEnv } from "../src/lib/env";
import { storageFromEnv } from "../src/lib/media/storage-config";
import type { Bucket } from "../src/lib/media/storage";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

async function main() {
  const env = parseServerEnv({ ...process.env, STORAGE_DRIVER: "r2" });
  const storage = storageFromEnv(env);
  let failed = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  };

  const names: Record<Bucket, string> = { originals: env.R2_BUCKET_ORIGINALS!, renditions: env.R2_BUCKET_RENDITIONS! };
  for (const bucket of ["originals", "renditions"] as const) {
    const key = `smoke/${randomUUID()}.bin`;
    const data = randomBytes(2048);
    try {
      const put = await storage.put(bucket, key, (async function* () { yield data; })(), { maxBytes: 10_000, contentType: "application/octet-stream" });
      check(`${bucket}: write`, put.size === 2048);
      check(`${bucket}: stat`, (await storage.stat(bucket, key))?.size === 2048);
      const whole = Buffer.concat(await collect(await storage.read(bucket, key)));
      check(`${bucket}: read`, whole.equals(data));
      const part = Buffer.concat(await collect(await storage.read(bucket, key, { start: 10, end: 19 })));
      check(`${bucket}: byte range`, part.equals(data.subarray(10, 20)));
      // Anonymous request straight to the S3 endpoint must NOT return the object.
      const anon = await fetch(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${names[bucket]}/${key}`);
      check(`${bucket}: anonymous read is refused`, anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);
    } catch (err) {
      check(`${bucket}: round trip`, false, err instanceof Error ? err.name : "error");
    } finally {
      await storage.remove(bucket, key).catch(() => undefined);
    }
    check(`${bucket}: delete`, (await storage.stat(bucket, key).catch(() => ({ size: -1 }))) === null);
  }
  console.log("\nStill check by hand in the Cloudflare dashboard: for BOTH buckets 'Public Development URL' is disabled and no custom domain is attached.");
  process.exit(failed === 0 ? 0 : 1);
}

async function collect(stream: AsyncIterable<unknown>) {
  const out: Buffer[] = [];
  for await (const c of stream) out.push(Buffer.from(c as Uint8Array));
  return out;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
