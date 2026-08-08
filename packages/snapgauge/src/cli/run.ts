/**
 * The CLI (SPEC §4), exported as `snapgauge/bin` for programmatic use.
 * `runCli` never calls process.exit — the bin shim (src/cli/index.ts) is the
 * only place that does; tests/evals drive this function with a captured io
 * and an injected context (cwd/env), per the SPEC §3 boundary.
 *
 * Commands: `record` (config targets over http/stdio/fixture, plus the
 * in-repo `--fixture` shortcut the evals use), `check` (probe live -> diff
 * vs stored -> gate -> exit code; never writes a snapshot without
 * `--update`), `diff` (offline), `init`, `report`, and the `ci` alias.
 */
import { Command, CommanderError } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCompat, type CompatResult } from "../core/compat/engine.js";
import {
  DiffOutputSchema,
  diffSnapshots,
  gateFailed,
  parseTier,
  TIERS,
  type DiffOutput,
  type Finding,
  type Tier,
} from "../core/diff/diff.js";
import {
  EXIT,
  exitCodeForError,
  SnapgaugeError,
  type ExitCode,
} from "../core/errors.js";
import type { JsonObject } from "../core/json.js";
import { record, type RecordOutcome } from "../core/probe.js";
import {
  CheckOutputSchema,
  parseReportFormat,
  render,
  summarize,
  type CheckOutput,
  type CompatSection,
  type ReportFormat,
} from "../core/report/report.js";
import { createFixtureTransport } from "../core/transport.js";
import { SNAPGAUGE_VERSION } from "../core/version.js";
import { loadConfig, type SnapgaugeConfig, type TargetConfig } from "../node/config.js";
import { readSnapshotFile, writeSnapshotFileAtomic } from "../node/snapshot-io.js";
import {
  assertTargetName,
  buildTargetFactory,
  pickTarget,
  resolveFixtureEntry,
  resolveProfiles,
  type TargetFactory,
} from "./targets.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliContext {
  cwd: string;
  env: Record<string, string | undefined>;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

interface RecordCommandOptions {
  fixture?: string;
  fixturesModule: string;
  dir?: string;
  profile: string;
  config?: string;
  strictNet?: boolean;
  timeout?: string;
  recordedAt?: string;
}

interface DiffCommandOptions {
  failOn: string;
  json?: boolean;
  migrate?: boolean;
}

interface CheckCommandOptions {
  config?: string;
  failOn?: string;
  only?: string;
  ignore?: string;
  timeout?: string;
  strictNet?: boolean;
  reporter: string;
  json?: boolean;
  update?: boolean;
  recordedAt?: string;
  summary?: boolean;
  migrate?: boolean;
}

interface InitCommandOptions {
  url?: string;
  command?: string;
  args?: string;
  fixture?: string;
  target: string;
  force?: boolean;
}

interface ReportCommandOptions {
  format: string;
}

