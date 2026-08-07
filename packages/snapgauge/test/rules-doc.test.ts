/**
 * docs/RULES.md drift guard (SPEC §10 M3: "generated into docs/RULES.md
 * from the registry (single source, no drift)"). The committed doc must be
 * byte-equal to what the registry renders — regenerate with `pnpm docs:rules`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES, renderRulesDoc } from "../src/core/diff/rules.js";
import { TIERS } from "../src/core/diff/diff.js";

const DOC_PATH = fileURLToPath(new URL("../../../docs/RULES.md", import.meta.url));

describe("rule catalog (SPEC §5 / §10)", () => {
  it("docs/RULES.md matches the registry byte-for-byte (no drift)", () => {
    const committed = readFileSync(DOC_PATH, "utf8").replaceAll("\r\n", "\n");
    expect(committed).toBe(renderRulesDoc());
  });

  it("every SPEC §5 tier-table rule id is registered at its specified tier", () => {
    const byId = new Map(RULES.map((rule) => [rule.id, rule.tier]));
    const expected: Record<string, string[]> = {
      breaking: [
        "tool.removed",
        "tool.input.required.added",
        "tool.input.type.narrowed",
        "tool.input.enum.removed",
        "tool.output.required.added",
        "xhdr.added",
        "xhdr.changed",
        "capability.removed",
        "version.dropped",
        "annotation.readOnlyHint.revoked",
        "annotation.destructiveHint.raised",
        "annotation.idempotentHint.revoked",
        "error.code.changed",
      ],
      risky: [
        "tool.description.changed",
        "tool.title.changed",
        "tool.added",
        "instructions.changed",
        "order.changed",
        "order.nondeterministic",
        "cacheScope.widened",
        "ttlMs.raised",
        "output.enum.added",
        // the annotation.*.relaxed family:
        "annotation.readOnlyHint.relaxed",
        "annotation.destructiveHint.relaxed",
        "annotation.idempotentHint.relaxed",
      ],
      compatible: [
        "tool.input.optional.added",
        "tool.input.enum.added",
        "tool.input.type.widened",
        "required.removed",
        "capability.added",
        "version.added",
        "ttlMs.lowered",
        "cacheScope.narrowed",
      ],
      cosmetic: [
        "tool.icons.changed",
        "serverInfo.version.changed",
        "_meta.vendor.changed",
        // "whitespace-only" from the table:
        "text.whitespace-only",
      ],
    };
    for (const [tier, ids] of Object.entries(expected)) {
      for (const id of ids) {
        expect(byId.get(id), id).toBe(tier);
      }
    }
    // Nothing beyond the table sneaks into the registry.
    const allExpected = new Set(Object.values(expected).flat());
    for (const rule of RULES) {
      expect(allExpected.has(rule.id), `unexpected rule ${rule.id}`).toBe(true);
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it("rule ids are unique per tier and every tier is populated", () => {
    for (const tier of TIERS) {
      expect(RULES.some((rule) => rule.tier === tier), tier).toBe(true);
    }
  });
});
