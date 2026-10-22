import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RateLimiter } from "../rate-limit";
import { signToken } from "./tokens";

/** Accepted ORIGINAL upload formats -> file extension. Content is re-validated by ffprobe later. */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

const uuid = z.string().uuid();

export type UploadDenial = "rate_limited" | "forbidden" | "invalid_type" | "invalid_size" | "too_large";

export interface UploadAuthorizationDeps {
  secret: string;
  ttlSeconds: number;
  maxBytes: number;
  now: () => number; // ms
  rateLimiter: RateLimiter;
  /** Backed by the USER's own session (RLS applies). Returns the artist id when the user owns the track's artist AND the release is still a draft; otherwise null. */
  canUploadToTrack: (userId: string, trackId: string) => Promise<string | null>;
  newId?: () => string;
}

export type UploadAuthorization =
  | { ok: true; token: string; key: string; expiresAt: number; maxBytes: number; contentType: string }
  | { ok: false; code: UploadDenial };

/**
 * Scoped upload authorization: the token is bound to ONE user, ONE track, ONE server-generated object key,
 * ONE content type and a size ceiling, and expires quickly. The client never chooses the key.
 */
export async function authorizeUpload(
  input: { userId: string; trackId: string; contentType: string; sizeBytes: number },
  deps: UploadAuthorizationDeps,
): Promise<UploadAuthorization> {
  if (!deps.rateLimiter.check(`upload:${input.userId}`)) return { ok: false, code: "rate_limited" };
  if (!uuid.safeParse(input.trackId).success) return { ok: false, code: "forbidden" };

  const ext = ALLOWED_UPLOAD_TYPES[input.contentType.toLowerCase()];
  if (!ext) return { ok: false, code: "invalid_type" };
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, code: "invalid_size" };
  if (input.sizeBytes > deps.maxBytes) return { ok: false, code: "too_large" };

  // Same answer for "no such track" and "not yours": never reveal which tracks exist.
  const artistId = await deps.canUploadToTrack(input.userId, input.trackId);
  if (!artistId || !uuid.safeParse(artistId).success) return { ok: false, code: "forbidden" };

  // Must match the tracks_audio_path_own_folder constraint: audio/<artist_id>/<track_id>/...
  const key = `audio/${artistId}/${input.trackId}/original-${(deps.newId ?? randomUUID)()}.${ext}`;
  const exp = Math.floor(deps.now() / 1000) + deps.ttlSeconds;
  const token = signToken(
    { typ: "upload", sub: input.userId, track: input.trackId, key, max: Math.min(input.sizeBytes, deps.maxBytes), ct: input.contentType.toLowerCase(), exp },
    deps.secret,
  );
  return { ok: true, token, key, expiresAt: exp * 1000, maxBytes: Math.min(input.sizeBytes, deps.maxBytes), contentType: input.contentType.toLowerCase() };
}

export interface PlaybackTarget {
  variant: "low" | "std";
  key: string;
}

export interface PlaybackAuthorizationDeps {
  secret: string;
  ttlSeconds: number;
  now: () => number;
  rateLimiter: RateLimiter;
  /** Backed by the SERVICE-ROLE-only SQL function public.get_playback_target (all gates enforced in the DB). */
  lookup: (trackId: string, country: string | null, lowBandwidth: boolean) => Promise<PlaybackTarget | null>;
}

export type PlaybackAuthorization =
  | { ok: true; token: string; expiresAt: number; variant: "low" | "std" }
  | { ok: false; code: "rate_limited" | "unavailable" };

/**
 * Short-lived playback authorization. Every request re-checks publication, rights, territory and
 * takedown state, so a takedown blocks the NEXT authorization immediately (already issued tokens expire
 * within `ttlSeconds`, the documented residual window).
 */
export async function authorizePlayback(
  input: { trackId: string; userId: string | null; country: string | null; lowBandwidth?: boolean; clientKey: string },
  deps: PlaybackAuthorizationDeps,
): Promise<PlaybackAuthorization> {
  if (!deps.rateLimiter.check(`play:${input.userId ?? input.clientKey}`)) return { ok: false, code: "rate_limited" };
  if (!uuid.safeParse(input.trackId).success) return { ok: false, code: "unavailable" };

  const country = input.country && /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : null;

  const target = await deps.lookup(input.trackId, country, input.lowBandwidth === true);
  // One generic answer for missing / unpublished / unlicensed / withdrawn / out-of-territory.
  // Defence in depth: only a low/std rendition is ever streamable, never the original upload.
  if (!target || (target.variant !== "low" && target.variant !== "std")) return { ok: false, code: "unavailable" };

  const exp = Math.floor(deps.now() / 1000) + deps.ttlSeconds;
  const token = signToken({ typ: "play", sub: input.userId, tid: input.trackId, key: target.key, exp }, deps.secret);
  return { ok: true, token, expiresAt: exp * 1000, variant: target.variant };
}