interface CompatCommandOptions {
  config?: string;
  fixture?: string;
  fixturesModule: string;
  profiles?: string;
  timeout?: string;
  strictNet?: boolean;
  reporter: string;
  json?: boolean;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  context?: Partial<CliContext>,
): Promise<ExitCode> {
  const ctx: CliContext = {
    cwd: context?.cwd ?? process.cwd(),
    env: context?.env ?? process.env,
  };
  if (argv.length === 0) {
    io.stderr("usage: snapgauge <init|record|check|diff|report|ci> ... (run snapgauge --help)");
    return EXIT.USAGE;
  }

  let code: ExitCode = EXIT.CLEAN;
  const program = new Command("snapgauge");
  program
    .description("Contract tests for MCP servers — record a snapshot, fail CI when it moves.")
    .version(SNAPGAUGE_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => { io.stdout(text.replace(/\n$/, "")); },
      writeErr: (text) => { io.stderr(text.replace(/\n$/, "")); },
    });

  program
    .command("record")
    .description(
      "probe a target from snapgauge.config.json and write <snapshotDir>/<target>.snapshot.json (or use the in-repo --fixture shortcut)",
    )
    .argument("[target]", "target name (config key) — becomes the snapshot file stem")
    .option("--config <path>", "config file (snapgauge.config.json|.mjs|.ts)")
    .option("--fixture <name>", "fixture shortcut: record this fixture without a config")
    .option(
      "--fixtures-module <specifier>",
      "module exporting getFixtureEntry(name)",
      "@snapgauge/fixtures",
    )
    .option("--dir <dir>", "snapshot directory (fixture shortcut only)")
    .option("--profile <name>", "client profile (SPEC §5)", "modern-full")
    .option("--timeout <ms>", "per-request timeout override")
    .option("--strict-net", "address policy public-only (SPEC §3 Decision 4)")
    .option("--recorded-at <iso8601>", "pin recordedAt (reproducible snapshots)")
    .action(async (target: string | undefined, options: RecordCommandOptions) => {
      code = await recordCommand(target, options, io, ctx);
    });

  program
    .command("check")
    .description(
      "probe live -> diff vs stored snapshot -> gate -> exit code; never writes a snapshot (--update rewrites)",
    )
    .argument("[target]", "target name (config key)")
    .option("--config <path>", "config file (snapgauge.config.json|.mjs|.ts)")
    .option("--fail-on <tier>", `gate tier (${TIERS.join("|")}); default risky or the target's failOn`)
    .option("--only <tiers>", "comma list of tiers to keep (filtered before gating)")
    .option("--ignore <ruleIds>", "comma list of rule ids to drop (merged with the target's ignore)")
    .option("--timeout <ms>", "per-request timeout override")
    .option("--strict-net", "address policy public-only (SPEC §3 Decision 4)")
    .option("--reporter <format>", "text|json|github|md", "text")
    .option("--json", "shorthand for --reporter json")
    .option("--update", "rewrite the stored snapshot from the live probe")
    .option("--recorded-at <iso8601>", "pin recordedAt (reproducible snapshots)")
    .option("--migrate", "upgrade an older-formatVersion stored snapshot in place (SPEC §2 Decision 3)")
    .action(async (target: string | undefined, options: CheckCommandOptions) => {
      code = await checkCommand(target, options, io, ctx);
    });

  program
    .command("ci")
    .description("alias for check --reporter=github --fail-on=risky --summary (SPEC §4); --fail-on overrides the default")
    .argument("[target]", "target name (config key)")
    .option("--config <path>", "config file")
    .option("--fail-on <tier>", `gate tier (${TIERS.join("|")}); default risky`)
    .option("--timeout <ms>", "per-request timeout override")
    .option("--strict-net", "address policy public-only")
    .action(async (target: string | undefined, options: CheckCommandOptions) => {
      code = await checkCommand(
        target,
        { ...options, reporter: "github", failOn: options.failOn ?? "risky", summary: true },
        io,
        ctx,
      );
    });

  program
    .command("compat")
    .description(
      "profile matrix + degradation assertions only (SPEC §4): T/X/D groups under the built-in client profiles; exit 3 on violations",
    )
    .argument("[target]", "target name (config key)")
    .option("--config <path>", "config file")
    .option("--fixture <name>", "fixture shortcut: run compat against this fixture without a config")
    .option(
      "--fixtures-module <specifier>",
      "module exporting getFixtureEntry(name)",
      "@snapgauge/fixtures",
    )
    .option("--profiles <names>", "comma list of client profiles (default: target profiles, else all built-ins)")
    .option("--timeout <ms>", "per-request timeout override")
    .option("--strict-net", "address policy public-only (SPEC §3 Decision 4)")
    .option("--reporter <format>", "text|json|github|md", "text")
    .option("--json", "shorthand for --reporter json")
    .action(async (target: string | undefined, options: CompatCommandOptions) => {
      code = await compatCommand(target, options, io, ctx);
    });

  program
    .command("diff")
    .description("offline diff of two snapshot files — no network (SPEC §4)")
    .argument("<a>", "old snapshot file")
    .argument("<b>", "new snapshot file")
    .option("--fail-on <tier>", `gate tier (${TIERS.join("|")})`, "risky")
    .option("--json", "print the diff result as JSON")
    .option("--migrate", "upgrade older-formatVersion snapshot files in place (SPEC §2 Decision 3)")
    .action((a: string, b: string, options: DiffCommandOptions) => {
      code = diffCommand(a, b, options, io);
    });

  program
    .command("init")
    .description("write snapgauge.config.json, probe the target, seed probes from tools/list (SPEC §4)")
    .option("--url <url>", "http target url")
    .option("--command <command>", "stdio target command")
    .option("--args <args>", "stdio target arguments (space-separated)")
    .option("--fixture <name>", "fixture target name (in-repo)")
    .option("--target <name>", "target name in the config", "server")
    .option("--force", "overwrite an existing config file")
    .action(async (options: InitCommandOptions) => {
      code = await initCommand(options, io, ctx);
    });

  program
    .command("report")
    .description("pure reformat of a saved result (SPEC §4): snapgauge report result.json --format md")
    .argument("<file>", "a saved check/diff result (json)")
    .option("--format <format>", "text|json|github|md", "text")
    .action((file: string, options: ReportCommandOptions) => {
      code = reportCommand(file, options, io, ctx);
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT.CLEAN : EXIT.USAGE;
    }
    return reportError(error, io);
  }
  return code;
}

