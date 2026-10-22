import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { json } from "@/lib/http";
import { createUserClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Processing progress for ONE track. Runs as the signed-in user, so RLS decides whether they may see it. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "not_found" }, 404);
  const viewer = await getViewer();
  if (viewer.status !== "signed_in") return json({ error: "unauthenticated" }, 401);
  const db = await createUserClient();
  if (!db) return json({ error: "not_configured" }, 503);
  const { data: t } = await db.from("tracks").select("id,processing_status").eq("id", id).maybeSingle();
  if (!t) return json({ error: "not_found" }, 404);
  const { data: job } = await db.from("processing_jobs").select("status,attempts,error_message").eq("track_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return json({ processing: t.processing_status, job: job ?? null });
}
