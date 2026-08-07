import { describe, expect, it } from "vitest";
import { normalizeVolatile, probeSpecHash, type ProbeSpec } from "./canonical.js";

describe("probeSpecHash (SPEC §2 Decision 3)", () => {
  const spec: ProbeSpec = { probes: [], profiles: ["modern-full"] };

  it("is stable and hex-shaped", () => {
    const hash = probeSpecHash(spec);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(probeSpecHash({ probes: [], profiles: ["modern-full"] })).toBe(hash);
  });

  it("is insertion-order independent (JCS bytes)", () => {
    const reordered = { profiles: ["modern-full"], probes: [] } as ProbeSpec;
    expect(probeSpecHash(reordered)).toBe(probeSpecHash(spec));
  });

  it("changes when the declared probes or profiles change", () => {
    expect(probeSpecHash({ probes: [], profiles: ["modern-full", "modern-minimal"] })).not.toBe(
      probeSpecHash(spec),
    );
    expect(
      probeSpecHash({
        probes: [{ id: "w", tool: "get_weather", arguments: {}, capture: "shape" }],
        profiles: ["modern-full"],
      }),
    ).not.toBe(probeSpecHash(spec));
  });
});

describe("normalizeVolatile (SPEC §2 Decision 2)", () => {
  it("replaces selected values with type tokens", () => {
    const input = {
      behavior: {
        check: {
          requestId: "9f1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
          at: "2026-08-08T10:00:00Z",
          attempt: 7,
          ok: true,
          note: "free text",
        },
      },
    };
    const out = normalizeVolatile(input, [
      "behavior.check.requestId",
      "behavior.check.at",
      "behavior.check.attempt",
      "behavior.check.ok",
      "behavior.check.note",
    ]);
    expect(out).toEqual({
      behavior: {
        check: {
          requestId: "<uuid>",
          at: "<iso8601>",
          attempt: "<number>",
          ok: "<boolean>",
          note: "<string>",
        },
      },
    });
  });

  it("indexes arrays with numeric path segments", () => {
    const out = normalizeVolatile({ items: [{ ts: "2026-08-08T00:00:00Z" }, { ts: "keep" }] }, [
      "items.0.ts",
    ]);
    expect(out).toEqual({ items: [{ ts: "<iso8601>" }, { ts: "keep" }] });
  });

  it("returns untouched branches by reference", () => {
    const other = { deep: [1, 2, 3] };
    const input = { volatile: { n: 1 }, other };
    const out = normalizeVolatile(input, ["volatile.n"]) as { other: unknown };
    expect(out.other).toBe(other);
  });

  it("is the identity for empty or non-matching selectors", () => {
    const input = { a: { b: 1 } };
    expect(normalizeVolatile(input, [])).toBe(input);
    expect(normalizeVolatile(input, ["does.not.match"])).toBe(input);
  });
});
