"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { done, fail, text, dbMessage, type FormState } from "@/lib/forms";
import { formLimits } from "@/lib/services/limits";
import { createUserClient } from "@/lib/supabase/server";

const email = z.string().email().max(254);

/** Public: anyone may report. Only the narrow insert grant (release, track, name, email, description) is available; status is the database default. */
export async function reportCopyrightAction(_: FormState, form: FormData): Promise<FormState> {
  const release = text(form, "release_id", 40), track = text(form, "track_id", 40);
  const name = text(form, "reporter_name", 120), mail = text(form, "reporter_email", 254), description = text(form, "description", 4000);
  if (!z.string().uuid().safeParse(release).success) return fail("Open this form from a release or track page.");
  if (track && !z.string().uuid().safeParse(track).success) return fail("Track not found.");
  if (name.length < 2) return fail("Enter your name.", "reporter_name");
  if (!email.safeParse(mail).success) return fail("Enter a valid email address.", "reporter_email");
  if (description.length < 10) return fail("Describe the problem in at least 10 characters.", "description");
  if (form.get("confirm") !== "on") return fail("Please confirm your statement is accurate.", "confirm");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!formLimits.report.check(`report:${ip}`)) return fail("Too many reports from your network. Try again later.");
  const db = await createUserClient();
  if (!db) return fail("Reporting is not available: no backend is connected.");
  const { error } = await db.from("copyright_reports").insert({ release_id: release, track_id: track || null, reporter_name: name, reporter_email: mail, description });
  if (error) return fail(/Release not found|track/i.test(error.message) ? "We could not find that release or track." : dbMessage(error));
  return done("Thank you. Your report was received and will be reviewed by an administrator.");
}
