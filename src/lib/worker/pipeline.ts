import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ObjectStorage } from "../media/storage";
import { AudioValidationError, type AudioWorker } from "./types";

export interface ClaimedJob {
  jobId: string;
  trackId: string;
  originalKey: string;
  attempts: number;
}

/** What the pipeline needs from the job queue. Implemented over Supabase RPCs (see supabase-store.ts). */
export interface JobStore {
  claim(leaseSeconds: number): Promise<ClaimedJob | null>;
  complete(jobId: string, r: { lowKey: string; stdKey: string; durationMs: number }): Promise<"succeeded" | "superseded" | "not_running">;
  fail(jobId: string, code: string, message: string, retry: boolean): Promise<"requeued" | "failed" | "not_running">;
}

export const RENDITIONS = { low: 64, std: 128 } as const; // kbps AAC

export type RunOutcome = "idle" | "succeeded" | "superseded" | "requeued" | "failed" | "lost_lease";

export interface PipelineDeps {
  storage: ObjectStorage;
  worker: AudioWorker;
  store: JobStore;
  leaseSeconds?: number;
  tmpRoot?: string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** Messages shown to artists. Never include paths, stack traces or tool output. */
const MESSAGES: Record<string, string> = {
  no_audio_stream: "We could not find audio in this file. Upload a WAV, FLAC, MP3, or M4A file.",
  too_short: "This audio is too short to publish.",
  too_long: "This audio is too long.",
  unreadable: "We could not read this file as audio. Export it again and upload a WAV, FLAC, MP3, or M4A file.",
  processing_error: "We could not process this file. Try uploading it again.",
};

/** audio/<artistId>/<trackId>/original-<uuid>.<ext>  ->  audio/<artistId>/<trackId>/ */
export function renditionPrefix(originalKey: string): string {
  const m = /^(audio\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/)[^/]+$/.exec(originalKey);
  if (!m) throw new Error("unexpected original key");
  return m[1]!;
}

/** Claim and process at most one job. Safe to call concurrently from several workers. */
export async function runOnce(deps: PipelineDeps): Promise<RunOutcome> {
  const log = deps.log ?? (() => undefined);
  const job = await deps.store.claim(deps.leaseSeconds ?? 600);
  if (!job) return "idle";

  const work = await mkdtemp(path.join(deps.tmpRoot ?? tmpdir(), "emerg-job-"));
  const uploaded: string[] = [];
  try {
    // 1. Pull the (untrusted) original out of quarantine.
    const input = path.join(work, "input");
    await pipeline(await deps.storage.read("originals", job.originalKey), createWriteStream(input, { mode: 0o600 }));

    // 2. Trust the content, not the filename or declared type.
    const probe = await deps.worker.probe(input);

    // 3. Renditions.
    const prefix = renditionPrefix(job.originalKey);
    const id = randomUUID();
    const keys = { low: `${prefix}low-${id}.m4a`, std: `${prefix}std-${id}.m4a` };
    for (const variant of ["low", "std"] as const) {
      const out = path.join(work, `${variant}.m4a`);
      await deps.worker.transcode(input, out, { bitrateKbps: RENDITIONS[variant] });
      const size = (await stat(out)).size;
      if (size === 0) throw new Error("empty rendition");
      await deps.storage.put("renditions", keys[variant], createReadStream(out), { maxBytes: Math.max(size, 1) + 1024, contentType: "audio/mp4" });
      uploaded.push(keys[variant]);
    }

    // 4. Publish the result only if this job still owns the track.
    const result = await deps.store.complete(job.jobId, { lowKey: keys.low, stdKey: keys.std, durationMs: probe.durationMs });
    if (result !== "succeeded") {
      await cleanup(deps.storage, uploaded);
      log("job_not_applied", { jobId: job.jobId, result });
      return result === "superseded" ? "superseded" : "lost_lease";
    }
    log("job_succeeded", { jobId: job.jobId, trackId: job.trackId, durationMs: probe.durationMs, codec: probe.codec });
    return "succeeded";
  } catch (err) {
    await cleanup(deps.storage, uploaded);
    const permanent = err instanceof AudioValidationError;
    const code = permanent ? err.code : "processing_error";
    const res = await deps.store.fail(job.jobId, code, MESSAGES[code] ?? MESSAGES.processing_error!, !permanent);
    // Log the real cause for operators only (never returned to clients).
    log("job_failed", { jobId: job.jobId, code, result: res, cause: err instanceof Error ? err.message : String(err) });
    return res === "requeued" ? "requeued" : res === "not_running" ? "lost_lease" : "failed";
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function cleanup(storage: ObjectStorage, keys: string[]) {
  await Promise.all(keys.map((k) => storage.remove("renditions", k).catch(() => undefined)));
}
