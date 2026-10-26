import { describe, expect, it } from "vitest";
import { evaluateAccess, type Viewer } from "@/lib/auth/viewer";

const signedIn = (roles: ("listener" | "artist" | "admin")[]): Viewer => ({ status: "signed_in", userId: "u1", roles, emailVerified: true });

describe("evaluateAccess (server-side page gate)", () => {
  it("allows a viewer holding any permitted role", () => {
    expect(evaluateAccess(signedIn(["artist"]), ["artist", "admin"]).ok).toBe(true);
    expect(evaluateAccess(signedIn(["admin"]), ["admin"]).ok).toBe(true);
  });
  it("denies a signed-in viewer without the role", () => {
    expect(evaluateAccess(signedIn(["listener"]), ["admin"])).toEqual({ ok: false, reason: "forbidden" });
    expect(evaluateAccess(signedIn([]), ["artist"])).toEqual({ ok: false, reason: "forbidden" });
  });
  it("denies anonymous viewers", () => {
    expect(evaluateAccess({ status: "anonymous" }, ["artist"])).toEqual({ ok: false, reason: "anonymous" });
  });
  it("fails closed when the backend is not configured", () => {
    expect(evaluateAccess({ status: "unconfigured" }, ["artist"])).toEqual({ ok: false, reason: "unconfigured" });
  });
});
