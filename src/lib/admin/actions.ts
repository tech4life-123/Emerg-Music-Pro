"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, done, text, dbMessage, type FormState } from "@/lib/forms";
import { evaluateAccess, getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";

/** Admin gate for every action. The database functions check is_admin() again: this is defence in depth, not the only control. */
async function admin() {
  const access = evaluateAccess(await getViewer(), ["admin"]);
  if (!access.ok) return { ok: false, error: fail("You are not allowed to do that.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  return { ok: true, db } as const;
}
/** Staff (admin or moderator) gate: used only by application review. The database functions check is_staff() again. */
async function staff() {
  const access = evaluateAccess(await getViewer(), ["admin", "moderator"]);
  if (!access.ok) return { ok: false, error: fail("You are not allowed to do that.") } as const;
  const db = await createUserClient();
  if (!db) return { ok: false, error: fail("No backend is connected.") } as const;
  return { ok: true, db } as const;
}
const uuid = z.string().uuid();
const need = (v: string, what: string): FormState | null => (v.length >= 3 ? null : fail(`Give a reason (${what}).`, "reason"));

export async function decideApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await staff(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), decision = text(form, "decision", 10), reason = text(form, "reason", 500);
  if (!uuid.safeParse(id).success) return fail("Application not found.");
  if (decision === "approve") {
    const { error } = await a.db.rpc("approve_artist_application", { p_application: id });
    if (error) return fail(dbMessage(error));
  } else if (decision === "reject") {
    const bad = need(reason, "the applicant will see it"); if (bad) return bad;
    const { error } = await a.db.rpc("reject_artist_application", { p_application: id, p_reason: reason });
    if (error) return fail(dbMessage(error));
  } else return fail("Choose approve or reject.");
  revalidatePath("/admin", "layout");
  revalidatePath("/staff", "layout");
  return done(decision === "approve" ? "Approved." : "Rejected.");
}

export async function startReviewAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await staff(); if (!a.ok) return a.error;
  const id = text(form, "id", 40);
  if (!uuid.safeParse(id).success) return fail("Application not found.");
  const { error } = await a.db.rpc("start_application_review", { p_application: id });
  if (error) return fail(dbMessage(error));
  revalidatePath("/staff", "layout");
  return done("Marked as under review.");
}

export async function requestInfoAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await staff(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), message = text(form, "reason", 1000);
  if (!uuid.safeParse(id).success) return fail("Application not found.");
  if (message.length < 3) return fail("Write what you need from the applicant.", "reason");
  const { error } = await a.db.rpc("request_application_info", { p_application: id, p_message: message });
  if (error) return fail(dbMessage(error));
  revalidatePath("/staff", "layout");
  return done("Request sent to the applicant.");
}

export async function reviewRightsAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await admin(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), status = text(form, "status", 30), note = text(form, "reason", 500);
  if (!uuid.safeParse(id).success) return fail("Rights record not found.");
  if (!["approved", "changes_requested", "rejected"].includes(status)) return fail("Choose a decision.");
  if (status !== "approved") { const bad = need(note, "the artist will see it"); if (bad) return bad; }
  const { error } = await a.db.rpc("review_rights_record", { p_record: id, p_status: status, p_note: note || null });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin", "layout");
  return done("Decision saved.");
}

export async function moderateReleaseAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await admin(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), status = text(form, "status", 20), reason = text(form, "reason", 500);
  if (!uuid.safeParse(id).success) return fail("Release not found.");
  if (!["published", "draft", "removed"].includes(status)) return fail("Choose an action.");
  if (status !== "published") { const bad = need(reason, "the artist will see it"); if (bad) return bad; }
  const { error } = await a.db.rpc("moderate_release", { p_release: id, p_status: status, p_reason: reason || null });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin", "layout");
  return done(status === "published" ? "Published." : status === "draft" ? "Sent back to the artist." : "Release removed.");
}

export async function trackTakedownAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await admin(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), mode = text(form, "mode", 10), reason = text(form, "reason", 500);
  if (!uuid.safeParse(id).success) return fail("Track not found.");
  const bad = need(reason, mode === "restore" ? "a note for the audit log" : "the artist will see it"); if (bad) return bad;
  const { error } = mode === "restore"
    ? await a.db.rpc("restore_track", { p_track: id, p_note: reason })
    : await a.db.rpc("takedown_track", { p_track: id, p_reason: reason });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin", "layout");
  return done(mode === "restore" ? "Track restored." : "Track taken down. New playback requests are refused immediately.");
}

export async function resolveReportAction(_: FormState, form: FormData): Promise<FormState> {
  const a = await admin(); if (!a.ok) return a.error;
  const id = text(form, "id", 40), status = text(form, "status", 20), note = text(form, "reason", 1000);
  if (!uuid.safeParse(id).success) return fail("Report not found.");
  if (!["under_review", "upheld", "dismissed"].includes(status)) return fail("Choose an outcome.");
  const bad = need(note, "recorded with the decision"); if (bad) return bad;
  const { error } = await a.db.rpc("resolve_copyright_report", { p_report: id, p_status: status, p_note: note });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin", "layout");
  return done("Report updated.");
}
