import "server-only";
import { createUserClient } from "@/lib/supabase/server";

export interface ReleaseCard {
  id: string;
  title: string;
  type: string;
  artistName: string;
}

export type CatalogResult =
  | { status: "unconfigured" }
  | { status: "error" }
  | { status: "ok"; releases: ReleaseCard[] };

/** Published releases of verified artists. Row Level Security enforces visibility; the explicit filter is just intent. */
export async function listPublishedReleases(limit = 24): Promise<CatalogResult> {
  const supabase = await createUserClient();
  if (!supabase) return { status: "unconfigured" };
  const { data, error } = await supabase
    .from("releases")
    .select("id,title,type,artists(name)")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) return { status: "error" };
  return {
    status: "ok",
    releases: (data ?? []).map((r) => {
      const a = r.artists as unknown as { name: string } | { name: string }[] | null;
      return { id: r.id, title: r.title, type: r.type, artistName: (Array.isArray(a) ? a[0]?.name : a?.name) ?? "Unknown artist" };
    }),
  };
}
