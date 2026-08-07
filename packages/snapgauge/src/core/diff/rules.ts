/**
 * The full diff-rule catalog (SPEC §5 tier table) — every rule id in the
 * table, direction-aware (old → new), each with the one-line meaning that
 * docs/RULES.md is generated from (single source, no drift: a unit test
 * fails when the doc and this registry disagree).
 *
 * Tier rationale is SPEC §5's. Notably: descriptions and titles are RISKY,
 * not cosmetic — text is the trigger surface a model routes on. The
 * `annotation.*.relaxed` family covers safety-claim increases (a hint moving
 * in the "safer-sounding" direction), which clients may act on by skipping
 * confirmations.
 */
import { jcsCanonical, type Json, type JsonObject } from "../json.js";
import type { SnapshotTool, SnapshotV1 } from "../snapshot/schema.js";
import type { Finding, Tier } from "./diff.js";

export type PartialFinding = Omit<Finding, "ruleId" | "tier">;

export interface Rule {
  id: string;
  tier: Tier;
  /** One line for the generated catalog (docs/RULES.md). */
  summary: string;
  run(a: SnapshotV1, b: SnapshotV1): PartialFinding[];
}

// ---------------------------------------------------------------------------
// helpers

function isObj(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolMap(snapshot: SnapshotV1): Map<string, SnapshotTool> {
  return new Map(snapshot.tools.map((tool) => [tool.name, tool]));
}

function commonTools(a: SnapshotV1, b: SnapshotV1): [SnapshotTool, SnapshotTool][] {
  const after = toolMap(b);
  const pairs: [SnapshotTool, SnapshotTool][] = [];
  for (const tool of a.tools) {
    const counterpart = after.get(tool.name);
    if (counterpart !== undefined) pairs.push([tool, counterpart]);
  }
  return pairs;
}

function stringSet(value: Json | undefined): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((entry): entry is string => typeof entry === "string"));
}

function propsOf(schema: JsonObject): Record<string, JsonObject> {
  const properties = schema.properties;
  if (!isObj(properties)) return {};
  const out: Record<string, JsonObject> = {};
  for (const [name, child] of Object.entries(properties)) {
    if (isObj(child)) out[name] = child;
  }
  return out;
}

function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return jcsCanonical(a) === jcsCanonical(b);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "whitespace-only" (SPEC §5 cosmetic): equal after stripping ALL whitespace. */
function whitespaceOnlyChange(before: string | undefined, after: string | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  return before.replace(/\s+/g, "") === after.replace(/\s+/g, "");
}

/** Walk paired object schemas through `properties` chains, visiting each pair. */
function walkSchemaPairs(
  oldNode: Json | undefined,
  newNode: Json | undefined,
  path: string,
  visit: (oldSchema: JsonObject, newSchema: JsonObject, path: string) => void,
): void {
  if (!isObj(oldNode) || !isObj(newNode)) return;
  visit(oldNode, newNode, path);
  const oldProps = propsOf(oldNode);
  const newProps = propsOf(newNode);
  for (const name of Object.keys(oldProps)) {
    if (name in newProps) {
      walkSchemaPairs(oldProps[name], newProps[name], `${path}.properties.${name}`, visit);
    }
  }
}

/** JSON Schema `type` as a set; undefined = unconstrained (any). */
function typeSetOf(schema: JsonObject): ReadonlySet<string> | undefined {
  const type = schema.type;
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type)) {
    return new Set(type.filter((entry): entry is string => typeof entry === "string"));
  }
  return undefined;
}

function enumOf(schema: JsonObject): Json[] | undefined {
  return Array.isArray(schema.enum) ? schema.enum : undefined;
}

/** true when `next` still accepts everything `prev` accepted. */
function covers(next: ReadonlySet<string> | undefined, prev: ReadonlySet<string> | undefined): boolean {
  if (next === undefined) return true; // unconstrained accepts all
  if (prev === undefined) return false; // constrained cannot cover "any"
  return [...prev].every((entry) => next.has(entry));
}

function hint(tool: SnapshotTool, name: string): boolean {
  return isObj(tool.annotations) && tool.annotations[name] === true;
}

