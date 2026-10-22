import { Readable } from "node:stream";
import { getServerEnv } from "@/lib/env";
import { clientKey, json, NO_STORE } from "@/lib/http";
import { parseRange } from "@/lib/media/range";
import { verifyToken } from "@/lib/media/tokens";
import { getStorage, limiters } from "@/lib/services/media";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav" };

/** Streams an authorized rendition. The browser only ever sees this app URL, never a storage URL or key. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!limiters.stream.check(`stream:${clientKey(req)}`)) return json({ error: "rate_limited" }, 429);
  const { token } = await ctx.params;
  const env = getServerEnv();
  const v = verifyToken(token, env.MEDIA_SIGNING_SECRET, "play", Math.floor(Date.now() / 1000));
  if (!v.ok) return json({ error: "unavailable" }, 404);

  const storage = getStorage();
  // Only the "renditions" bucket is ever streamed; originals are unreachable from this route by construction.
  const stat = await storage.stat("renditions", v.claims.key).catch(() => null);
  if (!stat) return json({ error: "unavailable" }, 404);

  const ext = v.claims.key.split(".").pop() ?? "";
  const headers: Record<string, string> = {
    ...NO_STORE,
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };

  const range = parseRange(req.headers.get("range"), stat.size);
  if (range.kind === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });

  const part = range.kind === "range" ? { start: range.start, end: range.end } : undefined;
  let source;
  try {
    source = await storage.read("renditions", v.claims.key, part);
  } catch {
    return json({ error: "unavailable" }, 404);
  }
  const stream = Readable.toWeb(source) as ReadableStream;
  if (part) {
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${part.start}-${part.end}/${stat.size}`, "Content-Length": String(part.end - part.start + 1) },
    });
  }
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
}
