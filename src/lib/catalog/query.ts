/** Pure helpers for the catalog: input validation, safe search patterns, formatting. No I/O. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
export const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 100 && SLUG.test(s);

export const MAX_QUERY_LENGTH = 60;
export const MIN_QUERY_LENGTH = 2;

/** Trim, collapse whitespace, strip control characters, cap length. Returns null when too short to search. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

/** Escape LIKE wildcards so user input is matched literally ("100%" must not match everything). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
export const likePattern = (q: string): string => `%${escapeLike(q)}%`;

export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "–:––";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatReleaseType(t: string): string {
  return t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Deterministic placeholder artwork colours from an id. Real artwork arrives with the upload phase. */
export function placeholderHues(id: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = 235 + ((h >>> 0) % 110); // indigo..magenta
  const b = a + 25 + (((h >>> 8) >>> 0) % 35);
  return [a, b];
}
