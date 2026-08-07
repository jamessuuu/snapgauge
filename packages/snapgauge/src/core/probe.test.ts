import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./diff/diff.js";
import { SnapgaugeError, type ErrorCode } from "./errors.js";
import { canonicalStringify, type Json } from "./json.js";
import type { JsonRpcRequest } from "./jsonrpc.js";
import { MODERN_FULL } from "./profile.js";
import { record, type RecordOptions } from "./probe.js";
import type { ProbeSpec } from "./snapshot/canonical.js";
import type { SnapshotTarget } from "./snapshot/schema.js";
import { createFixtureTransport, type FixtureResponse, type FixtureServer } from "./transport.js";

const TARGET: SnapshotTarget = {
  transport: "fixture",
  host: "inline",
  path: "",
  protocolVersion: "2026-07-28",
  auth: "none",
};
const SPEC: ProbeSpec = { probes: [], profiles: ["modern-full"] };

const DISCOVER: Json = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "inline", version: "1.0.0" },
  ttlMs: 1000,
  cacheScope: "public",
  vendorExtra: { ignored: true }, // wire boundary strips unmodeled keys
};

function ok(request: JsonRpcRequest, result: Json): FixtureResponse {
  return { status: 200, headers: {}, body: { jsonrpc: "2.0", id: request.id, result } };
}

function tool(name: string): Json {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  };
}

/** Two tools observed in non-alphabetical order. */
const simpleServer: FixtureServer = (request) => {
  if (request.method === "server/discover") return ok(request, DISCOVER);
  if (request.method === "tools/list") {
    return ok(request, { tools: [tool("zulu"), tool("alpha")], ttlMs: 1000, cacheScope: "public" });
  }
  return ok(request, {});
};

