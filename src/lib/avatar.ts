/** Profile photos live in the public "avatars" bucket; profiles.avatar_url holds "avatars/<user_id>/<file>.webp". */
export const AVATAR_PATH_RE = /^avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\.webp$/;
export const AVATAR_SIZE = 512;
export const AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024; // what we accept before cropping; the stored file is far smaller

export function avatarSrc(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return path && base && AVATAR_PATH_RE.test(path) ? `${base}/storage/v1/object/public/${path}` : null;
}
