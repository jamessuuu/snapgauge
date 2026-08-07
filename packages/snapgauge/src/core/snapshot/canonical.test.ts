import { describe, expect, it } from "vitest";
import { normalizeVolatile, normalizeVolatileKeys, probeSpecHash, VOLATILE_KEYS, type ProbeSpec } from "./canonical.js";

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

describe("built-in volatile KEYS (SPEC §2 Decision 2: the fixed built-in list)", () => {
  it("tokenizes values under built-in keys anywhere in a value capture", () => {
    const input = {
      requestId: "9f1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      nested: { TIMESTAMP: "2026-08-08T10:00:00Z", items: [{ etag: "abc", keep: "me" }] },
    };
    expect(normalizeVolatileKeys(input)).toEqual({
      requestId: "<uuid>",
      nested: { TIMESTAMP: "<iso8601>", items: [{ etag: "<string>", keep: "me" }] },
    });
  });

  it("matches case-insensitively and leaves non-volatile keys alone", () => {
    expect(normalizeVolatileKeys({ Request_Id: "x", body: "y" })).toEqual({
      Request_Id: "<string>",
      body: "y",
    });
  });

  it("the built-in list is fixed, lowercase and non-empty", () => {
    expect(VOLATILE_KEYS.length).toBeGreaterThan(0);
    for (const key of VOLATILE_KEYS) expect(key).toBe(key.toLowerCase());
  });

  it("scalars and arrays pass through untouched", () => {
    expect(normalizeVolatileKeys("plain")).toBe("plain");
    expect(normalizeVolatileKeys([1, 2])).toEqual([1, 2]);
  });
});
