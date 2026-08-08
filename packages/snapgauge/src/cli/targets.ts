/**
 * CLI target resolution: config entry -> profile-aware transport factory +
 * probe spec + snapshot target identity. The address policy default is
 * `allow-private` (a developer must be able to point snapgauge at
 * localhost:3000); `--strict-net` selects `public-only` (SPEC §3 D4).
 */
import { SnapgaugeError } from "../core/errors.js";
import { getProfile, profileNames, type Profile } from "../core/profile.js";
import type { ProbeDecl, ProbeSpec } from "../core/snapshot/canonical.js";
import type { SnapshotTarget } from "../core/snapshot/schema.js";
import type {
  FixtureRawHandler,
  FixtureServer,
  Transport,
  TransportKind,
} from "../core/transport.js";
import { createFixtureTransport } from "../core/transport.js";
import { authorizeTarget, type AuthorizedTarget } from "../node/address-policy.js";
import { interpolateHeaders, type SnapgaugeConfig, type TargetConfig } from "../node/config.js";
import { createHttpTransport } from "../node/http-transport.js";
import { createStdioTransport } from "../node/stdio-transport.js";

/** Target names become file stems — keep them path-safe. */
export const TARGET_NAME_RE = /^[A-Za-z0-9._@-]+$/;

export function assertTargetName(name: string): void {
  if (!TARGET_NAME_RE.test(name)) {
    throw new SnapgaugeError(
      "USAGE",
      `invalid target name "${name}" (allowed: letters, digits, . _ @ -)`,
    );
  }
}

export function pickTarget(
  config: SnapgaugeConfig,
  requested: string | undefined,
): { name: string; target: TargetConfig } {
  const names = Object.keys(config.targets);
  if (requested !== undefined) {
    const target = Object.hasOwn(config.targets, requested)
      ? config.targets[requested]
      : undefined;
    if (target === undefined) {
      throw new SnapgaugeError(
        "USAGE",
        `unknown target "${requested}" (configured: ${names.join(", ") || "none"})`,
      );
    }
    return { name: requested, target };
  }
  const [sole] = names;
  if (names.length === 1 && sole !== undefined) {
    const target = config.targets[sole];
    if (target !== undefined) return { name: sole, target };
  }
  throw new SnapgaugeError(
    "USAGE",
    `no target named — pass one of: ${names.join(", ") || "none configured"}`,
  );
}

export interface ResolvedProfiles {
  /** The primary profile — recording probes run under it. */
  primary: Profile;
  profiles: Profile[];
}

export function resolveProfiles(names: readonly string[] | undefined): ResolvedProfiles {
  const requested = names === undefined || names.length === 0 ? ["modern-full"] : [...names];
  const profiles = requested.map((name) => {
    const profile = getProfile(name);
    if (profile === undefined) {
      throw new SnapgaugeError(
        "USAGE",
        `unknown profile "${name}" (built-ins: ${profileNames().join(", ")} — SPEC §5)`,
      );
    }
    return profile;
  });
  const primary = profiles.find((p) => p.name === "modern-full") ?? profiles[0];
  if (primary === undefined) throw new SnapgaugeError("INTERNAL", "unreachable: empty profiles");
  return { primary, profiles };
}

export function normalizeProbes(
  probes: readonly {
    id: string;
    tool: string;
    arguments?: Record<string, unknown> | undefined;
    capture?: "shape" | "values" | undefined;
  }[] = [],
): ProbeDecl[] {
  return probes.map((probe) => ({
    id: probe.id,
    tool: probe.tool,
    arguments: probe.arguments ?? {},
    capture: probe.capture ?? "shape",
  }));
}

export interface BuildTargetOptions {
  strictNet?: boolean | undefined;
  timeoutMs?: number | undefined;
  /** Override the config's profile list (compat --profiles). */
  profileNames?: readonly string[] | undefined;
  env: Record<string, string | undefined>;
}

/**
 * Everything check/record/compat need from a config target: identity, probe
 * spec, and a per-profile transport factory (the compat engine opens one
 * transport per profile and closes what it opens).
 */
export interface TargetFactory {
  kind: TransportKind;
  snapshotTarget: SnapshotTarget;
  probeSpec: ProbeSpec;
  primary: Profile;
  profiles: Profile[];
  volatile: readonly string[];
  warnings: string[];
  forProfile(profile: Profile): Promise<Transport> | Transport;
  forProtocolVersion(version: string): Promise<Transport> | Transport;
}