// ---------------------------------------------------------------------------
// record

async function recordCommand(
  target: string | undefined,
  options: RecordCommandOptions,
  io: CliIo,
  ctx: CliContext,
): Promise<ExitCode> {
  try {
    const recordedAt = resolveRecordedAt(options.recordedAt);
    if (options.fixture !== undefined) {
      return await recordFixtureShortcut(target, options, recordedAt, io, ctx);
    }
    const loaded = await loadConfig(ctx.cwd, options.config);
    const { name, target: targetConfig } = pickTarget(loaded.config, target);
    assertTargetName(name);
    const factory = await buildTargetFactory(targetConfig, {
      strictNet: options.strictNet,
      timeoutMs: parseTimeout(options.timeout),
      env: ctx.env,
    });
    for (const warning of factory.warnings) io.stderr(`warning: ${warning}`);
    const transport = await factory.forProfile(factory.primary);
    try {
      const outcome = await record({
        transport,
        target: factory.snapshotTarget,
        probeSpec: factory.probeSpec,
        recordedAt,
        clientCapabilities: factory.primary.clientCapabilities,
        volatile: factory.volatile,
      });
      if (outcome.probeFailures.length > 0) {
        return failProbes(outcome, io, "no snapshot written");
      }
      const file = join(loaded.snapshotDir, `${name}.snapshot.json`);
      writeSnapshotFileAtomic(file, outcome.snapshot);
      io.stdout(`recorded ${name} -> ${file} (${String(outcome.snapshot.tools.length)} tools)`);
      return EXIT.CLEAN;
    } finally {
      await transport.close?.();
    }
  } catch (error) {
    return reportError(error, io);
  }
}

