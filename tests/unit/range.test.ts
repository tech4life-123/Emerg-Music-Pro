import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/media/range";

describe("parseRange", () => {
  it("treats a missing header as the whole object", () => expect(parseRange(null, 100)).toEqual({ kind: "none" }));
  it("parses start-end, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ kind: "range", start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ kind: "range", start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ kind: "range", start: 90, end: 99 });
    expect(parseRange("bytes=50-5000", 100)).toEqual({ kind: "range", start: 50, end: 99 });
  });
  it("refuses unsatisfiable, reversed, multi-range and malformed ranges", () => {
    for (const h of ["bytes=100-", "bytes=5-2", "bytes=0-1,5-6", "bytes=-", "bytes=-0", "items=0-1", "bytes=a-b"]) {
      expect(parseRange(h, 100)).toEqual({ kind: "unsatisfiable" });
    }
    expect(parseRange("bytes=0-1", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
