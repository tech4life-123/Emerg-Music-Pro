"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbMessage, done, fail, text, type FormState } from "@/lib/forms";
import { COUNTRIES, USERNAME_RE } from "@/lib/legal";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

type Db = NonNullable<Awaited<ReturnType<typeof createUserClient>>>;
type Ctx = { ok: true; db: Db; userId: string } | { ok: false; error: FormState };

async function ctx(): Promise<Ctx> {
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("Not available: no backend is connected.") };
  const { data } = await db.auth.getUser();
  if (!data.user) return { ok: false, error: fail("Sign in first.") };
  if (!formLimits.library.check(`profile:${data.user.id}`)) return { ok: false, error: fail("Too many changes. Wait a minute.") };
  return { ok: true, db, userId: data.user.id };
}

const countryCodes = new Set(COUNTRIES.map(([c]) => c));

export async function updateProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx();
  if (!c.ok) return c.error;
  const display_name = text(form, "display_name", 80);
  const username = text(form, "username", 24).toLowerCase();
  const bio = text(form, "bio", 500);
  const country = text(form, "country", 2).toUpperCase();
  if (display_name.length < 2) return fail("Enter a display name (at least 2 characters).", "display_name");
  if (username && !USERNAME_RE.test(username)) return fail("Username: 3 to 24 characters, lowercase letters, numbers and underscore.", "username");
  if (country && !countryCodes.has(country)) return fail("Choose a country from the list.", "country");
  const { error } = await c.db.from("profiles").update({
    display_name, bio: bio || null, country: country || null, username: username || null, profile_public: form.get("profile_public") === "on",
  }).eq("id", c.userId);
  if (error) return fail(error.code === "23505" || /username/i.test(error.message) ? "That username is taken or not allowed." : dbMessage(error), "username");
  revalidatePath("/account");
  return done("Profile saved.");
}

export async function requestDeletionAction(): Promise<FormState> {
  const c = await ctx();
  if (!c.ok) return c.error;
  const { error } = await c.db.from("account_deletion_requests").insert({ user_id: c.userId });
  if (error) return fail(error.code === "23505" ? "A deletion request is already waiting." : dbMessage(error));
  revalidatePath("/account");
  return done("Deletion requested. An administrator will process it; you can cancel until then.");
}

export async function cancelDeletionAction(): Promise<FormState> {
  const c = await ctx();
  if (!c.ok) return c.error;
  const { error } = await c.db.from("account_deletion_requests").delete().eq("user_id", c.userId).eq("status", "pending");
  if (error) return fail(dbMessage(error));
  revalidatePath("/account");
  return done("Deletion request cancelled.");
}

const genres = z.array(z.string().uuid()).max(10);

/** Onboarding finish: saves genres (skippable), optional follows, and marks onboarding complete. */
export async function finishOnboardingAction(_: FormState, form: FormData): Promise<FormState> {
  const c = await ctx();
  if (!c.ok) return c.error;
  const picked = genres.safeParse(form.getAll("genre").map(String));
  if (!picked.success) return fail("Choose up to 10 genres.");
  if (picked.data.length) {
    await c.db.from("user_genres").delete().eq("user_id", c.userId);
    const { error } = await c.db.from("user_genres").insert(picked.data.map((genre_id) => ({ user_id: c.userId, genre_id })));
    if (error) return fail(dbMessage(error));
  }
  for (const id of form.getAll("follow").map(String).slice(0, 20)) {
    if (/^[0-9a-f-]{36}$/i.test(id)) await c.db.from("artist_follows").insert({ user_id: c.userId, artist_id: id });
  }
  const { error } = await c.db.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", c.userId);
  if (error) return fail(dbMessage(error));
  redirect("/");
}

export async function skipOnboardingAction(): Promise<void> {
  const c = await ctx();
  if (!c.ok) redirect("/login");
  await c.db.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", c.userId);
  redirect("/");
}
