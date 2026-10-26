/** Artist pictures live in the public "artists" bucket; artists.image_url / header_url hold "artists/<artist_id>/<kind>-<uuid>.webp". */
export const ARTIST_IMAGE_RE = /^artists\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(avatar|header)-[0-9a-f-]{36}\.webp$/;
export const ARTIST_IMAGE_SIZES = { avatar: { w: 512, h: 512 }, header: { w: 1500, h: 500 } } as const;
export type ArtistImageKind = keyof typeof ARTIST_IMAGE_SIZES;

export function artistImageSrc(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return path && base && ARTIST_IMAGE_RE.test(path) ? `${base}/storage/v1/object/public/${path}` : null;
}

/** Only http(s) links are ever stored or rendered (no javascript: or data: URLs). */
export function safeLinks(links: readonly string[] | null | undefined): string[] {
  return (links ?? []).filter((l) => { try { return /^https?:$/.test(new URL(l).protocol); } catch { return false; } });
}
