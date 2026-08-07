import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SNAPGAUGE_VERSION } from "./version.js";

describe("SNAPGAUGE_VERSION", () => {
  it("matches package.json (snapshots must carry the real version)", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    if (typeof raw !== "object" || raw === null || !("version" in raw)) {
      throw new Error("package.json missing version");
    }
    expect(raw.version).toBe(SNAPGAUGE_VERSION);
  });
});
