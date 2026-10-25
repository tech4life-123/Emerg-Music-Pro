import "server-only";
import { getViewer } from "@/lib/auth/viewer";
import { createUserClient } from "@/lib/supabase/server";

/** The signed-in viewer plus a user-scoped (RLS) client, or null for anonymous / unconfigured. */
export async function libraryViewer() {
  const v = await getViewer();
  if (v.status !== "signed_in") return null;
  const db = await createUserClient();
  return db ? { userId: v.userId, db } : null;
}
