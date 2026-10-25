import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";

/** Single-instance in-memory limiters (documented limitation: not shared across serverless instances). */
const g = globalThis as unknown as { __emergFormLimiters?: ReturnType<typeof build> };
function build() {
  return {
    auth: createRateLimiter({ limit: 10, windowMs: 60_000 }),
    report: createRateLimiter({ limit: 5, windowMs: 10 * 60_000 }),
    studio: createRateLimiter({ limit: 120, windowMs: 60_000 }),
    library: createRateLimiter({ limit: 90, windowMs: 60_000 }),
  };
}
export const formLimits = (g.__emergFormLimiters ??= build());
