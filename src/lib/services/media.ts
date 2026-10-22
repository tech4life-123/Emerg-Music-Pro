import "server-only";
import { getServerEnv } from "@/lib/env";
import { authorizePlayback, authorizeUpload, type PlaybackTarget } from "@/lib/media/authorization";
import { createStorage } from "@/lib/media/storage";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

// Single-instance in-memory limiters (documented limitation: not shared across serverless instances).
const g = globalThis as unknown as { __emergLimiters?: ReturnType<typeof build> };
function build() {
  return {
    upload: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    play: createRateLimiter({ limit: 120, windowMs: 60_000 }),
    stream: createRateLimiter({ limit: 600, windowMs: 60_000 }),
  };
}
export const limiters = (g.__emergLimiters ??= build());

export function getStorage() {
  const env = getServerEnv();
  return createStorage({ driver: env.STORAGE_DRIVER, localDir: env.LOCAL_STORAGE_DIR });
}

/**
 * Upload is allowed only to the owner of the track's artist, and only while the release is a draft (the DB trigger
 * guard_track_audio_lock enforces the same rule independently). Evaluated with the USER's session, so RLS applies.
 * Returns the artist id (needed for the object key) or null.
 */
export async function canUploadToTrack(userId: string, trackId: string): Promise<string | null> {
  const supabase = await createUserClient();
  if (!supabase) return null;
  const { data: track } = await supabase.from("tracks").select("artist_id, release:releases!inner(status)").eq("id", trackId).maybeSingle();
  const release = Array.isArray(track?.release) ? track?.release[0] : track?.release;
  if (!track || release?.status !== "draft") return null;
  const { data: artist } = await supabase.from("artists").select("id").eq("id", track.artist_id).eq("owner_id", userId).maybeSingle();
  return artist ? (artist.id as string) : null;
}

export function uploadAuthorizationDeps() {
  const env = getServerEnv();
  return {
    secret: env.MEDIA_SIGNING_SECRET,
    ttlSeconds: env.UPLOAD_TOKEN_TTL_SECONDS,
    maxBytes: env.MAX_UPLOAD_BYTES,
    now: () => Date.now(),
    rateLimiter: limiters.upload,
    canUploadToTrack,
  };
}

export function playbackAuthorizationDeps() {
  const env = getServerEnv();
  return {
    secret: env.MEDIA_SIGNING_SECRET,
    ttlSeconds: env.PLAYBACK_TOKEN_TTL_SECONDS,
    now: () => Date.now(),
    rateLimiter: limiters.play,
    lookup: async (trackId: string, country: string | null, low: boolean): Promise<PlaybackTarget | null> => {
      const admin = createAdminClient();
      if (!admin) return null;
      const { data, error } = await admin.rpc("get_playback_target", { p_track: trackId, p_country: country ?? "", p_low: low });
      if (error || !data || data.length === 0) return null;
      const r = data[0];
      return { variant: r.variant, key: r.storage_key };
    },
  };
}

export { authorizePlayback, authorizeUpload };
