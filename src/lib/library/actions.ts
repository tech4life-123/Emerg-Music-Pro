"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, text, dbMessage, type FormState } from "@/lib/forms";
import { getViewer } from "@/lib/auth/viewer";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Every library action: signed in, rate limited, then runs AS THE USER, so Row Level Security and the database triggers
 * (public-track checks, usage limits) are the real boundary. Nothing here uses the service role.
 */
async function ctx() {
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") return { ok: false, error: fail("Please sign in to do that.") } as const;
  if (!formLimits.library.check(`library:${viewer.userId}`)) return { ok: false, error: fail("Too many requests. Wait a moment.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  return { ok: true, viewer, db } as const;
}

const uuid = z.string().uuid();
const refresh = () => revalidatePath("/", "layout");
/** Friendlier wording for the two failures a listener can actually hit: the target is not public, or they are over a limit. */
const message = (e: { message?: string; code?: string }) =>
  /row-level security|not available/i.test(e.message ?? "") ? "That is not available." : dbMessage(e);

export async function setLikeAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const trackId = text(form, "track_id", 40);
  if (!uuid.safeParse(trackId).success) return fail("Track not found.");
  if (form.get("like") === "0") {
    const { error } = await c.db.from("favorites").delete().eq("user_id", c.viewer.userId).eq("track_id", trackId);
    if (error) return fail(message(error));
  } else {
    const { error } = await c.db.from("favorites").insert({ user_id: c.viewer.userId, track_id: trackId });
    if (error && error.code !== "23505") return fail(message(error)); // already liked is fine (idempotent)
  }
  refresh();
  return done("Saved.");
}

export async function setFollowAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const artistId = text(form, "artist_id", 40);
  if (!uuid.safeParse(artistId).success) return fail("Artist not found.");
  if (form.get("follow") === "0") {
    const { error } = await c.db.from("artist_follows").delete().eq("user_id", c.viewer.userId).eq("artist_id", artistId);
    if (error) return fail(message(error));
  } else {
    const { error } = await c.db.from("artist_follows").insert({ user_id: c.viewer.userId, artist_id: artistId });
    if (error && error.code !== "23505") return fail(message(error));
  }
  refresh();
  return done("Saved.");
}

export async function createPlaylistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const name = text(form, "name", 80);
  if (!name) return fail("Give the playlist a name.", "name");
  const { data, error } = await c.db.from("playlists").insert({ owner_id: c.viewer.userId, name, is_public: false }).select("id").single();
  if (error || !data) return fail(message(error ?? {}), "name");
  refresh();
  redirect(`/library/playlists/${data.id as string}`);
}

export async function renamePlaylistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const id = text(form, "playlist_id", 40), name = text(form, "name", 80);
  if (!uuid.safeParse(id).success) return fail("Playlist not found.");
  if (!name) return fail("Give the playlist a name.", "name");
  const { data, error } = await c.db.from("playlists").update({ name }).eq("id", id).eq("owner_id", c.viewer.userId).select("id");
  if (error) return fail(message(error));
  if (!data?.length) return fail("Playlist not found.");
  refresh();
  return done("Renamed.");
}

export async function deletePlaylistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const id = text(form, "playlist_id", 40);
  if (!uuid.safeParse(id).success) return fail("Playlist not found.");
  const { error } = await c.db.from("playlists").delete().eq("id", id).eq("owner_id", c.viewer.userId);
  if (error) return fail(message(error));
  refresh();
  redirect("/library");
}

export async function addToPlaylistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const playlistId = text(form, "playlist_id", 40), trackId = text(form, "track_id", 40);
  if (!uuid.safeParse(playlistId).success) return fail("Choose a playlist.");
  if (!uuid.safeParse(trackId).success) return fail("Track not found.");
  const { data: last } = await c.db.from("playlist_tracks").select("position").eq("playlist_id", playlistId).order("position", { ascending: false }).limit(1);
  const position = ((last?.[0]?.position as number | undefined) ?? -1) + 1;
  const { error } = await c.db.from("playlist_tracks").insert({ playlist_id: playlistId, track_id: trackId, position });
  if (error) return error.code === "23505" ? done("Already in that playlist.") : fail(message(error));
  refresh();
  return done("Added to playlist.");
}

export async function removeFromPlaylistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const playlistId = text(form, "playlist_id", 40), trackId = text(form, "track_id", 40);
  if (!uuid.safeParse(playlistId).success || !uuid.safeParse(trackId).success) return fail("Not found.");
  const { error } = await c.db.from("playlist_tracks").delete().eq("playlist_id", playlistId).eq("track_id", trackId);
  if (error) return fail(message(error));
  refresh();
  return done("Removed.");
}

/** Removes items whose track was taken down or unpublished (the owner can still see those rows, but they can no longer be played). */
export async function removeUnavailableAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const playlistId = text(form, "playlist_id", 40);
  if (!uuid.safeParse(playlistId).success) return fail("Playlist not found.");
  const { data: rows, error } = await c.db.from("playlist_tracks").select("track_id").eq("playlist_id", playlistId);
  if (error) return fail(message(error));
  const ids = (rows ?? []).map((r) => r.track_id as string);
  if (ids.length === 0) return done("Nothing to remove.");
  const { data: visible } = await c.db.from("tracks").select("id").in("id", ids);
  const live = new Set((visible ?? []).map((r) => r.id as string));
  const dead = ids.filter((i) => !live.has(i));
  if (dead.length === 0) return done("Nothing to remove.");
  const { error: e2 } = await c.db.from("playlist_tracks").delete().eq("playlist_id", playlistId).in("track_id", dead);
  if (e2) return fail(message(e2));
  refresh();
  return done(`Removed ${dead.length} unavailable ${dead.length === 1 ? "track" : "tracks"}.`);
}