async function recordFixtureShortcut(
  target: string | undefined,
  options: RecordCommandOptions,
  recordedAt: string,
  io: CliIo,
  ctx: CliContext,
): Promise<ExitCode> {
  if (target === undefined) {
    throw new SnapgaugeError("USAGE", "record --fixture requires an explicit target name");
  }
  assertTargetName(target);
  if (options.fixture === undefined) throw new SnapgaugeError("INTERNAL", "unreachable");
  const { primary } = resolveProfiles([options.profile]);
  const entry = await resolveFixtureEntry(options.fixturesModule, options.fixture);
  const outcome = await record({
    transport: createFixtureTransport(entry.server, primary, entry.raw),
    target: {
      transport: "fixture",
      host: options.fixture,
      path: "",
      protocolVersion: primary.protocolVersion,
      auth: "none",
    },
    probeSpec: { probes: entry.probes, profiles: [primary.name] },
    recordedAt,
    clientCapabilities: primary.clientCapabilities,
  });
  if (outcome.probeFailures.length > 0) {
    return failProbes(outcome, io, "no snapshot written");
  }
  const dir = resolve(ctx.cwd, options.dir ?? ".snapgauge");
  const file = join(dir, `${target}.snapshot.json`);
  writeSnapshotFileAtomic(file, outcome.snapshot);
  io.stdout(`recorded ${target} -> ${file} (${String(outcome.snapshot.tools.length)} tools)`);
  return EXIT.CLEAN;
}

function failProbes(outcome: RecordOutcome, io: CliIo, tail: string): ExitCode {
  for (const failure of outcome.probeFailures) {
    io.stderr(`probe "${failure.probeId}" failed: ${failure.message}`);
  }
  io.stderr(
    `missing evidence is never "no change" (SPEC §6) — ${tail} (exit 2)`,
  );
  return EXIT.PROBE;
}

// ---------------------------------------------------------------------------
// check

async function checkCommand(
  target: string | undefined,
  options: CheckCommandOptions,
  io: CliIo,
  ctx: CliContext,
): Promise<ExitCode> {
  try {
    const recordedAt = resolveRecordedAt(options.recordedAt);
    const format = resolveReporter(options);
    const loaded = await loadConfig(ctx.cwd, options.config);
    const { name, target: targetConfig } = pickTarget(loaded.config, target);
    assertTargetName(name);
    const storedFile = join(loaded.snapshotDir, `${name}.snapshot.json`);
    if (!existsSync(storedFile)) {
      throw new SnapgaugeError(
        "USAGE",
        `no stored snapshot at ${storedFile} — run \`snapgauge record ${name}\` first (check never writes one, SPEC §4)`,
      );
    }
    const stored = readSnapshotFile(storedFile, { migrate: options.migrate === true });
    const factory = await buildTargetFactory(targetConfig, {
      strictNet: options.strictNet,
      timeoutMs: parseTimeout(options.timeout),
      env: ctx.env,
    });
    for (const warning of factory.warnings) io.stderr(`warning: ${warning}`);
    const transport = await factory.forProfile(factory.primary);
    let outcome: RecordOutcome;
    try {
      outcome = await record({
        transport,
        target: factory.snapshotTarget,
        probeSpec: factory.probeSpec,
        recordedAt,
        clientCapabilities: factory.primary.clientCapabilities,
        volatile: factory.volatile,
      });
    } finally {
      await transport.close?.();
    }
    // The compat matrix (SPEC §4: probe live -> diff vs stored -> compat
    // matrix -> gate). The engine opens one transport per profile and
    // closes what it opens.
    const compat = await runCompat({
      transportForProfile: (profile) => factory.forProfile(profile),
      transportForProtocolVersion: (version) => factory.forProtocolVersion(version),
      profiles: factory.profiles,
      probes: factory.probeSpec.probes,
      kind: factory.kind,
    });
    const failOn = parseTier(options.failOn ?? targetConfig.failOn ?? "risky");
    const ignore = new Set([
      ...(targetConfig.ignore ?? []),
      ...splitList(options.ignore),
    ]);
    const only = splitList(options.only).map(parseTier);
    const diffResult = diffSnapshots(stored, outcome.snapshot);
    const findings = filterFindings(diffResult.findings, ignore, only);
    const failed = gateFailed({ findings, summary: summarize(findings) }, failOn);
    const incomplete = outcome.probeFailures.length > 0;
    // Exit precedence (SPEC §5/§6): missing evidence (2) beats a compat
    // violation (3) beats drift (1). 1 vs 3 is deliberate - different
    // owner, different fix. Compat findings below violation class are
    // LISTED here; `snapgauge compat` gates them.
    const violation = compat.findings.some((f) => f.class === "violation");
    const exitCode: ExitCode = incomplete
      ? EXIT.PROBE
      : violation
        ? EXIT.COMPAT
        : failed
          ? EXIT.DRIFT
          : EXIT.CLEAN;
    const updated = options.update === true && !incomplete;
    if (updated) writeSnapshotFileAtomic(storedFile, outcome.snapshot);
    const output: CheckOutput = {
      command: "check",
      target: { name, transport: factory.kind },
      findings,
      summary: summarize(findings),
      gate: { failOn, failed },
      assertions: compat.assertions,
      compat: compatSection(compat),
      ...(incomplete ? { incomplete: true } : {}),
      ...(updated ? { updated: true } : {}),
      exitCode,
    };
    for (const failure of outcome.probeFailures) {
      io.stderr(`probe "${failure.probeId}" failed: ${failure.message}`);
    }
    for (const line of render(output, format)) io.stdout(line);
    return exitCode;
  } catch (error) {
    return reportError(error, io);
  }
}

