/**
 * Fixed-window in-memory rate limiter.
 *
 * LIMITATION (be aware): state lives in one process. On serverless hosting each instance has its own
 * counters, so this is a best-effort brake, not a hard guarantee. Before public launch replace it
 * with a shared store (see docs/COST_AND_DEPLOYMENT.md). The interface is deliberately tiny so the
 * swap is a one-file change.
 */
export interface RateLimiter {
  /** Returns true if the action is allowed, false if the caller is over the limit. */
  check(key: string): boolean;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const t = now();
      if (buckets.size > 10_000) {
        for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
      }
      const b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      if (b.count >= opts.limit) return false;
      b.count += 1;
      return true;
    },
  };
}
