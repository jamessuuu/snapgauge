/**
 * Concurrency semaphore (SPEC §6 cost safety: "concurrency semaphore 3"),
 * per serverless instance — the third leg alongside the WAF rate cap (edge,
 * configured in the Vercel dashboard at deploy time — not code) and the
 * app-level daily counter (src/lib/rate-limit.ts).
 */
import { RateLimitedError } from "./errors.js";

const MAX_CONCURRENT_CHECKS = 3;
let active = 0;

export async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_CHECKS) {
    throw new RateLimitedError(
      `too many concurrent checks on this instance (max ${String(MAX_CONCURRENT_CHECKS)}) — try again in a few seconds, or use /demo (offline, unlimited)`,
    );
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
  }
}
