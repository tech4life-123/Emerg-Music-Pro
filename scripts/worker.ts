/**
 * Audio processing worker. Claims queued jobs, validates the upload with ffprobe, transcodes with FFmpeg, and stores the
 * renditions in the private "renditions" bucket.
 *
 *   npm run worker            # poll forever (Ctrl-C to stop; the current job finishes first)
 *   npm run worker -- --once  # drain the queue and exit (handy for local testing)
 *
 * Needs the SAME environment as the web app (Supabase URL, SERVICE ROLE key, storage driver + R2_* when STORAGE_DRIVER=r2)
 * and ffmpeg/ffprobe on PATH (or FFMPEG_PATH). The service role key stays on the machine running this process.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseServerEnv } from "../src/lib/env";
import { storageFromEnv } from "../src/lib/media/storage-config";
import { LocalFfmpegWorker } from "../src/lib/worker/local-ffmpeg";
import { runOnce } from "../src/lib/worker/pipeline";
import { createSupabaseJobStore } from "../src/lib/worker/supabase-store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const once = process.argv.includes("--once");
const env = parseServerEnv(process.env);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("The worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const deps = {
  storage: storageFromEnv(env),
  worker: new LocalFfmpegWorker({ ffmpegPath: env.FFMPEG_PATH === "ffmpeg" ? undefined : env.FFMPEG_PATH }),
  store: createSupabaseJobStore(admin),
  log: (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields })),
};

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(JSON.stringify({ event: "worker_started", storage: deps.storage.driver, once }));
  while (!stopping) {
    let outcome;
    try {
      outcome = await runOnce(deps);
    } catch (err) {
      // Infrastructure problem (database unreachable, ...). Back off and keep going; never crash-loop hot.
      console.error(JSON.stringify({ event: "worker_error", cause: err instanceof Error ? err.message : String(err) }));
      if (once) process.exit(1);
      await sleep(10_000);
      continue;
    }
    if (outcome === "idle") {
      if (once) break;
      await sleep(3_000);
    }
  }
  console.log(JSON.stringify({ event: "worker_stopped" }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
