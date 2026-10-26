import "server-only";
import { createUserClient } from "@/lib/supabase/server";

export type AppRole = "listener" | "artist" | "admin";

export type Viewer =
  | { status: "unconfigured" }
  | { status: "anonymous" }
  | { status: "signed_in"; userId: string; roles: AppRole[]; emailVerified?: boolean };

/** Who is looking? Identity comes from the verified Supabase session (getUser hits the auth server), never from a cookie claim. */
export async function getViewer(): Promise<Viewer> {
  const supabase = await createUserClient();
  if (!supabase) return { status: "unconfigured" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "anonymous" };
  // Live schema: one role per profile (enum user_role). Column grants stop a user changing their own role.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return { status: "signed_in", userId: data.user.id, roles: profile?.role ? [profile.role as AppRole] : [], emailVerified: Boolean(data.user.email_confirmed_at) };
}

export type Access = { ok: true; viewer: Extract<Viewer, { status: "signed_in" }> } | { ok: false; reason: "unconfigured" | "anonymous" | "forbidden" };

/**
 * Server-side role gate for pages. Hiding a link is never the control: pages call this, and the database
 * policies behind every query enforce the same rule independently.
 */
export function evaluateAccess(viewer: Viewer, anyOf: AppRole[]): Access {
  if (viewer.status === "unconfigured") return { ok: false, reason: "unconfigured" };
  if (viewer.status === "anonymous") return { ok: false, reason: "anonymous" };
  if (!viewer.roles.some((r) => anyOf.includes(r))) return { ok: false, reason: "forbidden" };
  return { ok: true, viewer };
}

/** Where a signed-in person lands when no explicit destination was requested. Administrators go straight to their console. */
export function landingFor(roles: AppRole[], onboarded = true): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("artist")) return "/studio";
  return onboarded ? "/" : "/onboarding";
}