export async function buildTargetFactory(
  target: TargetConfig,
  options: BuildTargetOptions,
): Promise<TargetFactory> {
  const { primary, profiles } = resolveProfiles(options.profileNames ?? target.profiles);
  const probeSpec: ProbeSpec = {
    probes: normalizeProbes(target.probes),
    profiles: profiles.map((p) => p.name),
  };
  const timeoutMs = options.timeoutMs ?? target.timeoutMs ?? 10_000;
  const volatile = target.volatile ?? [];
  const protocolVersion = target.protocolVersion ?? primary.protocolVersion;

  switch (target.transport) {
    case "http": {
      const { headers, warnings } = interpolateHeaders(target.headers, options.env);
      const policy = options.strictNet === true ? "public-only" : "allow-private";
      // Authorize + resolve ONCE; every profile transport dials the same
      // pinned address (SPEC §3 D4 — rebinding defense).
      const authorized: AuthorizedTarget = await authorizeTarget(target.url, policy);
      const hasAuth = Object.keys(headers).some((h) => h.toLowerCase() === "authorization");
      const httpTransport = (version: string, sendHeader: boolean): Transport =>
        createHttpTransport({
          url: authorized.url,
          headers,
          protocolVersion: version,
          sendProtocolVersionHeader: sendHeader,
          ...(authorized.pinnedAddress !== undefined
            ? { pinnedAddress: authorized.pinnedAddress }
            : {}),
          timeoutMs,
        });
      return {
        kind: "http",
        snapshotTarget: {
          transport: "http",
          host: authorized.url.host,
          path: authorized.url.pathname,
          protocolVersion,
          auth: hasAuth ? "bearer(redacted)" : "none",
        },
        probeSpec,
        primary,
        profiles,
        volatile,
        warnings,
        forProfile: (profile) =>
          httpTransport(
            target.protocolVersion ?? profile.protocolVersion,
            profile.sendProtocolVersionHeader !== false,
          ),
        forProtocolVersion: (version) => httpTransport(version, true),
      };
    }
    case "stdio": {
      const stdioTransport = (): Transport =>
        createStdioTransport({ command: target.command, args: target.args ?? [], timeoutMs });
      return {
        kind: "stdio",
        snapshotTarget: {
          transport: "stdio",
          host: target.command,
          path: (target.args ?? []).join(" "),
          protocolVersion,
          auth: "none",
        },
        probeSpec,
        primary,
        profiles,
        volatile,
        warnings: [],
        forProfile: () => stdioTransport(),
        forProtocolVersion: () => stdioTransport(),
      };
    }
    case "fixture": {
      const entry = await resolveFixtureEntry(
        target.fixturesModule ?? "@snapgauge/fixtures",
        target.fixture,
      );
      // A fixture target with no configured probes inherits the fixture's
      // own declared probes (SPEC §7: the fixture knows its surface).
      const fixtureProbeSpec: ProbeSpec =
        target.probes === undefined
          ? { probes: entry.probes, profiles: probeSpec.profiles }
          : probeSpec;
      return {
        kind: "fixture",
        snapshotTarget: {
          transport: "fixture",
          host: target.fixture,
          path: "",
          protocolVersion,
          auth: "none",
        },
        probeSpec: fixtureProbeSpec,
        primary,
        profiles,
        volatile,
        warnings: [],
        forProfile: (profile) => createFixtureTransport(entry.server, profile, entry.raw),
        forProtocolVersion: (version) =>
          createFixtureTransport(entry.server, { ...primary, protocolVersion: version }, entry.raw),
      };
    }
  }
}

export interface ResolvedFixtureEntry {
  server: FixtureServer;
  probes: ProbeDecl[];
  raw?: FixtureRawHandler | undefined;
}

interface FixturesModuleShape {
  getFixtureEntry?(name: string): ResolvedFixtureEntry | undefined;
  getFixture?(name: string): FixtureServer | undefined;
}

function isFixturesModule(value: unknown): value is FixturesModuleShape {
  return (
    typeof value === "object" &&
    value !== null &&
    (("getFixtureEntry" in value && typeof value.getFixtureEntry === "function") ||
      ("getFixture" in value && typeof value.getFixture === "function"))
  );
}

export async function resolveFixtureEntry(
  specifier: string,
  name: string,
): Promise<ResolvedFixtureEntry> {
  let module_: unknown;
  try {
    module_ = (await import(specifier)) as unknown;
  } catch (cause) {
    throw new SnapgaugeError(
      "USAGE",
      `cannot load fixtures module "${specifier}" — in-repo this is @snapgauge/fixtures (private, SPEC §3)`,
      { cause },
    );
  }
  if (!isFixturesModule(module_)) {
    throw new SnapgaugeError(
      "USAGE",
      `fixtures module "${specifier}" does not export getFixtureEntry(name) or getFixture(name)`,
    );
  }
  if (module_.getFixtureEntry !== undefined) {
    const entry = module_.getFixtureEntry(name);
    if (entry === undefined) {
      throw new SnapgaugeError("USAGE", `unknown fixture "${name}" in module "${specifier}"`);
    }
    return entry;
  }
  const server = module_.getFixture?.(name);
  if (server === undefined) {
    throw new SnapgaugeError("USAGE", `unknown fixture "${name}" in module "${specifier}"`);
  }
  return { server, probes: [] };
}
