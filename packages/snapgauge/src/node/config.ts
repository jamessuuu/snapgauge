/**
 * Config loader (SPEC §4): `snapgauge.config.json` is canonical and contains
 * NO executable code (the demo site parses configs; a JS config would be an
 * RCE surface there). `.mjs`/`.ts` are also loaded via dynamic import for
 * people who want `defineConfig()` — Node ≥24 strips types. Zod-parsed,
 * unknown keys rejected. Header values interpolate `${ENV}` only; literal
 * credentials WARN.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { TIERS } from "../core/diff/diff.js";
import { SnapgaugeError } from "../core/errors.js";
import { JsonObjectSchema } from "../core/json.js";

const ProbeDeclConfigSchema = z.strictObject({
  id: z.string().min(1),
  tool: z.string().min(1),
  arguments: JsonObjectSchema.optional(),
  capture: z.enum(["shape", "values"]).optional(),
});

const targetCommon = {
  protocolVersion: z.string().optional(),
  profiles: z.array(z.string().min(1)).optional(),
  probes: z.array(ProbeDeclConfigSchema).optional(),
  resources: z.strictObject({ read: z.array(z.string()) }).optional(),
  volatile: z.array(z.string().min(1)).optional(),
  failOn: z.enum(TIERS).optional(),
  ignore: z.array(z.string().min(1)).optional(),
  timeoutMs: z.number().int().positive().optional(),
};

export const HttpTargetSchema = z.strictObject({
  transport: z.literal("http"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  ...targetCommon,
});

export const StdioTargetSchema = z.strictObject({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  ...targetCommon,
});

export const FixtureTargetSchema = z.strictObject({
  transport: z.literal("fixture"),
  fixture: z.string().min(1),
  fixturesModule: z.string().min(1).optional(),
  ...targetCommon,
});

export const TargetConfigSchema = z.discriminatedUnion("transport", [
  HttpTargetSchema,
  StdioTargetSchema,
  FixtureTargetSchema,
]);
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const ConfigSchema = z.strictObject({
  snapshotDir: z.string().min(1).optional(),
  targets: z.record(z.string().min(1), TargetConfigSchema),
});
export type SnapgaugeConfig = z.infer<typeof ConfigSchema>;

/** Typed identity helper for `.mjs`/`.ts` configs. */
export function defineConfig(config: SnapgaugeConfig): SnapgaugeConfig {
  return config;
}

export interface LoadedConfig {
  config: SnapgaugeConfig;
  /** Absolute path of the file that was loaded. */
  path: string;
  /** Directory `snapshotDir` resolves against (the config file's home). */
  baseDir: string;
  snapshotDir: string;
  warnings: string[];
}

const CANDIDATES = ["snapgauge.config.json", "snapgauge.config.mjs", "snapgauge.config.ts"];

export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadedConfig> {
  const path = findConfigPath(cwd, explicitPath);
  const raw = await readConfigFile(path);
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SnapgaugeError(
      "USAGE",
      `${path} is not a valid snapgauge config (unknown keys are rejected — SPEC §4): ${detail}`,
    );
  }
  const baseDir = dirname(path);
  return {
    config: parsed.data,
    path,
    baseDir,
    snapshotDir: resolve(baseDir, parsed.data.snapshotDir ?? ".snapgauge"),
    warnings: [],
  };
}

function findConfigPath(cwd: string, explicitPath?: string): string {
  if (explicitPath !== undefined) {
    const path = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    if (!existsSync(path)) {
      throw new SnapgaugeError("USAGE", `config file not found: ${path}`);
    }
    return path;
  }
  for (const candidate of CANDIDATES) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  throw new SnapgaugeError(
    "USAGE",
    `no snapgauge config found in ${cwd} (looked for ${CANDIDATES.join(", ")}) — run \`snapgauge init\` first`,
  );
}

async function readConfigFile(path: string): Promise<unknown> {
  if (path.endsWith(".json")) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (cause) {
      throw new SnapgaugeError("USAGE", `cannot read config file: ${path}`, { cause });
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new SnapgaugeError("USAGE", `${path} is not valid JSON`, { cause });
    }
  }
  // .mjs / .ts — dynamic import; Node ≥24 strips types (SPEC §4).
  let module_: unknown;
  try {
    module_ = await import(pathToFileURL(path).href);
  } catch (cause) {
    throw new SnapgaugeError("USAGE", `cannot import config module: ${path}`, { cause });
  }
  if (typeof module_ !== "object" || module_ === null || !("default" in module_)) {
    throw new SnapgaugeError("USAGE", `${path} must default-export a config object`);
  }
  return module_.default;
}

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const CREDENTIAL_HEADER_RE = /authorization|token|key|secret|cookie/i;

export interface InterpolatedHeaders {
  headers: Record<string, string>;
  warnings: string[];
}

/**
 * `${ENV}` interpolation for header values (SPEC §4: "${ENV} only; literals
 * warn"). A missing variable is an AUTH failure (exit 2) — never a silent
 * empty header. Credential-shaped literals produce a warning so a pasted
 * token cannot slip into a committed config unnoticed.
 */
export function interpolateHeaders(
  headers: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): InterpolatedHeaders {
  const out: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!ENV_RE.test(value) && CREDENTIAL_HEADER_RE.test(name)) {
      warnings.push(
        `header "${name}" carries a literal value — use \${ENV} interpolation so the credential never lands in the config file (SPEC §4)`,
      );
    }
    ENV_RE.lastIndex = 0;
    out[name] = value.replace(ENV_RE, (_match, variable: string) => {
      const resolved = env[variable];
      if (resolved === undefined) {
        throw new SnapgaugeError(
          "AUTH",
          `header "${name}" references \${${variable}} but the variable is not set (SPEC §6: auth classification)`,
        );
      }
      return resolved;
    });
  }
  return { headers: out, warnings };
}
