import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

/**
 * SERVICE-ROLE client: bypasses RLS. Server-only (the `server-only` import fails the build if this is
 * ever pulled into a client bundle). Use ONLY for the few operations that are not user-scoped, e.g. the
 * playback gate and registering an uploaded asset after the server verified the bytes.
 */
export function createAdminClient() {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
