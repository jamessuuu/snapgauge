import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { interpolateHeaders, loadConfig } from "./config.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snapgauge-config-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const VALID = {
  snapshotDir: ".snapgauge",
  targets: {
    acme: {
      transport: "http",
      url: "https://mcp.acme.com/mcp",
      headers: { Authorization: "Bearer ${ACME_TOKEN}" },
      protocolVersion: "2026-07-28",
      probes: [
        { id: "weather", tool: "get_weather", arguments: { location: "Seattle" }, capture: "shape" },
      ],
      failOn: "risky",
      ignore: ["tool.icons.changed"],
      timeoutMs: 10000,
    },
    local: { transport: "stdio", command: "node", args: ["./server.mjs"] },
    fixture: { transport: "fixture", fixture: "drift-breaking@v2" },
  },
};

describe("config loader (SPEC §4)", () => {
  it("loads the canonical snapgauge.config.json shape", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(VALID), "utf8");
    const loaded = await loadConfig(dir);
    expect(Object.keys(loaded.config.targets)).toEqual(["acme", "local", "fixture"]);
    expect(loaded.snapshotDir).toBe(join(dir, ".snapgauge"));
  });

  it("rejects unknown keys — a config the schema does not model is an error, not a shrug", async () => {
    const dir = tempDir();
    const withUnknown = { ...VALID, sneaky: true };
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(withUnknown), "utf8");
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: "USAGE" });
  });

  it("rejects unknown keys inside a target too", async () => {
    const dir = tempDir();
    const bad = {
      targets: { t: { transport: "http", url: "https://x.example", retries: 3 } },
    };
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(bad), "utf8");
    await expect(loadConfig(dir)).rejects.toMatchObject({ code: "USAGE" });
  });

  it("errors with init guidance when no config exists", async () => {
    await expect(loadConfig(tempDir())).rejects.toMatchObject({
      code: "USAGE",
      message: expect.stringContaining("snapgauge init") as string,
    });
  });

  it("loads a .mjs config via dynamic import (defineConfig path, SPEC §4)", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "snapgauge.config.mjs"),
      `export default { targets: { t: { transport: "fixture", fixture: "clean@v1" } } };\n`,
      "utf8",
    );
    const loaded = await loadConfig(dir);
    expect(loaded.config.targets.t?.transport).toBe("fixture");
  });

  it("json wins over .mjs when both exist (canonical format, SPEC §4)", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "snapgauge.config.json"), JSON.stringify(VALID), "utf8");
    writeFileSync(join(dir, "snapgauge.config.mjs"), `export default {};\n`, "utf8");
    const loaded = await loadConfig(dir);
    expect(loaded.path.endsWith("snapgauge.config.json")).toBe(true);
  });
});

describe("${ENV} interpolation (SPEC §4: ${ENV} only; literals warn)", () => {
  it("substitutes environment variables", () => {
    const { headers, warnings } = interpolateHeaders(
      { Authorization: "Bearer ${TOKEN}" },
      { TOKEN: "s3cret" },
    );
    expect(headers.Authorization).toBe("Bearer s3cret");
    expect(warnings).toEqual([]);
  });

  it("a missing variable is an AUTH failure (exit-2 class), never a silent empty header", () => {
    expect(() => interpolateHeaders({ Authorization: "Bearer ${MISSING}" }, {})).toThrow(
      expect.objectContaining({ code: "AUTH" }) as Error,
    );
  });

  it("a literal credential warns — and the warning never echoes the value", () => {
    const { warnings } = interpolateHeaders(
      { Authorization: "Bearer hunter2-literal" },
      {},
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("literal");
    expect(warnings[0]).not.toContain("hunter2-literal");
  });

  it("non-credential literal headers pass without warning", () => {
    const { warnings } = interpolateHeaders({ Accept: "application/json" }, {});
    expect(warnings).toEqual([]);
  });
});
