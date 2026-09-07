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
      <fieldset className="border-0 p-0">
        <legend className="mb-3 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">
          Fixture pair (base: clean@v1)
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {DEMO_PAIRS.map((pair) => {
            const selected = pairId === pair.id;
            return (
              <label
                key={pair.id}
                className={`group relative flex cursor-pointer items-start gap-3 rounded-[var(--radius-brand)] p-4 text-sm transition-[background-color,box-shadow,transform] duration-[var(--dur-fast)] ${
                  selected
                    ? "bg-amber/10 shadow-[var(--edge-top),var(--elev-1)] ring-1 ring-amber/40"
                    : "bg-surface shadow-[var(--edge-top)] hover:bg-surface-2"
                }`}
              >
                <input
                  type="radio"
                  name="pair"
                  value={pair.id}
                  checked={selected}
                  onChange={() => {
                    selectPair(pair.id);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-amber"
                />
                <span className="min-w-0">
                  <span className={`block font-mono ${selected ? "text-ink" : "text-ink-2"}`}>
                    clean@v1 → {pair.label}
                  </span>
                  <span className="mt-1 block leading-snug text-ink-3">{pair.blurb}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={run}
        disabled={status === "running"}
        className="btn btn-primary mt-6 disabled:pointer-events-none disabled:opacity-50"
      >
        {status === "running" ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
            Running…
          </>
        ) : (
          <>
            Run the diff
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </>
        )}
      </button>

      <div className="mt-8 min-h-8" aria-live="polite">
        {result !== null &&
          (result.ok ? (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-brand)] bg-surface p-4 shadow-[var(--edge-top),var(--elev-1)]">
                <span
                  className={`inline-flex size-14 shrink-0 items-center justify-center rounded-[10px] font-mono text-3xl font-medium ${
                    result.exitCode === 0
                      ? "bg-ok/12 text-ok ring-1 ring-ok/30"
                      : "bg-breaking/12 text-breaking ring-1 ring-breaking/30"
                  }`}
                >
                  {result.exitCode}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-3">
                    exit code
                  </span>
                  <span className="mt-1 block text-base font-semibold">
                    {EXIT_LABEL[result.exitCode] ?? String(result.exitCode)}
                  </span>
                  {result.gate !== undefined && (
                    <span className="mt-1 block font-mono text-xs text-ink-3">
                      gate fail-on={result.gate.failOn} · {result.gate.failed ? "FAILED" : "passed"}
                    </span>
                  )}
                </span>
              </div>
              {result.incomplete === true && (
                <p className="mt-3 rounded-[var(--radius-control)] bg-amber/10 px-3.5 py-2.5 text-sm text-amber ring-1 ring-amber/30">
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
            <p className="rounded-[var(--radius-brand)] bg-amber/10 px-4 py-3.5 text-sm ring-1 ring-amber/30">
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
