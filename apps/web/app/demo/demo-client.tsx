"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FindingsTable } from "@/components/findings-table";
import { DEMO_PAIRS, type DemoPairId } from "@/lib/demo-pairs";
import type { DemoRunResult } from "@/lib/demo-engine";

const EXIT_LABEL: Record<number, string> = {
  0: "0 — clean",
  1: "1 — drift at/above the gate",
  2: "2 — probe failure",
  4: "4 — usage/config/snapshot-format error",
  5: "5 — internal error",
};

const firstPair = DEMO_PAIRS[0];

export function DemoClient() {
  const workerRef = useRef<Worker | null>(null);
  const [pairId, setPairId] = useState<DemoPairId>(firstPair.id);
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<DemoRunResult | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../../src/workers/demo.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<DemoRunResult>) => {
      setResult(event.data);
      setStatus("done");
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
    };
  }, []);

  const run = useCallback(() => {
    setStatus("running");
    setResult(null);
    workerRef.current?.postMessage({ pairId });
  }, [pairId]);

  const selectPair = useCallback((next: DemoPairId) => {
    setPairId(next);
    setStatus("idle");
    setResult(null);
  }, []);

  return (
    <div className="mt-10">
      <fieldset className="border border-rule p-4">
        <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-ink/60">
          Fixture pair (base: clean@v1)
        </legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {DEMO_PAIRS.map((pair) => (
            <label key={pair.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="pair"
                value={pair.id}
                checked={pairId === pair.id}
                onChange={() => {
                  selectPair(pair.id);
                }}
                className="mt-1"
              />
              <span>
                <span className="block font-mono">clean@v1 → {pair.label}</span>
                <span className="block text-ink/60">{pair.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={run}
        disabled={status === "running"}
        className="mt-4 border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "running" ? "Running…" : "Run"}
      </button>

      <div className="mt-8 min-h-8" aria-live="polite">
        {result !== null &&
          (result.ok ? (
            <>
              <p className="text-sm">
                exit code: <strong>{EXIT_LABEL[result.exitCode] ?? String(result.exitCode)}</strong>
                {result.gate !== undefined && (
                  <>
                    {" "}
                    — gate <code className="font-mono">fail-on={result.gate.failOn}</code>{" "}
                    {result.gate.failed ? "FAILED" : "passed"}
                  </>
                )}
              </p>
              {result.incomplete === true && (
                <p className="mt-2 border border-amber px-3 py-2 text-sm text-amber">
                  INCOMPLETE: at least one probe produced no evidence — treated as not passing, never as
                  &quot;no change&quot; (SPEC §6).
                  {result.probeFailures !== undefined && result.probeFailures.length > 0 && (
                    <span className="mt-1 block font-mono text-xs">
                      {result.probeFailures.join("; ")}
                    </span>
                  )}
                </p>
              )}
              <div className="mt-4">
                <FindingsTable findings={result.findings ?? []} gateFailOn={result.gate?.failOn} />
              </div>
            </>
          ) : (
            <p className="border border-amber px-4 py-3 text-sm">
              <strong>exit code {result.exitCode}</strong>
              {result.error !== undefined && (
                <>
                  {" "}
                  — {result.error.code}: {result.error.message}
                </>
              )}
            </p>
          ))}
      </div>
    </div>
  );
}