function compatSection(result: CompatResult): CompatSection {
  return {
    era: result.era,
    profiles: result.profiles,
    findings: result.findings,
    verdicts: result.verdicts,
  };
}

// ---------------------------------------------------------------------------
// compat

async function compatCommand(
  target: string | undefined,
  options: CompatCommandOptions,
  io: CliIo,
  ctx: CliContext,
): Promise<ExitCode> {
  try {
    const format = options.json === true ? ("json" as const) : parseReportFormat(options.reporter);
    let factory: TargetFactory;
    let name: string;
    if (options.fixture !== undefined) {
      name = options.fixture;
      const entry = await resolveFixtureEntry(options.fixturesModule, options.fixture);
      const { primary, profiles } = resolveProfiles(
        options.profiles !== undefined ? splitList(options.profiles) : undefined,
      );
      factory = {
        kind: "fixture",
        snapshotTarget: {
          transport: "fixture",
          host: options.fixture,
          path: "",
          protocolVersion: primary.protocolVersion,
          auth: "none",
        },
        probeSpec: { probes: entry.probes, profiles: profiles.map((p) => p.name) },
        primary,
        profiles,
        volatile: [],
        warnings: [],
        forProfile: (profile) => createFixtureTransport(entry.server, profile, entry.raw),
        forProtocolVersion: (version) =>
          createFixtureTransport(entry.server, { ...primary, protocolVersion: version }, entry.raw),
      };
    } else {
      const loaded = await loadConfig(ctx.cwd, options.config);
      const picked = pickTarget(loaded.config, target);
      name = picked.name;
      assertTargetName(name);
      factory = await buildTargetFactory(picked.target, {
        strictNet: options.strictNet,
        timeoutMs: parseTimeout(options.timeout),
        env: ctx.env,
        ...(options.profiles !== undefined ? { profileNames: splitList(options.profiles) } : {}),
      });
      for (const warning of factory.warnings) io.stderr(`warning: ${warning}`);
    }
    const result = await runCompat({
      transportForProfile: (profile) => factory.forProfile(profile),
      transportForProtocolVersion: (version) => factory.forProtocolVersion(version),
      profiles: factory.profiles,
      probes: factory.probeSpec.probes,
      kind: factory.kind,
    });
    // Exit contract (SPEC §5): violation -> 3 (the server is WRONG, not
    // merely different); risky-class findings -> 1; else 0.
    const violation = result.findings.some((f) => f.class === "violation");
    const risky = result.findings.some((f) => f.class === "risky");
    const exitCode: ExitCode = violation ? EXIT.COMPAT : risky ? EXIT.DRIFT : EXIT.CLEAN;
    const output: CheckOutput = {
      command: "compat",
      target: { name, transport: factory.kind },
      findings: [],
      summary: { breaking: 0, risky: 0, compatible: 0, cosmetic: 0 },
      gate: { failOn: "risky", failed: exitCode !== EXIT.CLEAN },
      assertions: result.assertions,
      compat: compatSection(result),
      exitCode,
    };
    for (const line of render(output, format)) io.stdout(line);
    return exitCode;
  } catch (error) {
    return reportError(error, io);
  }
}

