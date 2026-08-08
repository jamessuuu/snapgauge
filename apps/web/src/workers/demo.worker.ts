/**
 * The offline demo's Web Worker (SPEC §4/§10 M5): runs the real engine
 * (src/lib/demo-engine.ts, which is itself only the isomorphic "." entry of
 * "snapgauge" + "@snapgauge/fixtures") off the main thread, so the UI stays
 * responsive even though the run is synchronous CPU work. Zero network — the
 * fixture servers are bundled, not fetched.
 *
 * Typed narrowly against the worker's own global scope rather than pulling
 * in the full `WebWorker` lib (which cannot coexist with `DOM` in one
 * tsconfig — see apps/web/tsconfig.json).
 */
import { runDemoPair, type DemoRunResult } from "../lib/demo-engine.js";

export interface DemoWorkerRequest {
  pairId: string;
}

interface WorkerGlobal {
  onmessage: ((event: MessageEvent<DemoWorkerRequest>) => void) | null;
  postMessage: (message: DemoRunResult) => void;
}

const ctx = self as unknown as WorkerGlobal;

ctx.onmessage = (event: MessageEvent<DemoWorkerRequest>) => {
  void runDemoPair(event.data.pairId).then(
    (result) => {
      ctx.postMessage(result);
    },
    (error: unknown) => {
      ctx.postMessage({
        ok: false,
        pairId: event.data.pairId,
        exitCode: 5,
        error: { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) },
      });
    },
  );
};
