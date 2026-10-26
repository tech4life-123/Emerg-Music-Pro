"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { fail, done, safeNext, text, type FormState } from "@/lib/forms";
import { formLimits } from "@/lib/services/limits";
import { landingFor, type AppRole } from "@/lib/auth/viewer";
import { TERMS_VERSION, USERNAME_RE } from "@/lib/legal";
import { siteOrigin } from "@/lib/site";
import { createUserClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
});

/** Turnstile token added to the form by the widget; undefined when no widget is configured. */
const captcha = (form: FormData) => String(form.get("cf-turnstile-response") ?? "") || undefined;

async function ip(): Promise<string> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: text(form, "email", 254), password: String(form.get("password") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your details.", String(parsed.error.issues[0]?.path[0] ?? ""));
  if (!formLimits.auth.check(`signin:${await ip()}:${parsed.data.email}`)) return fail("Too many attempts. Wait a minute and try again.");

  const supabase = await createUserClient();
  if (!supabase) return fail("Sign-in is not available: no backend is connected.");
  const { data, error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: { captchaToken: captcha(form) } });
  // One message for every failure: never reveal whether an account exists.
  if (error || !data.user) {
    // Server log only (never shown to the visitor, never includes the password): lets the operator tell a wrong password
    // from a misconfigured project (e.g. an invalid API key) when the visitor only sees the generic message.
    console.error("auth.signin_failed", JSON.stringify({ code: error?.code ?? null, status: error?.status ?? null, name: error?.name ?? null, message: error?.message ?? "no user returned" }));
    return fail("Email or password is incorrect.");
  }
  const { data: profile } = await supabase.from("profiles").select("role,onboarding_completed_at").eq("id", data.user.id).maybeSingle();
  redirect(safeNext(form.get("next"), landingFor(profile?.role ? [profile.role as AppRole] : [], Boolean(profile?.onboarding_completed_at))));
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name", 80);
  const username = text(form, "username", 24).toLowerCase();
  const parsed = credentials.safeParse({ email: text(form, "email", 254), password: String(form.get("password") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your details.", String(parsed.error.issues[0]?.path[0] ?? ""));
  if (name.length < 2) return fail("Enter your name (at least 2 characters).", "name");
  if (!USERNAME_RE.test(username)) return fail("Username: 3 to 24 characters, lowercase letters, numbers and underscore.", "username");
  if (form.get("terms") !== "on") return fail("Accept the Terms and Privacy Policy to continue.", "terms");
  if (!formLimits.auth.check(`signup:${await ip()}`)) return fail("Too many attempts. Wait a minute and try again.");

  const supabase = await createUserClient();
  if (!supabase) return fail("Sign-up is not available: no backend is connected.");
  const { data: free } = await supabase.rpc("username_available", { p_username: username });
  if (free === false) return fail("That username is taken or not allowed. Try another.", "username");
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { captchaToken: captcha(form), data: { display_name: name, username, terms_version: TERMS_VERSION }, emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/onboarding` },
  });
  if (error) return fail("We could not create that account. If you already have one, sign in instead.");
  if (data.session) redirect(safeNext(form.get("next"), "/onboarding"));
  // Email confirmation is on: no session yet. Same wording whether or not the address was already registered.
  return done("Check your email to confirm your address, then sign in.");
}

/** Always answers the same way, so the form cannot be used to find out which emails have accounts. */
export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(text(form, "email", 254));
  if (!email.success) return fail("Enter a valid email address.", "email");
  if (!formLimits.auth.check(`recover:${await ip()}`)) return fail("Too many attempts. Wait a minute and try again.");
  const supabase = await createUserClient();
  if (!supabase) return fail("Password recovery is not available: no backend is connected.");
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { captchaToken: captcha(form), redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password` });
  if (error) console.error("auth.recover_failed", JSON.stringify({ code: error.code ?? null, status: error.status ?? null }));
  return done("If that email has an account, a reset link is on its way. It can take a few minutes.");
}

const newPassword = z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters.");

/** Runs in the recovery session created by /auth/callback. */
export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const pw = newPassword.safeParse(String(form.get("password") ?? ""));
  if (!pw.success) return fail(pw.error.issues[0]?.message ?? "Check the password.", "password");
  if (form.get("password") !== form.get("confirm")) return fail("The two passwords do not match.", "confirm");
  const supabase = await createUserClient();
  if (!supabase) return fail("Not available: no backend is connected.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail("This reset link has expired. Ask for a new one.");
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return fail("We could not change the password. Ask for a new reset link.");
  await supabase.auth.signOut();
  redirect("/login?reset=1");
}

/** Signed-in password change: proves knowledge of the current password first. */
export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const pw = newPassword.safeParse(String(form.get("password") ?? ""));
  if (!pw.success) return fail(pw.error.issues[0]?.message ?? "Check the password.", "password");
  if (form.get("password") !== form.get("confirm")) return fail("The two passwords do not match.", "confirm");
  const supabase = await createUserClient();
  if (!supabase) return fail("Not available: no backend is connected.");
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return fail("Sign in again to change your password.");
  if (!formLimits.auth.check(`chpw:${data.user.id}`)) return fail("Too many attempts. Wait a minute and try again.");
  const check = await supabase.auth.signInWithPassword({ email: data.user.email, password: String(form.get("current") ?? "") });
  if (check.error) return fail("Your current password is incorrect.", "current");
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return fail("We could not change the password.");
  return done("Password changed.");
}

export async function resendVerificationAction(): Promise<FormState> {
  const supabase = await createUserClient();
  if (!supabase) return fail("Not available: no backend is connected.");
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return fail("Sign in first.");
  if (data.user.email_confirmed_at) return done("Your email is already verified.");
  if (!formLimits.auth.check(`resend:${data.user.id}`)) return fail("Too many attempts. Wait a minute and try again.");
  const { error } = await supabase.auth.resend({ type: "signup", email: data.user.email, options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=/account` } });
  if (error) return fail("We could not send the email right now. Try again later.");
  return done("Verification email sent. Check your inbox.");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createUserClient();
  await supabase?.auth.signOut();
  redirect("/");
}
