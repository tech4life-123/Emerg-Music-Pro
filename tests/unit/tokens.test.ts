import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/media/tokens";

const SECRET = "x".repeat(40);
const now = 1_000_000;
const play = { typ: "play" as const, sub: "u1", tid: "a1", key: "k/1.m4a", exp: now + 300 };

describe("signed media tokens", () => {
  it("round-trips valid claims", () => {
    const r = verifyToken(signToken(play, SECRET), SECRET, "play", now);
    expect(r).toEqual({ ok: true, claims: play });
  });
  it("rejects expired tokens, exactly at the expiry second", () => {
    const t = signToken(play, SECRET);
    expect(verifyToken(t, SECRET, "play", now + 299).ok).toBe(true);
    expect(verifyToken(t, SECRET, "play", now + 300)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects a token signed with another secret", () => {
    expect(verifyToken(signToken(play, "y".repeat(40)), SECRET, "play", now)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects tampered claims (extending expiry or swapping the key)", () => {
    const [body, sig] = signToken(play, SECRET).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...play, exp: now + 99999, key: "other/secret.m4a" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, SECRET, "play", now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyToken(`${body}.${sig}`, SECRET, "play", now).ok).toBe(true);
  });
  it("rejects a token of the wrong type (upload token cannot be used to play)", () => {
    const up = signToken({ typ: "upload", sub: "u", track: "t", key: "k", max: 1, ct: "audio/wav", exp: now + 60 }, SECRET);
    expect(verifyToken(up, SECRET, "play", now)).toEqual({ ok: false, reason: "wrong_type" });
  });
  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "a.", ".b", "x".repeat(5000)]) {
      expect(verifyToken(bad, SECRET, "play", now).ok).toBe(false);
    }
  });
  it("refuses to sign with a short secret", () => {
    expect(() => signToken(play, "short")).toThrow(/too short/);
  });
});
