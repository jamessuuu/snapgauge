import { describe, expect, it } from "vitest";
import { canonicalStringify, jcsCanonical } from "./json.js";

describe("canonicalStringify (SPEC §2 Decision 2)", () => {
  it("sorts keys lexicographically at every depth, 2-space indent, LF, trailing newline", () => {
    const text = canonicalStringify({ b: 1, a: { d: 2, c: 3 } });
    expect(text).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
    expect(text.includes("\r")).toBe(false);
  });

  it("sorts numeric-looking keys lexicographically, not numerically", () => {
    // JSON.stringify would enumerate {"10":…,"2":…} as 2,10; the format says
    // lexicographic — "10" < "2".
    const text = canonicalStringify({ "2": "two", "10": "ten" });
    expect(text.indexOf('"10"')).toBeLessThan(text.indexOf('"2"'));
  });

  it("preserves array order (arrays are sorted upstream by the snapshot builder, not here)", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[\n  3,\n  1,\n  2\n]\n");
  });

  it("renders empty containers compactly", () => {
    expect(canonicalStringify({})).toBe("{}\n");
    expect(canonicalStringify([])).toBe("[]\n");
    expect(canonicalStringify({ a: [] })).toBe('{\n  "a": []\n}\n');
  });

  it("round-trips through JSON.parse", () => {
    const value = { z: [1, "two", null, { nested: true }], a: 0.5 };
    expect(JSON.parse(canonicalStringify(value))).toEqual(value);
  });

  it("omits undefined object properties (absent, not null)", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{\n  "a": 1\n}\n');
  });

  it("rejects values JSON cannot round-trip, loudly", () => {
    expect(() => canonicalStringify([1, undefined])).toThrow(/undefined in array/);
    expect(() => canonicalStringify({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalStringify({ f: () => 0 })).toThrow(/unsupported function/);
  });
});

describe("jcsCanonical", () => {
  it("is compact with sorted keys (hash input form)", () => {
    expect(jcsCanonical({ b: "x", a: [1, 2] })).toBe('{"a":[1,2],"b":"x"}');
  });

  it("is insertion-order independent", () => {
    const one = jcsCanonical({ a: 1, b: 2 });
    const two = jcsCanonical({ b: 2, a: 1 });
    expect(one).toBe(two);
  });

  it("escapes strings per JSON", () => {
    expect(jcsCanonical({ s: 'quote " and \\ backslash' })).toBe(
      '{"s":"quote \\" and \\\\ backslash"}',
    );
  });
});
