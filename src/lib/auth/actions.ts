"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { fail, done, safeNext, text, type FormState } from "@/lib/forms";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
});

async function ip(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: text(form, "email", 254), password: String(form.get("password") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your details.", String(parsed.error.issues[0]?.path[0] ?? ""));
  if (!formLimits.auth.check(`signin:${await ip()}:${parsed.data.email}`)) return fail("Too many attempts. Wait a minute and try again.");

  const supabase = await createUserClient();
  if (!supabase) return fail("Sign-in is not available: no backend is connected.");
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure: never reveal whether an account exists.
  if (error) return fail("Email or password is incorrect.");
  redirect(safeNext(form.get("next"), "/studio"));
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name", 80);
  const parsed = credentials.safeParse({ email: text(form, "email", 254), password: String(form.get("password") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your details.", String(parsed.error.issues[0]?.path[0] ?? ""));
  if (name.length < 2) return fail("Enter your name (at least 2 characters).", "name");
  if (!formLimits.auth.check(`signup:${await ip()}`)) return fail("Too many attempts. Wait a minute and try again.");

  const supabase = await createUserClient();
  if (!supabase) return fail("Sign-up is not available: no backend is connected.");
  const { data, error } = await supabase.auth.signUp({ ...parsed.data, options: { data: { display_name: name } } });
  if (error) return fail("We could not create that account. If you already have one, sign in instead.");
  if (data.session) redirect(safeNext(form.get("next"), "/studio"));
  // Email confirmation is on: no session yet. Same wording whether or not the address was already registered.
  return done("Check your email to confirm your address, then sign in.");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createUserClient();
  await supabase?.auth.signOut();
  redirect("/");
}
