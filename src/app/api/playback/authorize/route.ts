import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { clientCountry, clientKey, json, readJson } from "@/lib/http";
import { authorizePlayback, playbackAuthorizationDeps } from "@/lib/services/media";

export const runtime = "nodejs";

const body = z.object({ trackId: z.string(), lowBandwidth: z.boolean().optional() }).strict();

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = body.safeParse(await readJson(req));
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const viewer = await getViewer();
  const result = await authorizePlayback(
    {
      trackId: parsed.data.trackId,
      lowBandwidth: parsed.data.lowBandwidth,
      userId: viewer.status === "signed_in" ? viewer.userId : null,
      country: clientCountry(req),
      clientKey: clientKey(req),
    },
    playbackAuthorizationDeps(),
  );
  if (!result.ok) return json({ error: result.code }, result.code === "rate_limited" ? 429 : 404);
  return json({ streamUrl: `/api/media/${result.token}`, expiresAt: result.expiresAt, variant: result.variant });
}
