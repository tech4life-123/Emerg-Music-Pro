"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { ARTIST_IMAGE_RE, type ArtistImageKind } from "@/lib/artist-image";
import { dbMessage, done, fail, text, type FormState } from "@/lib/forms";
import { COUNTRIES } from "@/lib/legal";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

const TYPES = ["solo", "band", "group", "producer", "label"];
const countryCodes = new Set(COUNTRIES.map(([c]) => c));
const uuid = z.string().uuid();
const emailSchema = z.string().email().max(254);

/** Signed in, rate limited, owns an approved artist profile. Everything then runs AS THE USER, so RLS and triggers are the real boundary. */
async function ctx() {
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") return { ok: false, error: fail("Please sign in again.") } as const;
  if (!formLimits.studio.check(`profile:${viewer.userId}`)) return { ok: false, error: fail("Too many requests. Wait a moment.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  const { data: a } = await db.from("artists").select("id,slug").eq("owner_id", viewer.userId).eq("status", "approved").maybeSingle();
  if (!a) return { ok: false, error: fail("Your artist profile is not active.") } as const;
  return { ok: true, db, artistId: a.id as string, slug: a.slug as string } as const;
}

function refresh(slug: string) {
  revalidatePath("/studio/profile");
  revalidatePath(`/artists/${slug}`);
}

export async function saveArtistProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const bio = text(form, "bio", 2000), type = text(form, "artist_type", 12), country = text(form, "country", 2).toUpperCase();
  const hometown = text(form, "hometown", 80), contact = text(form, "contact_email", 254), featured = text(form, "featured_release_id", 40);
  if (bio.length < 20) return fail("Write at least 20 characters about yourself.", "bio");
  if (type && !TYPES.includes(type)) return fail("Choose a valid artist type.", "artist_type");
  if (country && !countryCodes.has(country)) return fail("Choose a country from the list.", "country");
  if (contact && !emailSchema.safeParse(contact).success) return fail("Enter a valid contact email.", "contact_email");
  if (featured && !uuid.safeParse(featured).success) return fail("Choose one of your releases.", "featured_release_id");
  const links = text(form, "links", 1000).split(/\s+/).filter(Boolean);
  if (links.length > 5) return fail("You can add up to 5 links.", "links");
  for (const l of links) { try { if (!/^https?:$/.test(new URL(l).protocol)) throw 0; } catch { return fail("Links must start with http:// or https://", "links"); } }

  const { error } = await c.db.from("artists").update({
    bio, artist_type: type || null, country: country || null, hometown: hometown || null, links, featured_release_id: featured || null,
  }).eq("id", c.artistId);
  if (error) return fail(error.message.includes("Feature one of your own") ? "Feature one of your own published releases." : dbMessage(error), error.message.includes("Feature one") ? "featured_release_id" : undefined);
  // The contact email is private: it lives in its own table that only the owner and staff can read.
  // (Not an upsert: that would also rewrite artist_id, which the owner may not update.)
  const { data: updated, error: e2 } = await c.db.from("artist_private").update({ contact_email: contact || null }).eq("artist_id", c.artistId).select("artist_id");
  if (e2) return fail(dbMessage(e2));
  if (!updated?.length) {
    const { error: e3 } = await c.db.from("artist_private").insert({ artist_id: c.artistId, contact_email: contact || null });
    if (e3) return fail(dbMessage(e3));
  }
  refresh(c.slug);
  return done("Profile saved.");
}

/** The browser uploads the cropped image straight to the "artists" bucket (storage rules allow only your own folder); this records its path. */
export async function setArtistImageAction(kind: ArtistImageKind, path: string): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const m = ARTIST_IMAGE_RE.exec(path);
  if (!m || m[1] !== c.artistId || m[2] !== kind) return fail("That picture could not be saved.");
  const { error } = await c.db.from("artists").update(kind === "avatar" ? { image_url: path } : { header_url: path }).eq("id", c.artistId);
  if (error) return fail(dbMessage(error));
  refresh(c.slug);
  return done(kind === "avatar" ? "Picture updated." : "Header updated.");
}

export async function removeArtistImageAction(kind: ArtistImageKind): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const { error } = await c.db.from("artists").update(kind === "avatar" ? { image_url: null } : { header_url: null }).eq("id", c.artistId);
  if (error) return fail(dbMessage(error));
  refresh(c.slug);
  return done("Removed.");
}
