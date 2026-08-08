"use client";

import { useCallback, useState, type SyntheticEvent } from "react";
import type { AssertionReport, CheckOutput } from "snapgauge";

type LiveCheckResponse = CheckOutput | { ok: false; error: { code: string; message: string } };

function isFailure(value: LiveCheckResponse): value is { ok: false; error: { code: string; message: string } } {
  return "ok" in value;
}

const VERDICT_STYLE: Record<AssertionReport["verdict"], string> = {
  pass: "text-ink/70",
  fail: "text-amber font-semibold",
  warn: "text-amber",
  "n/a": "text-ink/40",
  skipped: "text-ink/40",
};

export function LiveClient() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<LiveCheckResponse | null>(null);

  const submit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus("running");
      setResult(null);
      void (async () => {
        try {
          const response = await fetch("/api/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = (await response.json()) as LiveCheckResponse;
          setResult(data);
        } catch {
          setResult({ ok: false, error: { code: "INTERNAL", message: "network error reaching /api/check" } });
        } finally {
          setStatus("done");
        }
      })();
    },
    [url],
  );

  return (
    <div className="mt-10">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-64">
          <span className="block text-sm font-semibold uppercase tracking-wide text-ink/60">
            MCP server URL
          </span>
          <input
            type="url"
            required
            placeholder="https://mcp.example.com/mcp"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-sm focus:border-ink"
          />
        </label>
        <button
          type="submit"
          disabled={status === "running"}
          className="border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "running" ? "Checking…" : "Check"}
        </button>
      </form>

      <div className="mt-8 min-h-8" aria-live="polite">
        {result !== null &&
          (isFailure(result) ? (
            <p className="border border-amber px-4 py-3 text-sm">
              <strong>{result.error.code}</strong> — {result.error.message}
            </p>
          ) : (
            <div className="space-y-6">
              <p className="text-sm">
                <span className="font-mono">{result.target?.name ?? "target"}</span> — exit code{" "}
                <strong>{result.exitCode}</strong>
                {result.compat !== undefined && <> — era: {result.compat.era}</>}
              </p>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
                  Transport framing (T-group, SPEC §5)
                </h2>
                <div className="mt-2 overflow-x-auto border border-rule">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-rule bg-ink/[0.03] text-left">
                        <th className="px-3 py-2 font-semibold">assertion</th>
                        <th className="px-3 py-2 font-semibold">level</th>
                        <th className="px-3 py-2 font-semibold">verdict</th>
                        <th className="px-3 py-2 font-semibold">detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.assertions ?? []).map((assertion) => (
                        <tr key={assertion.id} className="border-b border-rule last:border-b-0 align-top">
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{assertion.id}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{assertion.level}</td>
                          <td className={`px-3 py-2 whitespace-nowrap ${VERDICT_STYLE[assertion.verdict]}`}>
                            {assertion.verdict}
                          </td>
                          <td className="px-3 py-2">{assertion.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
                  x-mcp-header validity (X-group static, SPEC §5)
                </h2>
                {result.compat !== undefined && result.compat.findings.length > 0 ? (
                  <div className="mt-2 overflow-x-auto border border-rule">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-rule bg-ink/[0.03] text-left">
                          <th className="px-3 py-2 font-semibold">rule</th>
                          <th className="px-3 py-2 font-semibold">subject</th>
                          <th className="px-3 py-2 font-semibold">message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.compat.findings.map((finding) => (
                          <tr key={`${finding.ruleId}-${finding.subject}`} className="border-b border-rule last:border-b-0 align-top">
                            <td className="px-3 py-2 font-mono text-amber whitespace-nowrap">{finding.ruleId}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{finding.subject}</td>
                            <td className="px-3 py-2">{finding.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 border border-rule px-4 py-3 text-sm text-ink/70">
                    No x-mcp-header violations.
                  </p>
                )}
              </section>

              <details className="border border-rule px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium">Raw result JSON</summary>
                <pre className="mt-3 overflow-x-auto font-mono text-xs">{JSON.stringify(result, null, 2)}</pre>
              </details>
            </div>
          ))}
      </div>
    </div>
  );
}