function recordOptions(overrides?: Partial<RecordOptions>): RecordOptions {
  return {
    transport: createFixtureTransport(simpleServer, MODERN_FULL),
    target: TARGET,
    probeSpec: SPEC,
    recordedAt: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

async function recordSnapshot(overrides?: Partial<RecordOptions>) {
  const outcome = await record(recordOptions(overrides));
  expect(outcome.probeFailures).toEqual([]);
  return outcome.snapshot;
}

async function expectFailure(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof SnapgaugeError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  expect.unreachable(`expected SnapgaugeError(${code})`);
}

describe("record (SPEC §2, §4, §6)", () => {
  it("sorts tools by name in the body while toolsList.order preserves observed order", async () => {
    const snapshot = await recordSnapshot();
    expect(snapshot.tools.map((t) => t.name)).toEqual(["alpha", "zulu"]);
    expect(snapshot.toolsList.order).toEqual(["zulu", "alpha"]);
    expect(snapshot.toolsList.pages).toBe(1);
    expect(snapshot.toolsList.orderStable).toBe(true);
    expect(snapshot.discover.serverInfo).toEqual({ name: "inline", version: "1.0.0" });
    expect(snapshot.discover.capabilities).toEqual({}); // absent on the wire -> {}
    expect(snapshot.discover.ttlMs).toBe(1000);
  });

  it("is deterministic: identical inputs yield byte-identical canonical snapshots", async () => {
    const one = await recordSnapshot();
    const two = await recordSnapshot();
    expect(canonicalStringify(one)).toBe(canonicalStringify(two));
  });

  it("excludes recordedAt from diffs (SPEC §2: metadata)", async () => {
    const one = await recordSnapshot({ recordedAt: "2026-08-08T00:00:00Z" });
    const two = await recordSnapshot({ recordedAt: "2026-08-09T12:34:56Z" });
    expect(diffSnapshots(one, two).findings).toEqual([]);
  });

  it("follows tools/list pagination and records the page count", async () => {
    const paged: FixtureServer = (request) => {
      if (request.method === "server/discover") return ok(request, DISCOVER);
      if (request.method === "tools/list") {
        const cursor = request.params?.cursor;
        if (cursor === undefined) {
          return ok(request, { tools: [tool("first")], nextCursor: "page-2", ttlMs: 1000, cacheScope: "public" });
        }
        expect(cursor).toBe("page-2");
        return ok(request, { tools: [tool("second")], ttlMs: 1000, cacheScope: "public" });
      }
      return ok(request, {});
    };
    const snapshot = await recordSnapshot({ transport: createFixtureTransport(paged, MODERN_FULL) });
    expect(snapshot.tools.map((t) => t.name)).toEqual(["first", "second"]);
    expect(snapshot.toolsList.pages).toBe(2);
  });

  it("marks order unstable when repeated lists disagree (SPEC §6: 3 repeats)", async () => {
    let call = 0;
    const flaky: FixtureServer = (request) => {
      if (request.method === "server/discover") return ok(request, DISCOVER);
      if (request.method === "tools/list") {
        call += 1;
        const tools = call % 2 === 0 ? [tool("alpha"), tool("zulu")] : [tool("zulu"), tool("alpha")];
        return ok(request, { tools, ttlMs: 1000, cacheScope: "public" });
      }
      return ok(request, {});
    };
    const snapshot = await recordSnapshot({ transport: createFixtureTransport(flaky, MODERN_FULL) });
    expect(snapshot.toolsList.orderStable).toBe(false);
  });

  it("classifies a JSON-RPC error response as a probe failure (exit-2 class)", async () => {
    const erroring: FixtureServer = (request) => ({
      status: 200,
      headers: {},
      body: { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "boom" } },
    });
    await expectFailure(
      record(recordOptions({ transport: createFixtureTransport(erroring, MODERN_FULL) })),
      "PROBE_FAILURE",
    );
  });

  it("classifies a malformed result as a probe failure (Zod before interpretation)", async () => {
    const malformed: FixtureServer = (request) => {
      if (request.method === "server/discover") return ok(request, DISCOVER);
      return ok(request, { tools: "not-an-array" });
    };
    await expectFailure(
      record(recordOptions({ transport: createFixtureTransport(malformed, MODERN_FULL) })),
      "PROBE_FAILURE",
    );
  });

  it("classifies a non-200 transport status as a probe failure", async () => {
    const down: FixtureServer = () => ({ status: 503, headers: {}, body: null });
    await expectFailure(
      record(recordOptions({ transport: createFixtureTransport(down, MODERN_FULL) })),
      "PROBE_FAILURE",
    );
  });

  it("applies user volatile selectors to captured Json regions", async () => {
    const withSeed: FixtureServer = (request) => {
      if (request.method === "server/discover") {
        return ok(request, {
          supportedVersions: ["2026-07-28"],
          serverInfo: { name: "inline", version: "1.0.0" },
          capabilities: { sessionSeed: 12345 },
          ttlMs: 1000,
          cacheScope: "public",
        });
      }
      return ok(request, { tools: [tool("alpha")], ttlMs: 1000, cacheScope: "public" });
    };
    const snapshot = await recordSnapshot({
      transport: createFixtureTransport(withSeed, MODERN_FULL),
      volatile: ["discover.capabilities.sessionSeed"],
    });
    expect(snapshot.discover.capabilities.sessionSeed).toBe("<number>");
  });

  it("fails loudly (USAGE) when a volatile selector targets a typed snapshot field", async () => {
    await expectFailure(record(recordOptions({ volatile: ["toolsList.pages"] })), "USAGE");
  });
});

describe("behavior probes (SPEC §2 behavior, §6 failure contract)", () => {
  const SPEC_WITH_PROBES: ProbeSpec = {
    probes: [
      { id: "call-alpha", tool: "alpha", arguments: { q: "x" }, capture: "shape" },
      { id: "call-error", tool: "erroring", arguments: {}, capture: "shape" },
    ],
    profiles: ["modern-full"],
  };

  const behaving: FixtureServer = (request) => {
    if (request.method === "server/discover") return ok(request, DISCOVER);
    if (request.method === "tools/list") {
      return ok(request, { tools: [tool("alpha")], ttlMs: 1000, cacheScope: "public" });
    }
    if (request.method === "tools/call") {
      const name = request.params?.name;
      if (name === "alpha") {
        return ok(request, {
          resultType: "complete",
          content: [{ type: "text", text: "hello world" }],
          structuredContent: { items: [{ id: "a", n: 1 }], requestId: "r-123" },
          _meta: { "vendor/trace": true },
        });
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "bad args" } },
      };
    }
    return ok(request, {});
  };

  it("captures shape, hashes text blocks, and records errors as data", async () => {
    const outcome = await record(
      recordOptions({
        transport: createFixtureTransport(behaving, MODERN_FULL),
        probeSpec: SPEC_WITH_PROBES,
      }),
    );
    expect(outcome.probeFailures).toEqual([]);
    const behavior = outcome.snapshot.behavior;
    if (behavior === undefined) throw new Error("behavior section missing");

    const alpha = behavior["call-alpha"];
    expect(alpha?.isError).toBe(false);
    expect(alpha?.resultType).toBe("complete");
    expect(alpha?.metaKeys).toEqual(["vendor/trace"]);
    // Decision 1: text is stored as a hash, never the text itself.
    const blocks = alpha?.contentBlocks ?? [];
    expect(JSON.stringify(blocks)).not.toContain("hello world");
    expect(JSON.stringify(blocks)).toContain('"sha256"');
    // Shape, not values: structuredContent value "a" must not appear.
    expect(JSON.stringify(alpha?.structuredShape)).not.toContain('"a"');

    const erroring = behavior["call-error"];
    expect(erroring?.isError).toBe(true);
    expect(erroring?.errorCode).toBe(-32602);
  });

  it("is deterministic across runs (byte-identical snapshots with probes)", async () => {
    const opts = () =>
      recordOptions({
        transport: createFixtureTransport(behaving, MODERN_FULL),
        probeSpec: SPEC_WITH_PROBES,
      });
    const one = await record(opts());
    const two = await record(opts());
    expect(canonicalStringify(one.snapshot)).toBe(canonicalStringify(two.snapshot));
  });

  it("marks a transport-failing probe as missing evidence and keeps probing (SPEC §6)", async () => {
    const flaky: FixtureServer = (request) => {
      if (request.method === "tools/call" && request.params?.name === "alpha") {
        return { status: 503, headers: {}, body: null };
      }
      return behaving(request, MODERN_FULL);
    };
    const outcome = await record(
      recordOptions({
        transport: createFixtureTransport(flaky, MODERN_FULL),
        probeSpec: SPEC_WITH_PROBES,
      }),
    );
    expect(outcome.probeFailures.map((f) => f.probeId)).toEqual(["call-alpha"]);
    // The remaining probe still ran and captured its behavior.
    expect(outcome.snapshot.behavior?.["call-error"]?.errorCode).toBe(-32602);
    expect(outcome.snapshot.behavior?.["call-alpha"]).toBeUndefined();
  });

  it("capture values normalizes built-in volatile keys instead of storing them", async () => {
    const outcome = await record(
      recordOptions({
        transport: createFixtureTransport(behaving, MODERN_FULL),
        probeSpec: {
          probes: [{ id: "v", tool: "alpha", arguments: {}, capture: "values" }],
          profiles: ["modern-full"],
        },
      }),
    );
    const captured = outcome.snapshot.behavior?.v;
    expect(captured?.structuredContent?.requestId).toBe("<string>");
    expect(JSON.stringify(captured?.contentBlocks)).toContain("hello world");
  });
});
