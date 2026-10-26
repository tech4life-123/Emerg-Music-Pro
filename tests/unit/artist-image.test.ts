import { describe, expect, it } from "vitest";
import { ARTIST_IMAGE_RE, artistImageSrc, safeLinks } from "@/lib/artist-image";

const id = "123e4567-e89b-42d3-a456-426614174000";
const file = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("artist image paths", () => {
  it("accepts only artists/<uuid>/(avatar|header)-<uuid>.webp", () => {
    expect(ARTIST_IMAGE_RE.test(`artists/${id}/avatar-${file}.webp`)).toBe(true);
    expect(ARTIST_IMAGE_RE.test(`artists/${id}/header-${file}.webp`)).toBe(true);
    for (const bad of [`artists/${id}/cover-${file}.webp`, `artists/${id}/avatar-${file}.png`, `avatars/${id}/avatar-${file}.webp`, `artists/../x/avatar-${file}.webp`, `artists/${id}/avatar-${file}.webp/../../x`, "https://evil.test/x.webp", ""])
      expect(ARTIST_IMAGE_RE.test(bad)).toBe(false);
  });
  it("builds a public URL only for valid paths", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(artistImageSrc(`artists/${id}/avatar-${file}.webp`)).toBe(`https://example.supabase.co/storage/v1/object/public/artists/${id}/avatar-${file}.webp`);
    expect(artistImageSrc("javascript:alert(1)")).toBeNull();
    expect(artistImageSrc(null)).toBeNull();
  });
  it("renders only http(s) links", () => {
    expect(safeLinks(["https://a.test/x", "http://b.test", "javascript:alert(1)", "data:text/html,x", "not a url"])).toEqual(["https://a.test/x", "http://b.test"]);
    expect(safeLinks(null)).toEqual([]);
  });
});
