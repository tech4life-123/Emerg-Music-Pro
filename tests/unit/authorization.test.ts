import { describe, expect, it, vi } from "vitest";
import { authorizePlayback, authorizeUpload, type PlaybackTarget } from "@/lib/media/authorization";
import { verifyToken } from "@/lib/media/tokens";
import { createRateLimiter } from "@/lib/rate-limit";

const SECRET = "s".repeat(40);
const TRACK = "0b8f3a52-5d3c-4a8e-9f0a-1d2e3f4a5b6c";
const ARTIST = "5a1d3c7e-2b4f-4e6a-8c9d-0e1f2a3b4c5d";
const NOW = 1_700_000_000_000;
const open = () => createRateLimiter({ limit: 100, windowMs: 1000 });

const uploadDeps = (over: Partial<Parameters<typeof authorizeUpload>[1]> = {}) => ({
  secret: SECRET, ttlSeconds: 600, maxBytes: 1000, now: () => NOW, rateLimiter: open(),
  canUploadToTrack: async (): Promise<string | null> => ARTIST, newId: () => "fixed-id", ...over,
});

describe("authorizeUpload", () => {
  const input = { userId: "u1", trackId: TRACK, contentType: "audio/wav", sizeBytes: 500 };

  it("issues a token bound to user, track, a SERVER-generated key, type and size", async () => {
    const r = await authorizeUpload(input, uploadDeps());
    if (!r.ok) throw new Error("expected ok");
    expect(r.key).toBe(`audio/${ARTIST}/${TRACK}/original-fixed-id.wav`);
    const v = verifyToken(r.token, SECRET, "upload", NOW / 1000);
    expect(v.ok && v.claims).toMatchObject({ sub: "u1", track: TRACK, key: r.key, max: 500, ct: "audio/wav", exp: NOW / 1000 + 600 });
  });
  it("denies a non-owner without revealing whether the track exists", async () => {
    const r = await authorizeUpload(input, uploadDeps({ canUploadToTrack: async () => null }));
    expect(r).toEqual({ ok: false, code: "forbidden" });
    expect(await authorizeUpload({ ...input, trackId: "not-a-uuid" }, uploadDeps())).toEqual({ ok: false, code: "forbidden" });
  });
  it("denies disallowed types, bad sizes and oversize files BEFORE touching the database", async () => {
    const can = vi.fn(async (): Promise<string | null> => ARTIST);
    const d = uploadDeps({ canUploadToTrack: can });
    expect(await authorizeUpload({ ...input, contentType: "application/x-msdownload" }, d)).toEqual({ ok: false, code: "invalid_type" });
    expect(await authorizeUpload({ ...input, contentType: "video/mp4" }, d)).toEqual({ ok: false, code: "invalid_type" });
    expect(await authorizeUpload({ ...input, sizeBytes: 0 }, d)).toEqual({ ok: false, code: "invalid_size" });
    expect(await authorizeUpload({ ...input, sizeBytes: 1.5 }, d)).toEqual({ ok: false, code: "invalid_size" });
    expect(await authorizeUpload({ ...input, sizeBytes: 1001 }, d)).toEqual({ ok: false, code: "too_large" });
    expect(can).not.toHaveBeenCalled();
  });
  it("rate limits per user", async () => {
    const d = uploadDeps({ rateLimiter: createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 }) });
    expect((await authorizeUpload(input, d)).ok).toBe(true);
    expect(await authorizeUpload(input, d)).toEqual({ ok: false, code: "rate_limited" });
    expect((await authorizeUpload({ ...input, userId: "u2" }, d)).ok).toBe(true);
  });
});

describe("authorizePlayback", () => {
  const target: PlaybackTarget = { variant: "std", key: `audio/${ARTIST}/${TRACK}/std.m4a` };
  const deps = (over: Partial<Parameters<typeof authorizePlayback>[1]> = {}) => ({
    secret: SECRET, ttlSeconds: 300, now: () => NOW, rateLimiter: open(), lookup: async () => target, ...over,
  });
  const input = { trackId: TRACK, userId: null as string | null, country: "lr", clientKey: "ip-1" };

  it("issues a short-lived token that names the track and rendition key, never a bucket or storage URL", async () => {
    const r = await authorizePlayback(input, deps());
    if (!r.ok) throw new Error("expected ok");
    expect(r.expiresAt).toBe(NOW + 300_000);
    const v = verifyToken(r.token, SECRET, "play", NOW / 1000);
    expect(v.ok && v.claims).toEqual({ typ: "play", sub: null, tid: TRACK, key: target.key, exp: NOW / 1000 + 300 });
    expect(JSON.stringify(r)).not.toMatch(/https?:|supabase/);
  });
  it("normalises the country and passes the data-saver flag to the gate", async () => {
    const lookup = vi.fn(async () => target);
    await authorizePlayback({ ...input, country: "lr", lowBandwidth: true }, deps({ lookup }));
    expect(lookup).toHaveBeenCalledWith(TRACK, "LR", true);
    await authorizePlayback({ ...input, country: "Liberia" }, deps({ lookup }));
    expect(lookup).toHaveBeenLastCalledWith(TRACK, null, false);
  });
  it("gives ONE generic answer when the gate says no (unpublished, withdrawn, out of territory, missing)", async () => {
    expect(await authorizePlayback(input, deps({ lookup: async () => null }))).toEqual({ ok: false, code: "unavailable" });
    expect(await authorizePlayback({ ...input, trackId: "nope" }, deps())).toEqual({ ok: false, code: "unavailable" });
  });
  it("never authorizes anything but a low/std rendition (originals stay private)", async () => {
    const leak = await authorizePlayback(input, deps({ lookup: async () => ({ ...target, variant: "original" as never }) }));
    expect(leak).toEqual({ ok: false, code: "unavailable" });
  });
  it("a takedown blocks the NEXT authorization immediately", async () => {
    let live = true;
    const d = deps({ lookup: async () => (live ? target : null) });
    expect((await authorizePlayback(input, d)).ok).toBe(true);
    live = false;
    expect(await authorizePlayback(input, d)).toEqual({ ok: false, code: "unavailable" });
  });
  it("rate limits anonymous callers by client key", async () => {
    const d = deps({ rateLimiter: createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 }) });
    expect((await authorizePlayback(input, d)).ok).toBe(true);
    expect(await authorizePlayback(input, d)).toEqual({ ok: false, code: "rate_limited" });
  });
});
