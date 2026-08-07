/**
 * Eval stage placeholder (M0). Becomes real at M1 when the first golden
 * cases land (SPEC §7: fixture pair + exact expected finding set, scored by
 * set equality). It exists now so the five-stage CI pipeline (PROGRAM.md D6)
 * is wired from the first commit, and so the eval stage failing later is a
 * signal, not plumbing.
 */
import { describe, expect, it } from "vitest";

describe("eval stage wiring (M0)", () => {
  it("runs in the eval project", () => {
    expect(true).toBe(true);
  });
});
