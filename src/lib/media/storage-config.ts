import type { ServerEnv } from "../env";
import { createStorage, type ObjectStorage } from "./storage";

/** Builds the storage driver from validated environment. Shared by the web app and the worker process. */
export function storageFromEnv(env: ServerEnv): ObjectStorage {
  return createStorage({
    driver: env.STORAGE_DRIVER,
    localDir: env.LOCAL_STORAGE_DIR,
    r2:
      env.STORAGE_DRIVER === "r2"
        ? {
            accountId: env.R2_ACCOUNT_ID!,
            accessKeyId: env.R2_ACCESS_KEY_ID!,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
            bucketOriginals: env.R2_BUCKET_ORIGINALS!,
            bucketRenditions: env.R2_BUCKET_RENDITIONS!,
          }
        : undefined,
  });
}
