/**
 * The SSRF address policy (SPEC §3 Decision 4): ONE implementation with two
 * settings — `public-only` (web API pins this; CLI `--strict-net`) and
 * `allow-private` (CLI default: a developer must be able to point snapgauge
 * at localhost:3000). Under public-only every DNS answer is classified and
 * the RESOLVED IP is pinned for connect (defeats rebinding); refusals carry
 * the reason CLASS only, never the resolved IP (SPEC §6).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { SnapgaugeError } from "../core/errors.js";

export type AddressPolicy = "public-only" | "allow-private";

export type BlockReason =
  | "unspecified"
  | "loopback"
  | "private"
  | "link-local"
  | "cgnat"
  | "ula"
  | "metadata"
  | "multicast"
  | "broadcast"
  | "reserved";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultLookup: LookupFn = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

/** Classify one IP literal; undefined = publicly routable. */
export function classifyAddress(address: string): BlockReason | undefined {
  const v4 = parseIpv4(address);
  if (v4 !== undefined) return classifyIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6 !== undefined) return classifyIpv6(v6);
  // Unparseable "address" strings never reach connect; treat as reserved.
  return "reserved";
}

function classifyIpv4(octets: readonly [number, number, number, number]): BlockReason | undefined {
  const [a, b, c, d] = octets;
  // The cloud metadata endpoint gets its own reason class (SPEC §4): it is
  // the highest-value SSRF target and deserves an unambiguous refusal.
  if (a === 169 && b === 254 && c === 169 && d === 254) return "metadata";
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  if (a === 192 && b === 0 && c === 0) return "reserved"; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return "reserved"; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking
  if (a === 198 && b === 51 && c === 100) return "reserved"; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return "reserved"; // TEST-NET-3
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return a === 255 && b === 255 && c === 255 && d === 255 ? "broadcast" : "reserved";
  return undefined;
}

function classifyIpv6(groups: readonly number[]): BlockReason | undefined {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = groups;
  const isZeroThrough = (through: number): boolean =>
    groups.slice(0, through + 1).every((g) => g === 0);
  // :: (unspecified) and ::1 (loopback)
  if (groups.every((g) => g === 0)) return "unspecified";
  if (isZeroThrough(6) && groups[7] === 1) return "loopback";
  // ::ffff:a.b.c.d — IPv4-mapped: classify the embedded IPv4 (SPEC §4).
  if (isZeroThrough(4) && g5 === 0xffff) {
    return classifyEmbeddedIpv4(groups) ?? "reserved"; // mapped forms are refused even when the embedded v4 is public — undici would dial v4 anyway, and mapped literals exist mainly to dodge filters
  }
  // 64:ff9b::/96 — NAT64: classify the embedded IPv4.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    const embedded = classifyEmbeddedIpv4(groups);
    if (embedded !== undefined) return embedded;
    return undefined;
  }
  if ((g0 & 0xfe00) === 0xfc00) return "ula"; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return "reserved"; // fec0::/10 (deprecated site-local)
  if ((g0 & 0xff00) === 0xff00) return "multicast"; // ff00::/8
  if (g0 === 0x2001 && g1 === 0xdb8) return "reserved"; // documentation
  return undefined;
}

function classifyEmbeddedIpv4(groups: readonly number[]): BlockReason | undefined {
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;
  return classifyIpv4([(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff]);
}

function parseIpv4(text: string): [number, number, number, number] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (match === null) return undefined;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return undefined;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/** Parse an IPv6 literal into its 8 16-bit groups (embedded IPv4 folded in). */
function parseIpv6(text: string): number[] | undefined {
  let input = text;
  // URL hostnames may keep brackets and a zone id.
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  const zone = input.indexOf("%");
  if (zone !== -1) input = input.slice(0, zone);
  if (!input.includes(":")) return undefined;

  // Fold a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two groups.
  const lastColon = input.lastIndexOf(":");
  const tail = input.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === undefined) return undefined;
    const [a, b, c, d] = v4;
    input = `${input.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const parts = input.split("::");
  if (parts.length > 2) return undefined;
  const head = parts[0] === "" || parts[0] === undefined ? [] : parts[0].split(":");
  const tailGroups = parts.length === 2 ? (parts[1] === "" ? [] : (parts[1] ?? "").split(":")) : [];
  const missing = 8 - head.length - tailGroups.length;
  if (parts.length === 2 && missing < 1) return undefined;
  if (parts.length === 1 && head.length !== 8) return undefined;
  const groupsText =
    parts.length === 2 ? [...head, ...Array<string>(missing).fill("0"), ...tailGroups] : head;
  const groups: number[] = [];
  for (const groupText of groupsText) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groupText)) return undefined;
    groups.push(Number.parseInt(groupText, 16));
  }
  return groups;
}

export interface AuthorizedTarget {
  url: URL;
  /** Set under public-only: the IP every connect MUST dial (rebinding defense). */
  pinnedAddress?: ResolvedAddress;
}

/**
 * Validate a target URL under the address policy. Under `public-only` the
 * host is resolved ONCE, every answer is classified, and the first answer is
 * pinned for connect. Refusals name the reason class only.
 */
export async function authorizeTarget(
  rawUrl: string,
  policy: AddressPolicy,
  lookup: LookupFn = defaultLookup,
): Promise<AuthorizedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SnapgaugeError("USAGE", `invalid target url: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SnapgaugeError("USAGE", `target url must be http(s): ${rawUrl}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new SnapgaugeError("TARGET_NOT_ALLOWED", "target url must not carry userinfo");
  }
  if (policy === "allow-private") return { url };

  const hostname = url.hostname;
  const literal = classifyLiteral(hostname);
  if (literal !== undefined) {
    if (literal.reason !== undefined) {
      throw refusal(literal.reason);
    }
    return { url, pinnedAddress: literal.resolved };
  }

  let answers: ResolvedAddress[];
  try {
    answers = await lookup(hostname);
  } catch (cause) {
    throw new SnapgaugeError("PROBE_FAILURE", `DNS resolution failed for the target host`, {
      cause,
    });
  }
  if (answers.length === 0) {
    throw new SnapgaugeError("PROBE_FAILURE", "DNS resolution returned no addresses");
  }
  for (const answer of answers) {
    const reason = classifyAddress(answer.address);
    if (reason !== undefined) throw refusal(reason);
  }
  const pinned = answers[0];
  if (pinned === undefined) {
    throw new SnapgaugeError("INTERNAL", "unreachable: non-empty answers");
  }
  return { url, pinnedAddress: pinned };
}

function classifyLiteral(
  hostname: string,
): { reason: BlockReason | undefined; resolved: ResolvedAddress } | undefined {
  const v4 = parseIpv4(hostname);
  if (v4 !== undefined) {
    return { reason: classifyIpv4(v4), resolved: { address: hostname, family: 4 } };
  }
  if (hostname.startsWith("[") || hostname.includes(":")) {
    const v6 = parseIpv6(hostname);
    const reason = v6 === undefined ? ("reserved" as const) : classifyIpv6(v6);
    return {
      reason,
      resolved: { address: hostname.replace(/^\[|\]$/g, ""), family: 6 },
    };
  }
  return undefined;
}

function refusal(reason: BlockReason): SnapgaugeError {
  // Reason class only — never the resolved IP (SPEC §6).
  return new SnapgaugeError(
    "TARGET_NOT_ALLOWED",
    `target refused by address policy (public-only): ${reason} address`,
  );
}
