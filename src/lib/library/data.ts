import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/catalog/query";

export interface LibraryTrack {
  id: string;
  title: string;
  durationMs: number | null;
  explicit: boolean;
  audioReady: boolean;
  artist: { id: string; slug: string; name: string };
  release: { id: string; title: string };
}
export interface PlaylistSummary { id: string; name: string; trackCount: number }
export interface FollowedArtist { id: string; slug: string; name: string }
export type Lib<T> = { status: "ok"; data: T } | { status: "error" };

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Same explicit column rule as the catalog: audio paths are never granted to clients.
const TRACK_EMBED = "tracks!inner(id,title,duration_ms,explicit,processing_status,releases!inner(id,title,artists!inner(id,slug,name)))";

function toTrack(t: Row | null): LibraryTrack | null {
  if (!t) return null;
  const rel = one(t.releases as Row | Row[] | null);
  const art = rel ? one(rel.artists as Row | Row[] | null) : null;
  if (!rel || !art) return null;
  return {
    id: String(t.id), title: String(t.title), durationMs: (t.duration_ms as number | null) ?? null, explicit: Boolean(t.explicit),
    audioReady: t.processing_status === "ready",
    artist: { id: String(art.id), slug: String(art.slug), name: String(art.name) },
    release: { id: String(rel.id), title: String(rel.title) },
  };
}

/** Tracks that were taken down or unpublished silently drop out: the inner joins run under Row Level Security. */
export async function likedTracks(db: SupabaseClient, userId: string): Promise<Lib<LibraryTrack[]>> {
  const { data, error } = await db.from("favorites").select(`created_at,${TRACK_EMBED}`).eq("user_id", userId).order("created_at", { ascending: false }).limit(300);
  if (error) return { status: "error" };
  return { status: "ok", data: (data as Row[]).flatMap((r) => toTrack(one(r.tracks as Row | Row[] | null)) ?? []) };
}

export async function followedArtists(db: SupabaseClient, userId: string): Promise<Lib<FollowedArtist[]>> {
  const { data, error } = await db.from("artist_follows").select("created_at,artists!inner(id,slug,name)").eq("user_id", userId).order("created_at", { ascending: false }).limit(300);
  if (error) return { status: "error" };
  return { status: "ok", data: (data as Row[]).flatMap((r) => { const a = one(r.artists as Row | Row[] | null); return a ? [{ id: String(a.id), slug: String(a.slug), name: String(a.name) }] : []; }) };
}

export async function myPlaylists(db: SupabaseClient, userId: string): Promise<Lib<PlaylistSummary[]>> {
  const { data, error } = await db.from("playlists").select("id,name,created_at,playlist_tracks(count)").eq("owner_id", userId).order("created_at", { ascending: false }).limit(300);
  if (error) return { status: "error" };
  return { status: "ok", data: (data as Row[]).map((p) => ({ id: String(p.id), name: String(p.name), trackCount: Number((one(p.playlist_tracks as Row | Row[] | null) as Row | null)?.count ?? 0) })) };
}

export interface PlaylistPage { id: string; name: string; tracks: LibraryTrack[]; unavailable: number }

export async function myPlaylist(db: SupabaseClient, userId: string, id: string): Promise<{ status: "ok"; data: PlaylistPage } | { status: "not_found" } | { status: "error" }> {
  if (!isUuid(id)) return { status: "not_found" };
  const { data: p, error } = await db.from("playlists").select("id,name").eq("id", id).eq("owner_id", userId).maybeSingle();
  if (error) return { status: "error" };
  if (!p) return { status: "not_found" };
  const [items, all] = await Promise.all([
    db.from("playlist_tracks").select(`position,${TRACK_EMBED}`).eq("playlist_id", id).order("position", { ascending: true }),
    db.from("playlist_tracks").select("track_id", { count: "exact", head: true }).eq("playlist_id", id),
  ]);
  if (items.error || all.error) return { status: "error" };
  const tracks = (items.data as Row[]).flatMap((r) => toTrack(one(r.tracks as Row | Row[] | null)) ?? []);
  return { status: "ok", data: { id: String(p.id), name: String(p.name), tracks, unavailable: Math.max((all.count ?? 0) - tracks.length, 0) } };
}

/** Which of these tracks does the viewer like? (one query for a whole list). */
export async function likedAmong(db: SupabaseClient, userId: string, trackIds: string[]): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set();
  const { data } = await db.from("favorites").select("track_id").eq("user_id", userId).in("track_id", trackIds);
  return new Set((data ?? []).map((r) => String(r.track_id)));
}

export async function isFollowing(db: SupabaseClient, userId: string, artistId: string): Promise<boolean> {
  const { data } = await db.from("artist_follows").select("artist_id").eq("user_id", userId).eq("artist_id", artistId).maybeSingle();
  return Boolean(data);
}

export async function followerCount(db: SupabaseClient, artistId: string): Promise<number | null> {
  const { data, error } = await db.rpc("artist_follower_count", { a: artistId });
  return error || typeof data !== "number" ? null : data;
}
