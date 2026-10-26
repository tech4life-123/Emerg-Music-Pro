import { describe, expect, it } from "vitest";
import { AVATAR_PATH_RE, avatarSrc } from "@/lib/avatar";

const uid = "0b7e2a2c-9a41-4a0d-8f51-6c0d3e2f1a11";
const file = "5f1c0f7e-0d8a-4c66-9b0e-2f3a9d7c1b22";

describe("avatar paths", () => {
  it("accepts avatars/<uuid>/<uuid>.webp", () => expect(AVATAR_PATH_RE.test(`avatars/${uid}/${file}.webp`)).toBe(true));
  it("rejects traversal, other extensions, other buckets and URLs", () => {
    for (const bad of [`avatars/${uid}/../x.webp`, `avatars/${uid}/${file}.svg`, `media/${uid}/${file}.webp`, `https://x.test/a.webp`, `avatars/${uid}/${file}.webp/extra`, `avatars/nope/${file}.webp`])
      expect(AVATAR_PATH_RE.test(bad), bad).toBe(false);
  });
  it("builds a public URL only for valid paths", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://p.supabase.co";
    expect(avatarSrc(`avatars/${uid}/${file}.webp`)).toBe(`https://p.supabase.co/storage/v1/object/public/avatars/${uid}/${file}.webp`);
    expect(avatarSrc("javascript:alert(1)")).toBeNull();
    expect(avatarSrc(null)).toBeNull();
  });
});