/** Statically-reachable x-mcp-header bindings: properties chains only. */
function collectXmcpBindings(schema: JsonObject, path: string, out: Map<string, string>): void {
  for (const [name, child] of Object.entries(propsOf(schema))) {
    const childPath = `${path}.properties.${name}`;
    const header = child["x-mcp-header"];
    if (typeof header === "string") out.set(childPath, header);
    collectXmcpBindings(child, childPath, out);
  }
}

function bindingsOf(tool: SnapshotTool, root: string): Map<string, string> {
  const out = new Map<string, string>();
  collectXmcpBindings(tool.inputSchema, root, out);
  return out;
}

interface CacheSurface {
  subject: string;
  ttl?: number | undefined;
  scope?: string | undefined;
}

function cacheSurfaces(snapshot: SnapshotV1): CacheSurface[] {
  return [
    { subject: "discover", ttl: snapshot.discover.ttlMs, scope: snapshot.discover.cacheScope },
    { subject: "toolsList", ttl: snapshot.toolsList.ttlMs, scope: snapshot.toolsList.cacheScope },
  ];
}

function pairedCacheSurfaces(a: SnapshotV1, b: SnapshotV1): [CacheSurface, CacheSurface][] {
  const before = cacheSurfaces(a);
  const after = cacheSurfaces(b);
  return before.map((surface, i) => [surface, after[i] ?? surface]);
}

function textChangeFindings(
  a: SnapshotV1,
  b: SnapshotV1,
  field: "description" | "title",
  wantWhitespaceOnly: boolean,
): PartialFinding[] {
  return commonTools(a, b)
    .filter(([oldTool, newTool]) => oldTool[field] !== newTool[field])
    .filter(
      ([oldTool, newTool]) =>
        whitespaceOnlyChange(oldTool[field], newTool[field]) === wantWhitespaceOnly,
    )
    .map(([oldTool, newTool]) => ({
      subject: `tools.${newTool.name}.${field}`,
      message: wantWhitespaceOnly
        ? `${field} changed in whitespace only`
        : `${field} changed — the trigger surface a model routes on (SPEC §5: risky, not cosmetic)`,
      ...(oldTool[field] !== undefined ? { before: oldTool[field] } : {}),
      ...(newTool[field] !== undefined ? { after: newTool[field] } : {}),
    }));
}

// ---------------------------------------------------------------------------
// the catalog

