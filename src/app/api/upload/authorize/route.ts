import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { json, readJson } from "@/lib/http";
import { authorizeUpload, uploadAuthorizationDeps } from "@/lib/services/media";

export const runtime = "nodejs";

const body = z.object({ trackId: z.string(), contentType: z.string().max(100), sizeBytes: z.number() }).strict();
const STATUS = { rate_limited: 429, forbidden: 403, invalid_type: 415, invalid_size: 400, too_large: 413 } as const;

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return json({ error: "not_configured" }, 503);
  if (viewer.status !== "signed_in") return json({ error: "unauthenticated" }, 401);

  let parsed;
  try {
    parsed = body.safeParse(await readJson(req));
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const result = await authorizeUpload({ userId: viewer.userId, ...parsed.data }, uploadAuthorizationDeps());
  if (!result.ok) return json({ error: result.code }, STATUS[result.code]);
  return json({
    uploadUrl: `/api/upload/${result.token}`,
    expiresAt: result.expiresAt,
    maxBytes: result.maxBytes,
    contentType: result.contentType,
  });
}
