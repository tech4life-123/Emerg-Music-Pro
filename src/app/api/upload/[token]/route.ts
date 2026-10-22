import { Readable } from "node:stream";
import { getViewer } from "@/lib/auth/viewer";
import { getServerEnv } from "@/lib/env";
import { json } from "@/lib/http";
import { verifyToken } from "@/lib/media/tokens";
import { StorageError } from "@/lib/media/storage";
import { canUploadToTrack, getStorage } from "@/lib/services/media";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Receives the bytes for ONE previously authorized upload. The token fixes the user, track, object key,
 * content type and maximum size; none of those are taken from the request.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const env = getServerEnv();
  const claims = verifyToken(token, env.MEDIA_SIGNING_SECRET, "upload", Math.floor(Date.now() / 1000));
  if (!claims.ok) return json({ error: "invalid_token" }, 403);
  const c = claims.claims;

  const viewer = await getViewer();
  if (viewer.status !== "signed_in" || viewer.userId !== c.sub) return json({ error: "forbidden" }, 403);
  // Re-check at write time: the release may have left draft since authorization.
  const artistId = await canUploadToTrack(c.sub, c.track);
  if (!artistId || !c.key.startsWith(`audio/${artistId}/${c.track}/`)) return json({ error: "forbidden" }, 403);

  if ((req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() !== c.ct) return json({ error: "invalid_type" }, 415);
  const declared = Number(req.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return json({ error: "length_required" }, 411);
  if (declared > c.max) return json({ error: "too_large" }, 413);
  if (!req.body) return json({ error: "invalid_request" }, 400);

  const storage = getStorage();
  let stored;
  try {
    // Quarantine: the original goes to the private "originals" bucket and is never served to listeners.
    stored = await storage.put("originals", c.key, Readable.fromWeb(req.body as never) as AsyncIterable<Uint8Array>, { maxBytes: c.max, contentType: c.ct });
  } catch (e) {
    if (e instanceof StorageError && e.code === "too_large") return json({ error: "too_large" }, 413);
    return json({ error: "upload_failed" }, 500);
  }

  const admin = createAdminClient();
  if (!admin) {
    await storage.remove("originals", c.key);
    return json({ error: "not_configured" }, 503);
  }
  // Register the object on the track (service role: clients have no UPDATE right on audio_path, by design).
  // The tracks_audio_path_own_folder constraint and guard_track_audio_lock trigger re-check path and draft state.
  // Read the previous paths FIRST: the tracks_reset_processing trigger clears the rendition paths when audio_path changes.
  const { data: before } = await admin.from("tracks").select("audio_path, audio_low_path, audio_std_path").eq("id", c.track).maybeSingle();
  const { error } = await admin.from("tracks").update({ audio_path: c.key, processing_status: "pending" }).eq("id", c.track);
  if (error) {
    await storage.remove("originals", c.key); // never leave an unregistered object behind
    return json({ error: "upload_failed" }, 500);
  }
  // Queue validation + transcoding. The original stays private and unplayable until a worker marks the track ready.
  const { data: queued, error: queueError } = await admin.rpc("enqueue_processing_job", { p_track: c.track });
  if (queueError) return json({ error: "queue_failed" }, 500);

  // Replaced audio: delete the previous original and its renditions (they are unreachable now).
  const stale = [before?.audio_low_path, before?.audio_std_path].filter((k): k is string => Boolean(k));
  await Promise.all([
    ...stale.map((k) => storage.remove("renditions", k).catch(() => undefined)),
    before?.audio_path && before.audio_path !== c.key ? storage.remove("originals", before.audio_path).catch(() => undefined) : undefined,
  ]);
  const jobId = Array.isArray(queued) ? queued[0]?.job_id : undefined;
  return json({ trackId: c.track, status: "queued", jobId, sha256: stored.sha256, size: stored.size }, 201);
}