function resolveReporter(options: CheckCommandOptions): ReportFormat {
  if (options.json === true) return "json";
  return parseReportFormat(options.reporter);
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
}

function filterFindings(
  findings: readonly Finding[],
  ignore: ReadonlySet<string>,
  only: readonly Tier[],
): Finding[] {
  return findings.filter(
    (finding) =>
      !ignore.has(finding.ruleId) && (only.length === 0 || only.includes(finding.tier)),
  );
}

// ---------------------------------------------------------------------------
// diff

function diffCommand(a: string, b: string, options: DiffCommandOptions, io: CliIo): ExitCode {
  try {
    const failOn = parseTier(options.failOn);
    const migrate = options.migrate === true;
    const snapshotA = readSnapshotFile(a, { migrate });
    const snapshotB = readSnapshotFile(b, { migrate });
    const result = diffSnapshots(snapshotA, snapshotB);
    const failed = gateFailed(result, failOn);
    const output: DiffOutput = {
      findings: result.findings,
      summary: result.summary,
      gate: { failOn, failed },
    };
    if (options.json === true) {
      io.stdout(JSON.stringify(output, null, 2));
    } else {
      const upgraded: CheckOutput = {
        command: "diff",
        findings: output.findings,
        summary: output.summary,
        gate: output.gate,
        exitCode: failed ? EXIT.DRIFT : EXIT.CLEAN,
      };
      for (const line of render(upgraded, "text")) io.stdout(line);
    }
    return failed ? EXIT.DRIFT : EXIT.CLEAN;
  } catch (error) {
    return reportError(error, io);
  }
}

// ---------------------------------------------------------------------------
// init

async function initCommand(
  options: InitCommandOptions,
  io: CliIo,
  ctx: CliContext,
): Promise<ExitCode> {
  let transport: Awaited<ReturnType<TargetFactory["forProfile"]>> | undefined;
  try {
    assertTargetName(options.target);
    const configPath = resolve(ctx.cwd, "snapgauge.config.json");
    if (existsSync(configPath) && options.force !== true) {
      throw new SnapgaugeError(
        "USAGE",
        `${configPath} already exists — pass --force to overwrite`,
      );
    }
    const targetConfig = initTargetConfig(options);
    const factory = await buildTargetFactory(targetConfig, { env: ctx.env });
    transport = await factory.forProfile(factory.primary);
    // Probe first (SPEC §4: init probes the target and seeds probes from
    // tools/list); nothing is written when the target is unreachable.
    const outcome = await record({
      transport,
      target: factory.snapshotTarget,
      probeSpec: { probes: [], profiles: ["modern-full"] },
      recordedAt: new Date().toISOString(),
      clientCapabilities: factory.primary.clientCapabilities,
    });
    const probes = outcome.snapshot.tools.map((tool) => seedProbe(tool.name, tool.inputSchema));
    const config: SnapgaugeConfig = {
      snapshotDir: ".snapgauge",
      targets: { [options.target]: { ...targetConfig, probes } },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    io.stdout(`wrote ${configPath} (${String(probes.length)} probes seeded from tools/list)`);
    io.stdout(
      `next: review the seeded probe arguments, then run \`snapgauge record ${options.target}\``,
    );
    return EXIT.CLEAN;
  } catch (error) {
    return reportError(error, io);
  } finally {
    await transport?.close?.();
  }
}

function initTargetConfig(options: InitCommandOptions): TargetConfig {
  const chosen = [options.url, options.command, options.fixture].filter(
    (value) => value !== undefined,
  );
  if (chosen.length !== 1) {
    throw new SnapgaugeError(
      "USAGE",
      "init needs exactly one of --url, --command, --fixture",
    );
  }
  if (options.url !== undefined) {
    return { transport: "http", url: options.url };
  }
  if (options.command !== undefined) {
    const args = (options.args ?? "").split(" ").filter((a) => a !== "");
    return { transport: "stdio", command: options.command, ...(args.length > 0 ? { args } : {}) };
  }
  if (options.fixture !== undefined) {
    return { transport: "fixture", fixture: options.fixture };
  }
  throw new SnapgaugeError("INTERNAL", "unreachable");
}

function seedProbe(tool: string, inputSchema: JsonObject): {
  id: string;
  tool: string;
  arguments: JsonObject;
  capture: "shape";
} {
  const args: JsonObject = {};
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const properties =
    typeof inputSchema.properties === "object" &&
    inputSchema.properties !== null &&
    !Array.isArray(inputSchema.properties)
      ? inputSchema.properties
      : {};
  for (const name of required) {
    if (typeof name !== "string") continue;
    const schema = properties[name];
    args[name] = placeholderFor(schema);
  }
  return { id: tool, tool, arguments: args, capture: "shape" };
}

function placeholderFor(schema: unknown): JsonObject[string] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return "example";
  const record = schema as JsonObject;
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0] ?? "example";
  switch (record.type) {
    case "integer":
    case "number":
      return typeof record.minimum === "number" ? record.minimum : 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "example";
  }
}

