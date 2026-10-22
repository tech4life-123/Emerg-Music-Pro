import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit, blocks the next, and resets after the window", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([rl.check("a"), rl.check("a"), rl.check("a")]).toEqual([true, true, false]);
    expect(rl.check("b")).toBe(true); // independent keys
    t = 1000;
    expect(rl.check("a")).toBe(true);
  });
});
