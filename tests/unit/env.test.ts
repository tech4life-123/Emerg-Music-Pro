import { describe, expect, it } from "vitest";
import { isSupabaseConfigured, parseServerEnv } from "@/lib/env";

const good = { MEDIA_SIGNING_SECRET: "k".repeat(32) };

describe("server env", () => {
  it("applies safe defaults", () => {
    const e = parseServerEnv(good);
    expect(e).toMatchObject({ STORAGE_DRIVER: "local", UPLOAD_TOKEN_TTL_SECONDS: 600, PLAYBACK_TOKEN_TTL_SECONDS: 300 });
    expect(isSupabaseConfigured(e)).toBe(false);
  });
  it("requires a strong signing secret and never echoes its value in errors", () => {
    expect(() => parseServerEnv({})).toThrow(/MEDIA_SIGNING_SECRET/);
    try {
      parseServerEnv({ MEDIA_SIGNING_SECRET: "tooshort-secret-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("tooshort-secret-value");
    }
  });
  it("requires every R2 variable when the r2 driver is selected", () => {
    expect(() => parseServerEnv({ ...good, STORAGE_DRIVER: "r2" })).toThrow(/R2_ACCOUNT_ID/);
  });
  it("bounds token lifetimes", () => {
    expect(() => parseServerEnv({ ...good, PLAYBACK_TOKEN_TTL_SECONDS: "86400" })).toThrow(/PLAYBACK_TOKEN_TTL_SECONDS/);
  });
});
