"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, text, dbMessage, type FormState } from "@/lib/forms";
import { getViewer } from "@/lib/auth/viewer";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";
import { RIGHTS_STATEMENT_VERSION } from "./rights-statement";

/** Every studio action: signed in, rate limited, and then runs AS THE USER so RLS is the real boundary. */
async function ctx() {
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") return { ok: false, error: fail("Please sign in again.") } as const;
  if (!formLimits.studio.check(`studio:${viewer.userId}`)) return { ok: false, error: fail("Too many requests. Wait a moment.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  return { ok: true, viewer, db } as const;
}

const uuid = z.string().uuid();

export async function applyAsArtistAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const name = text(form, "artist_name", 80), bio = text(form, "bio", 2000);
  if (name.length < 2) return fail("Enter your artist name (at least 2 characters).", "artist_name");
  if (form.get("accept") !== "on") return fail("You must accept the statement to apply.", "accept");
  const links = text(form, "links", 1000).split(/\s+/).filter(Boolean).slice(0, 5);
  for (const l of links) { try { if (!/^https?:$/.test(new URL(l).protocol)) throw 0; } catch { return fail("Links must start with http:// or https://", "links"); } }
  const { error } = await c.db.from("artist_applications").insert({ user_id: c.viewer.userId, artist_name: name, bio: bio || null, links, rights_statement_accepted: true });
  if (error) return fail(dbMessage(error));
  revalidatePath("/studio");
  redirect("/studio");
}

async function myArtistId(db: NonNullable<Awaited<ReturnType<typeof createUserClient>>>, userId: string) {
  const { data } = await db.from("artists").select("id").eq("owner_id", userId).eq("status", "approved").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function createReleaseAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const title = text(form, "title", 120), type = text(form, "type", 10), genre = text(form, "genre_id", 40), language = text(form, "language", 10) || "en";
  if (!title) return fail("Enter a title.", "title");
  if (!["single", "ep", "album"].includes(type)) return fail("Choose single, EP or album.", "type");
  if (!uuid.safeParse(genre).success) return fail("Choose a genre.", "genre_id");
  const artistId = await myArtistId(c.db, c.viewer.userId);
  if (!artistId) return fail("Your artist profile is not active.");
  const id = randomUUID();
  const { error } = await c.db.from("releases").insert({ id, artist_id: artistId, title, type, language, genre_id: genre });
  if (error) return fail(dbMessage(error));
  redirect(`/studio/releases/${id}`);
}

export async function addTrackAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const releaseId = text(form, "release_id", 40), title = text(form, "title", 120);
  if (!uuid.safeParse(releaseId).success) return fail("Release not found.");
  if (!title) return fail("Enter a track title.", "title");
  const { data: rel } = await c.db.from("releases").select("id,artist_id,genre_id").eq("id", releaseId).maybeSingle();
  if (!rel) return fail("Release not found.");
  const { count } = await c.db.from("tracks").select("id", { count: "exact", head: true }).eq("release_id", releaseId);
  const { error } = await c.db.from("tracks").insert({
    id: randomUUID(), release_id: releaseId, artist_id: rel.artist_id, title, track_number: (count ?? 0) + 1,
    genre_id: rel.genre_id, explicit: form.get("explicit") === "on",
  });
  if (error) return fail(dbMessage(error));
  revalidatePath(`/studio/releases/${releaseId}`);
  return done("Track added. Now upload its audio.");
}

export async function deleteTrackAction(form: FormData): Promise<void> {
  const c = await ctx(); if (!c.ok) return;
  const trackId = text(form, "track_id", 40), releaseId = text(form, "release_id", 40);
  if (!uuid.safeParse(trackId).success || !uuid.safeParse(releaseId).success) return;
  await c.db.from("tracks").delete().eq("id", trackId).eq("release_id", releaseId);
  revalidatePath(`/studio/releases/${releaseId}`);
}

export async function declareRightsAction(form: FormData): Promise<void> {
  const c = await ctx(); if (!c.ok) return;
  const releaseId = text(form, "release_id", 40);
  if (!uuid.safeParse(releaseId).success || form.get("accept") !== "on") return;
  await c.db.from("rights_declarations").insert({ release_id: releaseId, user_id: c.viewer.userId, statement_version: RIGHTS_STATEMENT_VERSION });
  revalidatePath(`/studio/releases/${releaseId}`);
}

const territory = /^(WW|[A-Z]{2})$/;
export async function addRightsRecordAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const releaseId = text(form, "release_id", 40), basis = text(form, "basis", 30), holder = text(form, "rights_holder_name", 200);
  const territories = text(form, "territories", 200).toUpperCase().split(/[\s,]+/).filter(Boolean);
  const start = text(form, "term_start", 10), end = text(form, "term_end", 10);
  if (!uuid.safeParse(releaseId).success) return fail("Release not found.");
  if (!["owner", "licensed", "authorized_distributor"].includes(basis)) return fail("Choose how you hold the rights.", "basis");
  if (!holder) return fail("Enter the rights holder's name.", "rights_holder_name");
  if (!territories.length || !territories.every((t) => territory.test(t))) return fail("Use two-letter country codes (e.g. LR, GH) or WW for worldwide.", "territories");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return fail("Enter the date the rights start.", "term_start");
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return fail("Enter a valid end date or leave it empty.", "term_end");
  if (end && end < start) return fail("The end date must be after the start date.", "term_end");
  const { data: decl } = await c.db.from("rights_declarations").select("id").eq("release_id", releaseId).limit(1).maybeSingle();
  const { error } = await c.db.from("rights_records").insert({
    release_id: releaseId, declared_by: c.viewer.userId, basis, rights_holder_name: holder, territories,
    term_start: start, term_end: end || null, declaration_id: decl?.id ?? null,
  });
  if (error) return fail(dbMessage(error));
  revalidatePath(`/studio/releases/${releaseId}`);
  return done("Rights record saved. An administrator will review it.");
}

export async function submitReleaseAction(form: FormData): Promise<void> {
  const c = await ctx(); if (!c.ok) return;
  const releaseId = text(form, "release_id", 40);
  if (!uuid.safeParse(releaseId).success) return;
  const { error } = await c.db.from("releases").update({ status: "in_review" }).eq("id", releaseId).eq("status", "draft");
  // The database enforces completeness and says what is missing; surface it on the page via the query string.
  redirect(`/studio/releases/${releaseId}${error ? `?submit_error=${encodeURIComponent(dbMessage(error))}` : "?submitted=1"}`);
}
