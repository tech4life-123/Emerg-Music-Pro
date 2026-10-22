import "server-only";
import { createUserClient } from "@/lib/supabase/server";

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;
export type ReleaseRow = { id: string; title: string; type: string; status: "draft" | "in_review" | "published" | "removed"; removal_reason: string | null; created_at: string };
export type TrackRow = { id: string; title: string; track_number: number; processing_status: "pending" | "processing" | "ready" | "failed"; removed_at: string | null; removal_reason: string | null };
export type RightsRow = { id: string; basis: string; rights_holder_name: string; territories: string[]; term_start: string; term_end: string | null; review_status: string; review_note: string | null };

// Explicit column lists: audio paths are not readable by clients, so `select *` on tracks would fail by design.
export async function myArtist(db: Db, userId: string) {
  const { data } = await db.from("artists").select("id,name,slug,status").eq("owner_id", userId).maybeSingle();
  return data as { id: string; name: string; slug: string; status: string } | null;
}
export async function myReleases(db: Db, artistId: string) {
  const { data } = await db.from("releases").select("id,title,type,status,removal_reason,created_at").eq("artist_id", artistId).order("created_at", { ascending: false });
  return (data ?? []) as ReleaseRow[];
}
export async function releaseWorkspace(db: Db, id: string) {
  const { data: release } = await db.from("releases").select("id,title,type,status,removal_reason,artist_id,genre_id,language,created_at").eq("id", id).maybeSingle();
  if (!release) return null;
  const [tracks, rights, decl] = await Promise.all([
    db.from("tracks").select("id,title,track_number,processing_status,removed_at,removal_reason").eq("release_id", id).order("track_number"),
    db.from("rights_records").select("id,basis,rights_holder_name,territories,term_start,term_end,review_status,review_note").eq("release_id", id).order("created_at", { ascending: false }),
    db.from("rights_declarations").select("id,accepted_at").eq("release_id", id).limit(1),
  ]);
  return {
    release: release as ReleaseRow & { artist_id: string },
    tracks: (tracks.data ?? []) as TrackRow[],
    rights: (rights.data ?? []) as RightsRow[],
    declared: (decl.data ?? []).length > 0,
  };
}
export async function genreOptions(db: Db) {
  const { data } = await db.from("genres").select("id,name").order("sort");
  return (data ?? []) as { id: string; name: string }[];
}
