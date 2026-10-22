import { describe, expect, it } from "vitest";
import { dbMessage, safeNext, text } from "../../src/lib/forms";

describe("safeNext (post-login redirect)", () => {
  it("allows same-site relative paths", () => {
    expect(safeNext("/studio")).toBe("/studio");
    expect(safeNext("/studio/releases/abc?x=1")).toBe("/studio/releases/abc?x=1");
  });
  it("rejects open-redirect shapes and non-strings", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "evil", "", "/a\0b", "/" + "a".repeat(400), null, undefined, 42]) {
      expect(safeNext(bad, "/fallback"), String(bad)).toBe("/fallback");
    }
  });
});

describe("dbMessage", () => {
  it("shows only messages the database raised on purpose", () => {
    expect(dbMessage({ code: "P0001", message: "Add at least one track before submitting" })).toBe("Add at least one track before submitting");
  });
  it("hides policy, permission and internal details", () => {
    expect(dbMessage({ code: "42501", message: 'new row violates row-level security policy for table "releases"' })).toBe("You are not allowed to do that.");
    expect(dbMessage({ code: "42501", message: "permission denied for table tracks" })).toBe("You are not allowed to do that.");
    const internal = dbMessage({ code: "XX000", message: 'relation "secret_table" at /var/lib/postgres' });
    expect(internal).not.toMatch(/secret_table|postgres/);
  });
  it("explains duplicate pending applications", () => {
    expect(dbMessage({ code: "23505", message: 'duplicate key value violates unique constraint "artist_applications_one_pending_per_user"' })).toMatch(/already have an application/);
  });
  it("handles a missing error", () => { expect(dbMessage(null)).toMatch(/Nothing was changed/); });
});

describe("text()", () => {
  it("trims, caps length and ignores non-strings", () => {
    const f = new FormData();
    f.set("a", "  hello  "); f.set("b", "x".repeat(50)); f.set("c", new Blob(["x"]), "f.txt");
    expect(text(f, "a")).toBe("hello");
    expect(text(f, "b", 10)).toHaveLength(10);
    expect(text(f, "c")).toBe("");
    expect(text(f, "missing")).toBe("");
  });
});
