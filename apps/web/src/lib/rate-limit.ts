/**
 * The `/api/check` rate counter (SPEC §6 cost safety, D2): behind an
 * interface so the app builds and runs with NO database — James has not
 * provisioned Neon for this project yet — degrading to an in-memory
 * per-instance limiter, and prints a one-time note saying so. A documented
 * Neon-backed implementation activates the moment `DATABASE_URL` is set,
 * with no code change.
 *
 * Caps (SPEC §6): 50 checks/IP/day, 2,000/day global. The WAF rule (5
 * req/60s/IP on `/api/check`) and the concurrency semaphore (src/lib/
 * semaphore.ts) are the other two legs of feasibility item 3 — this module
 * is the third: the app-level counter that survives past a single burst.
 */
import type * as NeonServerless from "@neondatabase/serverless";
import { ServiceUnavailableError } from "./errors.js";

export const DAILY_LIMIT_PER_IP = 50;
export const DAILY_LIMIT_GLOBAL = 2000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

export interface RateLimiter {
  consume(ipHash: string): Promise<RateLimitResult>;
}

function today(): string {
  const iso = new Date().toISOString();
  return iso.slice(0, 10);
}

/**
 * In-memory implementation — the default. Per SERVERLESS INSTANCE, not
 * global: a best-effort backstop, not the durable counter. Neon (below) is
 * what makes the cap real across instances/cold starts; this is what keeps
 * the app honest about degrading rather than failing when Neon is absent.
 */
export function createMemoryRateLimiter(): RateLimiter {
  const perIp = new Map<string, { count: number; day: string }>();
  let global: { count: number; day: string } = { count: 0, day: today() };
  return {
    consume(ipHash) {
      const day = today();
      if (global.day !== day) global = { count: 0, day };
      const existing = perIp.get(ipHash);
      const bucket = existing?.day === day ? existing : { count: 0, day };
      if (bucket.count >= DAILY_LIMIT_PER_IP || global.count >= DAILY_LIMIT_GLOBAL) {
        return Promise.resolve({ allowed: false, remaining: 0, limit: DAILY_LIMIT_PER_IP });
      }
      bucket.count += 1;
      global.count += 1;
      perIp.set(ipHash, bucket);
      return Promise.resolve({
        allowed: true,
        remaining: Math.max(0, DAILY_LIMIT_PER_IP - bucket.count),
        limit: DAILY_LIMIT_PER_IP,
      });
    },
  };
}

interface RateBucketRow {
  count: number | string;
}

/**
 * Neon-backed implementation — activates once `DATABASE_URL` is set.
 * Two tables only, per SPEC §6: `check_run` (not written by this module —
 * see src/lib/live-check.ts's caller) and `rate_bucket(ip_hash, day, count)`
 * with a composite primary key `(ip_hash, day)`. Raw parameterized SQL via
 * `@neondatabase/serverless` (HTTP driver — no TCP pool to manage on a
 * serverless function); imported dynamically so a build/run with no
 * DATABASE_URL never even loads the driver.
 *
 * Schema (documented here; not migrated automatically — Neon isn't
 * provisioned yet, so there is nothing to run a migration against):
 *
 *   CREATE TABLE rate_bucket (
 *     ip_hash text NOT NULL,
 *     day date NOT NULL,
 *     count integer NOT NULL DEFAULT 0,
 *     PRIMARY KEY (ip_hash, day)
 *   );
 */
export function createNeonRateLimiter(databaseUrl: string): RateLimiter {
  return {
    async consume(ipHash) {
      let neonModule: typeof NeonServerless;
      try {
        neonModule = await import("@neondatabase/serverless");
      } catch (cause) {
        throw new ServiceUnavailableError("rate limiter driver failed to load", { cause });
      }
      const sql = neonModule.neon(databaseUrl);
      const day = today();
      try {
        const upserted = (await sql`
          INSERT INTO rate_bucket (ip_hash, day, count)
          VALUES (${ipHash}, ${day}, 1)
          ON CONFLICT (ip_hash, day)
          DO UPDATE SET count = rate_bucket.count + 1
          RETURNING count
        `) as RateBucketRow[];
        const perIpCount = Number(upserted[0]?.count ?? 0);
        const totals = (await sql`
          SELECT COALESCE(SUM(count), 0) AS count FROM rate_bucket WHERE day = ${day}
        `) as RateBucketRow[];
        const globalCount = Number(totals[0]?.count ?? 0);
        const allowed = perIpCount <= DAILY_LIMIT_PER_IP && globalCount <= DAILY_LIMIT_GLOBAL;
        return {
          allowed,
          remaining: Math.max(0, DAILY_LIMIT_PER_IP - perIpCount),
          limit: DAILY_LIMIT_PER_IP,
        };
      } catch (cause) {
        if (cause instanceof ServiceUnavailableError) throw cause;
        // SPEC §6: "Neon suspended / quota -> /api/check returns 503 ...".
        throw new ServiceUnavailableError("rate limiter database unreachable", { cause });
      }
    },
  };
}

const memorySingleton = createMemoryRateLimiter();
let printedFallbackNote = false;

export function getRateLimiter(): { limiter: RateLimiter; backend: "memory" | "neon" } {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    if (!printedFallbackNote) {
      printedFallbackNote = true;
      console.log(
        "snapgauge: DATABASE_URL is not set — /api/check is rate-limited by the in-memory (per-instance) limiter, not Neon.",
      );
    }
    return { limiter: memorySingleton, backend: "memory" };
  }
  return { limiter: createNeonRateLimiter(databaseUrl), backend: "neon" };
}
