import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { createSampleCatalog } from "./sample-repo";
import { createSupabaseCatalog } from "./supabase-repo";
import type { CatalogRepo } from "./types";

/**
 * The catalog for this request, or null when no backend is configured.
 * CATALOG_SOURCE=sample is an explicit, banner-labelled local preview mode; it is refused when
 * NODE_ENV=production unless ALLOW_SAMPLE_CATALOG=1 is also set, so production cannot show sample data by accident.
 */
export async function getCatalog(): Promise<CatalogRepo | null> {
  if (process.env.CATALOG_SOURCE === "sample" && (process.env.NODE_ENV !== "production" || process.env.ALLOW_SAMPLE_CATALOG === "1")) {
    return createSampleCatalog();
  }
  const db = await createUserClient();
  return db ? createSupabaseCatalog(db) : null;
}

export type { CatalogRepo, Result } from "./types";
