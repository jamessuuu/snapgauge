/**
 * The web `/api/check` URL policy (SPEC §4): https only, port 443/80, no
 * userinfo, no IP-literal hosts — layered ON TOP of `authorizeTarget`
 * ("snapgauge/node", SPEC §3 Decision 4's `public-only` address policy),
 * which handles the part that requires a DNS answer: rejecting RFC1918 /
 * loopback / link-local / CGNAT / IPv6 ULA & mapped / 169.254.169.254 after
 * resolution, and pinning the resolved IP for connect (rebinding defense).
 *
 * "No IP-literal hosts" is stricter than what `authorizeTarget` alone
 * enforces: a PUBLIC IP literal (e.g. `https://93.184.216.34/mcp`) passes
 * `authorizeTarget`'s classification (nothing routes it away), but the web
 * policy still refuses it outright — an IP literal skips the one signal a
 * hostname gives an operator (the ability to rotate DNS away from an
 * address later, or for us to refuse a name that resolves somewhere new on
 * a rebinding attempt targeting the SAME literal).
 */
import { SnapgaugeError } from "snapgauge";
import { authorizeTarget, type AuthorizedTarget, type LookupFn } from "snapgauge/node";

const ALLOWED_PORTS: ReadonlySet<string> = new Set(["", "443", "80"]);

/** True for both IPv4 and bracketed/bare IPv6 literal hostnames. Real DNS
 * hostnames never contain a colon or resolve as four dotted octets. */
function isIpLiteralHost(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return true;
  return bare.includes(":");
}

/**
 * `lookup` is exposed ONLY so the SSRF block-matrix unit tests can inject a
 * deterministic DNS answer instead of hitting the network — production
 * never passes it, so `authorizeTarget` falls back to its own real
 * `node:dns/promises` resolver.
 */
export async function authorizeWebTarget(rawUrl: string, lookup?: LookupFn): Promise<AuthorizedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "only https:// URLs are allowed");
  }
  if (url.username !== "" || url.password !== "") {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "the URL must not carry userinfo");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "only port 443 (default) or 80 is allowed");
  }
  if (isIpLiteralHost(url.hostname)) {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "IP-literal hosts are not allowed — use a DNS name");
  }
  // public-only: resolves the hostname, classifies every answer, and pins
  // the first one for connect (SPEC §3 Decision 4 / §4).
  return lookup !== undefined
    ? authorizeTarget(url.href, "public-only", lookup)
    : authorizeTarget(url.href, "public-only");
}
