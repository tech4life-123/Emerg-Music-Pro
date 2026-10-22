import { createHmac, timingSafeEqual } from "node:crypto";

/** Short-lived, HMAC-signed capability tokens. The browser never sees bucket names, keys' storage
 * location, or any storage credential: it only holds an opaque, expiring token. */
export interface UploadClaims {
  typ: "upload";
  sub: string; // user id
  track: string; // track id
  key: string; // server-generated object key (audio/<artist_id>/<track_id>/original-<uuid>.<ext>)
  max: number; // max bytes
  ct: string; // required content type
  exp: number; // unix seconds
}
export interface PlaybackClaims {
  typ: "play";
  sub: string | null; // user id, null for anonymous listeners
  tid: string; // track id
  key: string; // object key of a low/std rendition (never the original)
  exp: number;
}
type AnyClaims = UploadClaims | PlaybackClaims;
type ClaimsOf<T extends AnyClaims["typ"]> = Extract<AnyClaims, { typ: T }>;

export type VerifyFailure = "malformed" | "bad_signature" | "wrong_type" | "expired";
export type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: VerifyFailure };

const MAX_TOKEN_LENGTH = 2048;
const MIN_SECRET_LENGTH = 32;

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signToken(claims: AnyClaims, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("signing secret is too short");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

export function verifyToken<T extends AnyClaims["typ"]>(
  token: string,
  secret: string,
  expected: T,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult<ClaimsOf<T>> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts as [string, string];

  const given = Buffer.from(sig, "base64url");
  const wanted = mac(body, secret);
  // Verify the signature BEFORE parsing/trusting any claim.
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: "bad_signature" };
  }
  let claims: AnyClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AnyClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims !== "object" || typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
  if (claims.typ !== expected) return { ok: false, reason: "wrong_type" };
  if (nowSeconds >= claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims: claims as ClaimsOf<T> };
}
