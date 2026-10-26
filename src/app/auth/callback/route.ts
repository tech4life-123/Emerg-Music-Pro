import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/forms";
import { createUserClient } from "@/lib/supabase/server";

/** Email links (confirm address, reset password) land here with a one-time code that becomes a session. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/");
  const supabase = await createUserClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/login?link=invalid", url.origin));
}
