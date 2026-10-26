"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { dbMessage, done, fail, text, type FormState } from "@/lib/forms";
import { COUNTRIES } from "@/lib/legal";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

const TYPES = ["solo", "band", "group", "producer", "label"];
const countryCodes = new Set(COUNTRIES.map(([c]) => c));
const email = z.string().email().max(254);
const uuid = z.string().uuid();

async function ctx() {
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") return { ok: false, error: fail("Please sign in again.") } as const;
  if (!formLimits.studio.check(`apply:${viewer.userId}`)) return { ok: false, error: fail("Too many requests. Wait a moment.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  return { ok: true, viewer, db } as const;
}

/** Save the draft, or save and submit it (intent=submit). Everything is re-checked by the database; the submit function enforces completeness. */
export async function saveApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const name = text(form, "artist_name", 80), bio = text(form, "bio", 2000), type = text(form, "artist_type", 12), country = text(form, "country", 2).toUpperCase();
  const hometown = text(form, "hometown", 80), contact = text(form, "contact_email", 254), genre = text(form, "genre_id", 40);
  const secondary = form.getAll("secondary").map(String).filter((g) => uuid.safeParse(g).success && g !== genre).slice(0, 3);
  if (name.length < 2) return fail("Enter your artist name (at least 2 characters).", "artist_name");
  if (form.get("accept") !== "on") return fail("You must accept the statement to apply.", "accept");
  if (type && !TYPES.includes(type)) return fail("Choose a valid artist type.", "artist_type");
  if (country && !countryCodes.has(country)) return fail("Choose a country from the list.", "country");
  if (contact && !email.safeParse(contact).success) return fail("Enter a valid contact email.", "contact_email");
  if (genre && !uuid.safeParse(genre).success) return fail("Choose a genre from the list.", "genre_id");
  const links = text(form, "links", 1000).split(/\s+/).filter(Boolean).slice(0, 5);
  for (const l of links) { try { if (!/^https?:$/.test(new URL(l).protocol)) throw 0; } catch { return fail("Links must start with http:// or https://", "links"); } }

  const fields = {
    artist_name: name, bio: bio || null, links, artist_type: type || null, country: country || null, hometown: hometown || null,
    contact_email: contact || null, genre_id: genre || null, secondary_genre_ids: secondary, authority_confirmed: form.get("authority") === "on",
  };
  const { data: existing } = await c.db.from("artist_applications").select("id").eq("user_id", c.viewer.userId).in("status", ["draft", "info_requested"]).maybeSingle();
  let id = existing?.id as string | undefined;
  if (id) {
    const { error } = await c.db.from("artist_applications").update(fields).eq("id", id);
    if (error) return fail(dbMessage(error));
  } else {
    const { data, error } = await c.db.from("artist_applications").insert({ ...fields, user_id: c.viewer.userId, status: "draft", rights_statement_accepted: true }).select("id").single();
    if (error) return fail(error.message.includes("row-level security") ? "Verify your email address first (see Account), then try again." : dbMessage(error));
    id = data.id as string;
  }
  if (form.get("intent") === "submit") {
    const { error } = await c.db.rpc("submit_artist_application", { p_application: id });
    if (error) return fail(dbMessage(error));
    revalidatePath("/studio");
    redirect("/studio");
  }
  revalidatePath("/studio/apply");
  return done("Draft saved. You can come back and finish it later.");
}

export async function replyToApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx(); if (!c.ok) return c.error;
  const id = text(form, "id", 40), body = text(form, "body", 2000);
  if (!uuid.safeParse(id).success) return fail("Application not found.");
  if (body.length < 2) return fail("Write a reply.", "body");
  const { error } = await c.db.from("application_messages").insert({ application_id: id, author_id: c.viewer.userId, from_staff: false, body });
  if (error) return fail(dbMessage(error));
  revalidatePath("/studio");
  return done("Reply sent.");
}
