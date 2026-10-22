import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, JobStore } from "./pipeline";

/** JobStore over the service-role-only SQL functions. Pass a SERVICE ROLE client; never use this in a request handler for a user. */
export function createSupabaseJobStore(admin: SupabaseClient): JobStore {
  return {
    async claim(leaseSeconds) {
      const { data, error } = await admin.rpc("claim_processing_job", { p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`claim failed: ${error.message}`);
      const r = Array.isArray(data) ? data[0] : data;
      if (!r) return null;
      return { jobId: r.job_id, trackId: r.track_id, originalKey: r.original_key, attempts: r.attempts } satisfies ClaimedJob;
    },
    async complete(jobId, r) {
      const { data, error } = await admin.rpc("complete_processing_job", { p_job: jobId, p_low: r.lowKey, p_std: r.stdKey, p_duration_ms: r.durationMs });
      if (error) throw new Error(`complete failed: ${error.message}`);
      return data as "succeeded" | "superseded" | "not_running";
    },
    async fail(jobId, code, message, retry) {
      const { data, error } = await admin.rpc("fail_processing_job", { p_job: jobId, p_code: code, p_message: message, p_retry: retry });
      if (error) throw new Error(`fail failed: ${error.message}`);
      return data as "requeued" | "failed" | "not_running";
    },
  };
}