export const RULES: readonly Rule[] = [
  // ------------------------------------------------------------- breaking
  {
    id: "tool.removed",
    tier: "breaking",
    summary: "A tool present in the old contract is gone — clients holding the old contract fail.",
    run: (a, b) => {
      const after = toolMap(b);
      return a.tools
        .filter((tool) => !after.has(tool.name))
        .map((tool) => ({
          subject: `tools.${tool.name}`,
          message: `tool "${tool.name}" was removed — a client holding the old contract will fail`,
        }));
    },
  },
  {
    id: "tool.input.required.added",
    tier: "breaking",
    summary: "An input became required — clients recorded against the old contract do not send it.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldRequired = stringSet(oldSchema.required);
            for (const name of stringSet(newSchema.required)) {
              if (!oldRequired.has(name)) {
                findings.push({
                  subject: `${path}.required.${name}`,
                  message: `input "${name}" is now required — a client recorded against the old contract does not send it`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "tool.input.type.narrowed",
    tier: "breaking",
    summary:
      "An input's accepted value space shrank (type set reduced/changed, or an enum constraint introduced) — previously-valid calls are now rejected.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newProps = propsOf(newSchema);
            for (const name of Object.keys(oldProps)) {
              const oldProp = oldProps[name];
              const newProp = newProps[name];
              if (oldProp === undefined || newProp === undefined) continue;
              const oldTypes = typeSetOf(oldProp);
              const newTypes = typeSetOf(newProp);
              if (!covers(newTypes, oldTypes)) {
                findings.push({
                  subject: `${path}.properties.${name}.type`,
                  message: `type of "${name}" narrowed — values the old contract accepted are now invalid`,
                  before: oldTypes === undefined ? "(any)" : [...oldTypes].sort().join("|"),
                  after: newTypes === undefined ? "(any)" : [...newTypes].sort().join("|"),
                });
              }
              if (enumOf(oldProp) === undefined && enumOf(newProp) !== undefined) {
                findings.push({
                  subject: `${path}.properties.${name}.enum`,
                  message: `enum constraint introduced on "${name}" — previously unconstrained values are now rejected`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "tool.input.enum.removed",
    tier: "breaking",
    summary: "Enum value(s) removed from an input — clients sending them are now rejected.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newProps = propsOf(newSchema);
            for (const name of Object.keys(oldProps)) {
              const oldProp = oldProps[name];
              const newProp = newProps[name];
              if (oldProp === undefined || newProp === undefined) continue;
              const oldEnum = enumOf(oldProp);
              const newEnum = enumOf(newProp);
              if (oldEnum === undefined || newEnum === undefined) continue;
              const newCanon = new Set(newEnum.map((v) => jcsCanonical(v)));
              const removed = oldEnum.filter((v) => !newCanon.has(jcsCanonical(v)));
              if (removed.length > 0) {
                findings.push({
                  subject: `${path}.properties.${name}.enum`,
                  message: `enum value(s) removed from "${name}": ${removed.map((v) => jcsCanonical(v)).join(", ")}`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "tool.output.required.added",
    tier: "breaking",
    summary: "An output field became required (SPEC §5 places this at breaking).",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.outputSchema,
          newTool.outputSchema,
          `tools.${newTool.name}.outputSchema`,
          (oldSchema, newSchema, path) => {
            const oldRequired = stringSet(oldSchema.required);
            for (const name of stringSet(newSchema.required)) {
              if (!oldRequired.has(name)) {
                findings.push({
                  subject: `${path}.required.${name}`,
                  message: `output "${name}" is now required`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "xhdr.added",
    tier: "breaking",
    summary:
      "An x-mcp-header binding appeared on an existing tool — a client on a cached tools/list will now be rejected with -32020.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const root = `tools.${newTool.name}.inputSchema`;
        const before = bindingsOf(oldTool, root);
        const after = bindingsOf(newTool, root);
        const findings: PartialFinding[] = [];
        for (const [path, header] of after) {
          if (!before.has(path)) {
            findings.push({
              subject: `${path}.x-mcp-header`,
              message: `x-mcp-header "${header}" added — a client on a cached tools/list will now be rejected with -32020`,
              after: header,
            });
          }
        }
        return findings;
      }),
  },
  {
    id: "xhdr.changed",
    tier: "breaking",
    summary:
      "An x-mcp-header binding's header name changed — clients still send the old header and are rejected with -32020.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const root = `tools.${newTool.name}.inputSchema`;
        const before = bindingsOf(oldTool, root);
        const after = bindingsOf(newTool, root);
        const findings: PartialFinding[] = [];
        for (const [path, header] of after) {
          const previous = before.get(path);
          if (previous !== undefined && previous !== header) {
            findings.push({
              subject: `${path}.x-mcp-header`,
              message: `x-mcp-header changed — clients still send the old header and are rejected with -32020`,
              before: previous,
              after: header,
            });
          }
        }
        return findings;
      }),
  },
  {
    id: "capability.removed",
    tier: "breaking",
    summary: "A server capability disappeared from discover — features clients negotiated are gone.",
    run: (a, b) =>
      Object.keys(a.discover.capabilities)
        .filter((name) => !(name in b.discover.capabilities))
        .map((name) => ({
          subject: `discover.capabilities.${name}`,
          message: `capability "${name}" was removed`,
        })),
  },
  {
    id: "version.dropped",
    tier: "breaking",
    summary: "A previously-advertised protocol version is no longer supported.",
    run: (a, b) => {
      const after = new Set(b.discover.supportedVersions);
      return a.discover.supportedVersions
        .filter((version) => !after.has(version))
        .map((version) => ({
          subject: `discover.supportedVersions.${version}`,
          message: `advertised protocol version ${version} was dropped`,
        }));
    },
  },
  {
    id: "annotation.readOnlyHint.revoked",
    tier: "breaking",
    summary: "readOnlyHint was true and no longer is — clients treating the tool as safe now mutate.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => hint(oldTool, "readOnlyHint") && !hint(newTool, "readOnlyHint"))
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.readOnlyHint`,
          message: "readOnlyHint revoked — clients that skipped confirmation on a read-only tool now mutate state",
        })),
  },
  {
    id: "annotation.destructiveHint.raised",
    tier: "breaking",
    summary: "destructiveHint became true — the tool now declares it destroys data.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(
          ([oldTool, newTool]) => !hint(oldTool, "destructiveHint") && hint(newTool, "destructiveHint"),
        )
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.destructiveHint`,
          message: "destructiveHint raised — clients treating the tool as safe will destroy data",
        })),
  },
  {
    id: "annotation.idempotentHint.revoked",
    tier: "breaking",
    summary: "idempotentHint was true and no longer is — retry logic built on it is now unsafe.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(
          ([oldTool, newTool]) => hint(oldTool, "idempotentHint") && !hint(newTool, "idempotentHint"),
        )
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.idempotentHint`,
          message: "idempotentHint revoked — clients retrying on failure now double-apply",
        })),
  },
  {
    id: "error.code.changed",
    tier: "breaking",
    summary: "A probed call's error code changed — client error handling keyed on the code breaks.",
    run: (a, b) => {
      const before = a.behavior ?? {};
      const after = b.behavior ?? {};
      const findings: PartialFinding[] = [];
      for (const id of Object.keys(before)) {
        const oldProbe = before[id];
        const newProbe = after[id];
        if (oldProbe?.errorCode === undefined || newProbe?.errorCode === undefined) continue;
        if (oldProbe.errorCode !== newProbe.errorCode) {
          findings.push({
            subject: `behavior.${id}.errorCode`,
            message: `probe "${id}" now fails with a different error code`,
            before: oldProbe.errorCode,
            after: newProbe.errorCode,
          });
        }
      }
      return findings;
    },
  },
  // --------------------------------------------------------------- risky
  {
    id: "tool.description.changed",
    tier: "risky",
    summary: "Description text changed — the trigger surface a model routes on (never cosmetic).",
    run: (a, b) => textChangeFindings(a, b, "description", false),
  },
  {
    id: "tool.title.changed",
    tier: "risky",
    summary: "Title text changed — also routing surface.",
    run: (a, b) => textChangeFindings(a, b, "title", false),
  },
  {
    id: "tool.added",
    tier: "risky",
    summary: "A new tool appeared — expands the agent's action surface (shadowing risk).",
    run: (a, b) => {
      const before = toolMap(a);
      return b.tools
        .filter((tool) => !before.has(tool.name))
        .map((tool) => ({
          subject: `tools.${tool.name}`,
          message: `tool "${tool.name}" was added — expands the agent's action surface / shadowing`,
        }));
    },
  },
  {
    id: "instructions.changed",
    tier: "risky",
    summary: "Server instructions changed — system-prompt-adjacent steering text.",
    run: (a, b) => {
      const before = a.discover.instructions;
      const after = b.discover.instructions;
      if (before === after || whitespaceOnlyChange(before, after)) return [];
      return [
        {
          subject: "discover.instructions",
          message: "server instructions changed — steering text injected into the client context",
          ...(before !== undefined ? { before } : {}),
          ...(after !== undefined ? { after } : {}),
        },
      ];
    },
  },
  {
    id: "order.changed",
    tier: "risky",
    summary:
      "tools/list order changed (same tool set, both sides stable) — churns prompt caches keyed on list order.",
    run: (a, b) => {
      if (!a.toolsList.orderStable || !b.toolsList.orderStable) return [];
      const before = a.toolsList.order;
      const after = b.toolsList.order;
      const sameSet =
        before.length === after.length && [...before].sort().join("\n") === [...after].sort().join("\n");
      if (!sameSet) return [];
      if (before.every((name, i) => name === after[i])) return [];
      return [
        {
          subject: "toolsList.order",
          message:
            "tools/list order changed — the spec only SHOULDs deterministic ordering, but reorders churn prompt caches",
          before: before.join(", "),
          after: after.join(", "),
        },
      ];
    },
  },
  {
    id: "order.nondeterministic",
    tier: "risky",
    summary:
      "Repeated tools/list calls disagree on order (3-repeat probe) — reported as instability, NEVER as a false breaking diff.",
    run: (_a, b) => {
      if (b.toolsList.orderStable) return [];
      return [
        {
          subject: "toolsList.order",
          message:
            "tools/list order is nondeterministic across 3 repeats — instability is data, not breakage (SPEC §6)",
        },
      ];
    },
  },
  {
    id: "cacheScope.widened",
    tier: "risky",
    summary:
      "cacheScope went private → public — responses may now be shared across authorization contexts.",
    run: (a, b) =>
      pairedCacheSurfaces(a, b)
        .filter(([before, after]) => before.scope === "private" && after.scope === "public")
        .map(([, after]) => ({
          subject: `${after.subject}.cacheScope`,
          message: "cacheScope widened private -> public — responses may be shared across authorization contexts",
          before: "private",
          after: "public",
        })),
  },
  {
    id: "ttlMs.raised",
    tier: "risky",
    summary: "ttlMs increased — clients will serve stale surface data for longer.",
    run: (a, b) =>
      pairedCacheSurfaces(a, b)
        .filter(
          ([before, after]) =>
            before.ttl !== undefined && after.ttl !== undefined && after.ttl > before.ttl,
        )
        .map(([before, after]) => ({
          subject: `${after.subject}.ttlMs`,
          message: "ttlMs raised — clients cache the surface for longer",
          before: before.ttl ?? null,
          after: after.ttl ?? null,
        })),
  },
  {
    id: "output.enum.added",
    tier: "risky",
    summary: "Enum value(s) added to an output — consumers may not handle the new values.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.outputSchema,
          newTool.outputSchema,
          `tools.${newTool.name}.outputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newProps = propsOf(newSchema);
            for (const name of Object.keys(oldProps)) {
              const oldProp = oldProps[name];
              const newProp = newProps[name];
              if (oldProp === undefined || newProp === undefined) continue;
              const oldEnum = enumOf(oldProp);
              const newEnum = enumOf(newProp);
              if (oldEnum === undefined || newEnum === undefined) continue;
              const oldCanon = new Set(oldEnum.map((v) => jcsCanonical(v)));
              const added = newEnum.filter((v) => !oldCanon.has(jcsCanonical(v)));
              if (added.length > 0) {
                findings.push({
                  subject: `${path}.properties.${name}.enum`,
                  message: `output enum value(s) added to "${name}": ${added.map((v) => jcsCanonical(v)).join(", ")}`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "annotation.readOnlyHint.relaxed",
    tier: "risky",
    summary:
      "readOnlyHint became true (annotation.*.relaxed family) — an increased safety claim clients may act on.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => !hint(oldTool, "readOnlyHint") && hint(newTool, "readOnlyHint"))
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.readOnlyHint`,
          message: "readOnlyHint granted — clients may now skip confirmations on this tool",
        })),
  },
  {
    id: "annotation.destructiveHint.relaxed",
    tier: "risky",
    summary:
      "destructiveHint was true and no longer is (annotation.*.relaxed family) — the tool now claims to be safer.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(
          ([oldTool, newTool]) => hint(oldTool, "destructiveHint") && !hint(newTool, "destructiveHint"),
        )
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.destructiveHint`,
          message: "destructiveHint withdrawn — clients may stop confirming a formerly-destructive tool",
        })),
  },
  {
    id: "annotation.idempotentHint.relaxed",
    tier: "risky",
    summary:
      "idempotentHint became true (annotation.*.relaxed family) — clients may now retry freely on its word.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(
          ([oldTool, newTool]) => !hint(oldTool, "idempotentHint") && hint(newTool, "idempotentHint"),
        )
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.annotations.idempotentHint`,
          message: "idempotentHint granted — retry behavior may change on the tool's word",
        })),
  },
  // ---------------------------------------------------------- compatible
  {
    id: "tool.input.optional.added",
    tier: "compatible",
    summary: "A new optional input appeared — old calls remain valid.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newRequired = stringSet(newSchema.required);
            const newProperties = newSchema.properties;
            if (!isObj(newProperties)) return;
            for (const name of Object.keys(newProperties)) {
              if (!(name in oldProps) && !newRequired.has(name)) {
                findings.push({
                  subject: `${path}.properties.${name}`,
                  message: `optional input "${name}" was added`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "tool.input.enum.added",
    tier: "compatible",
    summary: "Enum value(s) added to an input — everything the old contract sent still works.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newProps = propsOf(newSchema);
            for (const name of Object.keys(oldProps)) {
              const oldProp = oldProps[name];
              const newProp = newProps[name];
              if (oldProp === undefined || newProp === undefined) continue;
              const oldEnum = enumOf(oldProp);
              const newEnum = enumOf(newProp);
              if (oldEnum === undefined || newEnum === undefined) continue;
              const oldCanon = new Set(oldEnum.map((v) => jcsCanonical(v)));
              const added = newEnum.filter((v) => !oldCanon.has(jcsCanonical(v)));
              if (added.length > 0) {
                findings.push({
                  subject: `${path}.properties.${name}.enum`,
                  message: `enum value(s) added to "${name}": ${added.map((v) => jcsCanonical(v)).join(", ")}`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "tool.input.type.widened",
    tier: "compatible",
    summary:
      "An input's accepted value space grew (type set expanded, or an enum constraint dropped) — old calls remain valid.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const oldProps = propsOf(oldSchema);
            const newProps = propsOf(newSchema);
            for (const name of Object.keys(oldProps)) {
              const oldProp = oldProps[name];
              const newProp = newProps[name];
              if (oldProp === undefined || newProp === undefined) continue;
              const oldTypes = typeSetOf(oldProp);
              const newTypes = typeSetOf(newProp);
              const widened =
                covers(newTypes, oldTypes) &&
                !covers(oldTypes, newTypes) &&
                !(oldTypes === undefined && newTypes === undefined);
              if (widened) {
                findings.push({
                  subject: `${path}.properties.${name}.type`,
                  message: `type of "${name}" widened — everything the old contract sent still works`,
                  before: oldTypes === undefined ? "(any)" : [...oldTypes].sort().join("|"),
                  after: newTypes === undefined ? "(any)" : [...newTypes].sort().join("|"),
                });
              }
              if (enumOf(oldProp) !== undefined && enumOf(newProp) === undefined) {
                findings.push({
                  subject: `${path}.properties.${name}.enum`,
                  message: `enum constraint dropped from "${name}" — any value is now accepted`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "required.removed",
    tier: "compatible",
    summary: "An input is no longer required — clients that send it are still fine.",
    run: (a, b) =>
      commonTools(a, b).flatMap(([oldTool, newTool]) => {
        const findings: PartialFinding[] = [];
        walkSchemaPairs(
          oldTool.inputSchema,
          newTool.inputSchema,
          `tools.${newTool.name}.inputSchema`,
          (oldSchema, newSchema, path) => {
            const newRequired = stringSet(newSchema.required);
            for (const name of stringSet(oldSchema.required)) {
              if (!newRequired.has(name)) {
                findings.push({
                  subject: `${path}.required.${name}`,
                  message: `input "${name}" is no longer required`,
                });
              }
            }
          },
        );
        return findings;
      }),
  },
  {
    id: "capability.added",
    tier: "compatible",
    summary: "A new server capability appeared in discover.",
    run: (a, b) =>
      Object.keys(b.discover.capabilities)
        .filter((name) => !(name in a.discover.capabilities))
        .map((name) => ({
          subject: `discover.capabilities.${name}`,
          message: `capability "${name}" was added`,
        })),
  },
  {
    id: "version.added",
    tier: "compatible",
    summary: "A new protocol version is now advertised.",
    run: (a, b) => {
      const before = new Set(a.discover.supportedVersions);
      return b.discover.supportedVersions
        .filter((version) => !before.has(version))
        .map((version) => ({
          subject: `discover.supportedVersions.${version}`,
          message: `advertised protocol version ${version} was added`,
        }));
    },
  },
  {
    id: "ttlMs.lowered",
    tier: "compatible",
    summary: "ttlMs decreased — clients refresh sooner.",
    run: (a, b) =>
      pairedCacheSurfaces(a, b)
        .filter(
          ([before, after]) =>
            before.ttl !== undefined && after.ttl !== undefined && after.ttl < before.ttl,
        )
        .map(([before, after]) => ({
          subject: `${after.subject}.ttlMs`,
          message: "ttlMs lowered — clients refresh the surface sooner",
          before: before.ttl ?? null,
          after: after.ttl ?? null,
        })),
  },
  {
    id: "cacheScope.narrowed",
    tier: "compatible",
    summary: "cacheScope went public → private — strictly safer sharing semantics.",
    run: (a, b) =>
      pairedCacheSurfaces(a, b)
        .filter(([before, after]) => before.scope === "public" && after.scope === "private")
        .map(([, after]) => ({
          subject: `${after.subject}.cacheScope`,
          message: "cacheScope narrowed public -> private",
          before: "public",
          after: "private",
        })),
  },
  // ------------------------------------------------------------ cosmetic
  {
    id: "tool.icons.changed",
    tier: "cosmetic",
    summary: "Tool icons changed.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => !jsonEqual(oldTool.icons, newTool.icons))
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}.icons`,
          message: "icons changed",
        })),
  },
  {
    id: "serverInfo.version.changed",
    tier: "cosmetic",
    summary: "serverInfo.version changed — releases are expected to happen.",
    run: (a, b) => {
      const before = a.discover.serverInfo.version;
      const after = b.discover.serverInfo.version;
      if (before === after) return [];
      return [
        {
          subject: "discover.serverInfo.version",
          message: "serverInfo.version changed",
          before,
          after,
        },
      ];
    },
  },
  {
    id: "_meta.vendor.changed",
    tier: "cosmetic",
    summary: "A tool's vendor _meta changed — vendor-prefixed keys carry no contract.",
    run: (a, b) =>
      commonTools(a, b)
        .filter(([oldTool, newTool]) => !jsonEqual(oldTool._meta, newTool._meta))
        .map(([, newTool]) => ({
          subject: `tools.${newTool.name}._meta`,
          message: "vendor _meta changed",
        })),
  },
  {
    id: "text.whitespace-only",
    tier: "cosmetic",
    summary:
      "A description/title/instructions change that is whitespace-only — the one text change that IS cosmetic.",
    run: (a, b) => {
      const findings: PartialFinding[] = [
        ...textChangeFindings(a, b, "description", true),
        ...textChangeFindings(a, b, "title", true),
      ];
      const before = a.discover.instructions;
      const after = b.discover.instructions;
      if (before !== after && whitespaceOnlyChange(before, after)) {
        findings.push({
          subject: "discover.instructions",
          message: "instructions changed in whitespace only",
        });
      }
      return findings;
    },
  },
];

// ---------------------------------------------------------------------------
// generated catalog (docs/RULES.md)

const TIER_ORDER: readonly Tier[] = ["breaking", "risky", "compatible", "cosmetic"];

/**
 * Render the rule catalog markdown — the SINGLE source for docs/RULES.md.
 * `scripts/generate-rules.mjs` writes it; a unit test fails on drift.
 */
export function renderRulesDoc(): string {
  const lines: string[] = [
    "# snapgauge rule catalog",
    "",
    "Diff rules (SPEC §5), direction-aware old → new. Generated from",
    "`packages/snapgauge/src/core/diff/rules.ts` — do NOT edit by hand:",
    "run `pnpm docs:rules` after changing the registry (a unit test fails",
    "when this file drifts from the registry).",
    "",
    "Descriptions and titles are risky, not cosmetic: text is the trigger",
    "surface a model routes on. Default gate: `failOn: \"risky\"`.",
    "",
  ];
  for (const tier of TIER_ORDER) {
    const rules = RULES.filter((rule) => rule.tier === tier).sort((x, y) =>
      compareStrings(x.id, y.id),
    );
    lines.push(`## ${tier} (${String(rules.length)})`);
    lines.push("");
    lines.push("| Rule id | What it means |");
    lines.push("|---|---|");
    for (const rule of rules) {
      lines.push(`| \`${rule.id}\` | ${rule.summary.replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