// ---------------------------------------------------------------------------
// report

function reportCommand(
  file: string,
  options: ReportCommandOptions,
  io: CliIo,
  ctx: CliContext,
): ExitCode {
  try {
    const format = parseReportFormat(options.format);
    const path = resolve(ctx.cwd, file);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (cause) {
      throw new SnapgaugeError("USAGE", `cannot read result file: ${path}`, { cause });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new SnapgaugeError("USAGE", `${path} is not JSON`, { cause });
    }
    const asCheck = CheckOutputSchema.safeParse(parsed);
    let output: CheckOutput;
    if (asCheck.success) {
      output = asCheck.data;
    } else {
      const asDiff = DiffOutputSchema.safeParse(parsed);
      if (!asDiff.success) {
        throw new SnapgaugeError(
          "USAGE",
          `${path} is not a snapgauge result (neither check nor diff output)`,
        );
      }
      output = {
        command: "diff",
        findings: asDiff.data.findings,
        summary: asDiff.data.summary,
        gate: asDiff.data.gate,
        exitCode: asDiff.data.gate.failed ? EXIT.DRIFT : EXIT.CLEAN,
      };
    }
    for (const line of render(output, format)) io.stdout(line);
    // A reformat is a pure read — the RESULT's exit code is data, not ours.
    return EXIT.CLEAN;
  } catch (error) {
    return reportError(error, io);
  }
}

// ---------------------------------------------------------------------------
// shared

function resolveRecordedAt(flag: string | undefined): string {
  if (flag === undefined) return new Date().toISOString();
  if (!ISO_RE.test(flag)) {
    throw new SnapgaugeError("USAGE", `--recorded-at must be ISO 8601, got "${flag}"`);
  }
  return flag;
}

function parseTimeout(flag: string | undefined): number | undefined {
  if (flag === undefined) return undefined;
  const value = Number(flag);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SnapgaugeError("USAGE", `--timeout must be a positive integer (ms), got "${flag}"`);
  }
  return value;
}

function reportError(error: unknown, io: CliIo): ExitCode {
  if (error instanceof SnapgaugeError) {
    io.stderr(`error[${error.code}]: ${error.message}`);
    return exitCodeForError(error.code);
  }
  io.stderr(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT.INTERNAL;
}
