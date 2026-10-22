import "server-only";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** Best-effort client key for anonymous rate limiting. Only trustworthy behind a proxy that sets this header (e.g. Vercel). */
export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Country hint from the hosting platform. Absent locally => null => only worldwide ('WW') rights match. */
export function clientCountry(req: Request): string | null {
  return req.headers.get("x-vercel-ip-country");
}

export async function readJson(req: Request, maxBytes = 8 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("body too large");
  return JSON.parse(text);
}
