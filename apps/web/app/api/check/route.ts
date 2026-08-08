/**
 * POST /api/check (SPEC §4): the hosted live check. No auth (read-only,
 * never accepts a bearer token — SPEC §1). Node runtime — the SSRF policy
 * needs `node:dns` (via "snapgauge/node"), and undici for the pinned
 * connection.
 *
 * The Vercel WAF rate rule (5 req/60s/IP, "the one Hobby rule" — SPEC §6) is
 * bound to this route at DEPLOY time in the Vercel dashboard, not in code;
 * this build does not deploy (see the task's hard rules), so it is
 * documented here and in SECURITY.md rather than configured.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { SnapgaugeError } from "snapgauge";
import { clientIpFrom, hashIp } from "@/lib/ip-hash";
import { RateLimitedError, ServiceUnavailableError, httpStatusForCode, type WebErrorCode } from "@/lib/errors";
import { runLiveCheck } from "@/lib/live-check";
import { getRateLimiter } from "@/lib/rate-limit";
import { withConcurrencyLimit } from "@/lib/semaphore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.strictObject({ url: z.string().min(1).max(2048) });

function errorResponse(code: WebErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: httpStatusForCode(code) },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse("USAGE", "request body must be JSON: { \"url\": string }");
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse("USAGE", "request body must be exactly { \"url\": string }");
  }

  const ipHash = await hashIp(clientIpFrom(request.headers));
  const { limiter } = getRateLimiter();
  let rate;
  try {
    rate = await limiter.consume(ipHash);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      // SPEC §6: "Neon suspended/quota -> /api/check returns 503 ... /demo
      // unaffected" — /demo and /board never touch this code path.
      return errorResponse("SERVICE_UNAVAILABLE", "live checks are paused right now — try /demo instead (offline, always works)");
    }
    throw error;
  }
  if (!rate.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "daily check limit reached for this IP or globally — try again tomorrow, or use /demo (offline, unlimited)",
    );
  }

  try {
    const result = await withConcurrencyLimit(() => runLiveCheck(parsed.data.url));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SnapgaugeError) {
      return errorResponse(error.code, error.message);
    }
    if (error instanceof RateLimitedError) {
      return errorResponse("RATE_LIMITED", error.message);
    }
    // No stack traces, no upstream error strings echoed (SPEC §9.5).
    return errorResponse("INTERNAL", "internal error");
  }
}
