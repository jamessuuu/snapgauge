/**
 * The CLI (SPEC §4), exported as `snapgauge/bin` for programmatic use.
 * `runCli` never touches process.exit / stdout directly — the bin shim
 * (src/cli/index.ts) is the only place with process.exit, and tests/evals
 * drive this function with a captured io.
 *
 * M1 surface: `record` (fixture transport only — http/stdio land at M2) and
 * `diff` (offline, two snapshot files, no network — also the web demo's
 * engine at M5).
 */
import { Command, CommanderError } from "commander";
import { join } from "node:path";
import {
  EXIT,
  exitCodeForError,
  SnapgaugeError,
  type ExitCode,
} from "../core/errors.js";
import {
  diffSnapshots,
  gateFailed,
  parseTier,
  TIERS,
  type DiffOutput,
} from "../core/diff/diff.js";
import { getProfile, profileNames } from "../core/profile.js";
import { record } from "../core/probe.js";
import { createFixtureTransport, type FixtureServer } from "../core/transport.js";
import { SNAPGAUGE_VERSION } from "../core/version.js";
import { readSnapshotFile, writeSnapshotFileAtomic } from "../node/snapshot-io.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

interface RecordCommandOptions {
  fixture: string;
  fixturesModule: string;
  dir: string;
  profile: string;
}

interface DiffCommandOptions {
  failOn: string;
  json?: boolean;
}

/** Target names become file stems — keep them path-safe. */
const TARGET_NAME_RE = /^[A-Za-z0-9._@-]+$/;

export async function runCli(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  if (argv.length === 0) {
    io.stderr("usage: snapgauge <record|diff> ... (run snapgauge --help)");
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
      "probe a target and write <dir>/<target>.snapshot.json (M1: fixture transport only; http/stdio land at M2)",
    )
    .argument("<target>", "target name — becomes the snapshot file stem")
    .requiredOption("--fixture <name>", "fixture server name resolved via the fixtures module")
    .option(
      "--fixtures-module <specifier>",
      "module exporting getFixture(name)",
      "@snapgauge/fixtures",
    )
    .option("--dir <dir>", "snapshot directory", ".snapgauge")
    .option("--profile <name>", `client profile (${profileNames().join("|")})`, "modern-full")
    .action(async (target: string, options: RecordCommandOptions) => {
      code = await recordCommand(target, options, io);
    });

  program
    .command("diff")
    .description("offline diff of two snapshot files — no network (SPEC §4)")
    .argument("<a>", "old snapshot file")
    .argument("<b>", "new snapshot file")
    .option("--fail-on <tier>", `gate tier (${TIERS.join("|")})`, "risky")
    .option("--json", "print the diff result as JSON")
    .action((a: string, b: string, options: DiffCommandOptions) => {
      code = diffCommand(a, b, options, io);
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help / --version exit "successfully"; every other commander error
      // (unknown command, missing argument/option) is a usage error.
      return error.exitCode === 0 ? EXIT.CLEAN : EXIT.USAGE;
    }
    return reportError(error, io);
  }
  return code;
}

async function recordCommand(
  target: string,
  options: RecordCommandOptions,
  io: CliIo,
): Promise<ExitCode> {
  try {
    if (!TARGET_NAME_RE.test(target)) {
      throw new SnapgaugeError(
        "USAGE",
        `invalid target name "${target}" (allowed: letters, digits, . _ @ -)`,
      );
    }
    const profile = getProfile(options.profile);
    if (profile === undefined) {
      throw new SnapgaugeError(
        "USAGE",
        `unknown profile "${options.profile}" — M1 ships ${profileNames().join(", ")}; the other built-ins land at M4 (SPEC §5)`,
      );
    }
    const fixture = await resolveFixture(options.fixturesModule, options.fixture);
    const snapshot = await record({
      transport: createFixtureTransport(fixture, profile),
      target: {
        transport: "fixture",
        host: options.fixture,
        path: "",
        protocolVersion: profile.protocolVersion,
        auth: "none",
      },
      probeSpec: { probes: [], profiles: [profile.name] },
      recordedAt: new Date().toISOString(),
    });
    const file = join(options.dir, `${target}.snapshot.json`);
    writeSnapshotFileAtomic(file, snapshot);
    io.stdout(`recorded ${target} -> ${file} (${String(snapshot.tools.length)} tools)`);
    return EXIT.CLEAN;
  } catch (error) {
    return reportError(error, io);
  }
}

function diffCommand(a: string, b: string, options: DiffCommandOptions, io: CliIo): ExitCode {
  try {
    const failOn = parseTier(options.failOn);
    const snapshotA = readSnapshotFile(a);
    const snapshotB = readSnapshotFile(b);
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
      printText(output, io);
    }
    return failed ? EXIT.DRIFT : EXIT.CLEAN;
  } catch (error) {
    return reportError(error, io);
  }
}

function printText(output: DiffOutput, io: CliIo): void {
  if (output.findings.length === 0) {
    io.stdout("no drift: snapshots are equivalent (recordedAt is metadata and excluded — SPEC §2)");
    return;
  }
  for (const finding of output.findings) {
    io.stdout(`${finding.tier.padEnd(10)} ${finding.ruleId.padEnd(28)} ${finding.subject} — ${finding.message}`);
  }
  const { summary } = output;
  const counts = `${String(summary.breaking)} breaking, ${String(summary.risky)} risky, ${String(summary.compatible)} compatible, ${String(summary.cosmetic)} cosmetic`;
  const verdict = output.gate.failed ? "DRIFT (exit 1)" : "below the gate (exit 0)";
  io.stdout(`${String(output.findings.length)} findings (${counts}); gate fail-on=${output.gate.failOn} -> ${verdict}`);
}

interface FixturesModule {
  getFixture(name: string): FixtureServer | undefined;
}

function isFixturesModule(value: unknown): value is FixturesModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "getFixture" in value &&
    typeof value.getFixture === "function"
  );
}

async function resolveFixture(specifier: string, name: string): Promise<FixtureServer> {
  let module_: unknown;
  try {
    module_ = (await import(specifier)) as unknown;
  } catch (cause) {
    throw new SnapgaugeError(
      "USAGE",
      `cannot load fixtures module "${specifier}" — in-repo this is @snapgauge/fixtures (private, SPEC §3); real targets need the http/stdio transports landing at M2`,
      { cause },
    );
  }
  if (!isFixturesModule(module_)) {
    throw new SnapgaugeError("USAGE", `fixtures module "${specifier}" does not export getFixture(name)`);
  }
  const fixture = module_.getFixture(name);
  if (fixture === undefined) {
    throw new SnapgaugeError("USAGE", `unknown fixture "${name}" in module "${specifier}"`);
  }
  return fixture;
}

function reportError(error: unknown, io: CliIo): ExitCode {
  if (error instanceof SnapgaugeError) {
    io.stderr(`error[${error.code}]: ${error.message}`);
    return exitCodeForError(error.code);
  }
  io.stderr(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT.INTERNAL;
}
