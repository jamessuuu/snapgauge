/**
 * IP addresses are hashed before they ever reach a counter or a log line
 * (SPEC §6: Neon holds `ip_hash`, never a raw IP or a raw target URL).
 */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

/** First entry of `X-Forwarded-For` — the client the edge saw. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : "unknown";
}
