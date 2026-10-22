import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "./config";

/**
 * User-scoped client: runs as the signed-in user (or anon), so Row Level Security applies.
 * Returns null when Supabase is not configured (the app then shows an explicit "not configured" state).
 */
export async function createUserClient() {
  const cfg = getPublicSupabaseConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. Safe to ignore.
        }
      },
    },
  });
}
