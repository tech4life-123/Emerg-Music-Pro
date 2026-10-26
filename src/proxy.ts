import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh. Access tokens last one hour; a Server Component that refreshes one cannot write the new
 * cookies, which would leave the browser holding a dead refresh token (uploads then run as signed-out and are refused).
 * Refreshing here, where cookies CAN be written, keeps the server and the browser on the same session.
 * It only ever touches the auth cookies, and never blocks or redirects a request.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();
  // Visitors without any auth cookie have nothing to refresh.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) response.cookies.set(name, value, options);
      },
    },
  });
  try { await supabase.auth.getUser(); } catch { /* an unreachable auth service must not take the site down */ }
  return response;
}

export const config = {
  // Pages and server actions only: not static files, images, or the audio streaming routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|api/stream|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)$).*)"],
};
