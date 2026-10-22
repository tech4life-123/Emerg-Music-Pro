import "server-only";
import { z } from "zod";

/**
 * Server-only environment. Importing this from a client component fails the build
 * (`server-only`). Anything secret MUST be read here, never via NEXT_PUBLIC_*.
 */
const schema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default("./storage-local"),
    MEDIA_SIGNING_SECRET: z.string().min(32, "MEDIA_SIGNING_SECRET must be at least 32 characters"),
    UPLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(600),
    PLAYBACK_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(2_000_000_000).default(104_857_600),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_ORIGINALS: z.string().optional(),
    R2_BUCKET_RENDITIONS: z.string().optional(),
    WORKER_DRIVER: z.enum(["local-ffmpeg"]).default("local-ffmpeg"),
    FFMPEG_PATH: z.string().default("ffmpeg"),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === "r2") {
      for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_ORIGINALS", "R2_BUCKET_RENDITIONS"] as const) {
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${k} is required when STORAGE_DRIVER=r2` });
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable NAMES and messages only; never echo values (they may be secrets).
    const lines = result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid server environment:\n${lines.join("\n")}`);
  }
  return result.data;
}

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function isSupabaseConfigured(env: Pick<ServerEnv, "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY">): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
