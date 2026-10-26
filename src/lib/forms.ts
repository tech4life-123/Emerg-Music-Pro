/** Shared by server actions and the client forms that render their result. No secrets, safe to import anywhere. */
export type FormState = { status: "idle" } | { status: "error"; message: string; field?: string } | { status: "success"; message: string };
export const IDLE: FormState = { status: "idle" };
export const fail = (message: string, field?: string): FormState => ({ status: "error", message, field });
export const done = (message: string): FormState => ({ status: "success", message });

/** Only same-site relative paths are allowed as a post-login destination (no open redirect). */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("\0") || next.length > 300) return fallback;
  return next;
}

export function text(form: FormData, name: string, max = 500): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Database errors reach artists and admins as messages. We show ONLY messages the database raised on purpose
 * (P0001 'raise exception' with business wording); policy/permission/internal errors become generic text.
 */
export function dbMessage(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Nothing was changed.";
  const m = error.message ?? "";
  if (error.code === "P0001") return m;
  if (/row-level security|permission denied/i.test(m)) return "You are not allowed to do that.";
  if (error.code === "23505") return /one_pending_per_user|one_active_per_user/.test(m) ? "You already have an application in progress." : "That already exists.";
  if (error.code === "23514") return "Please check the values you entered.";
  return "Something went wrong. Nothing was changed.";
}
