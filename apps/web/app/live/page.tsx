import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { LiveClient } from "./live-client";

export const metadata: Metadata = {
  title: "Live check",
  description: "Audit a real MCP server's discovery surface — read-only, SSRF-guarded, rate-limited.",
};

export default function LivePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Live check</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink/80">
        Probes a real, public MCP server you name: <code className="font-mono text-sm">server/discover</code>{" "}
        and <code className="font-mono text-sm">tools/list</code> only. It never calls{" "}
        <code className="font-mono text-sm">tools/call</code>, never accepts a bearer token, and never
        stores the result or the URL you enter — see{" "}
        <a
          href={`${SITE.repoUrl}/blob/main/SECURITY.md`}
          className="underline underline-offset-2 hover:text-amber"
        >
          SECURITY.md
        </a>{" "}
        for the full threat model. This audits framing conformance to the 2026-07-28 revision and{" "}
        <code className="font-mono text-sm">x-mcp-header</code> validity — not tool behavior or
        degradation, which need declared tool calls this hosted demo will not make on your behalf.
      </p>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink/80">
        Rate-limited and capped (≤40 requests, ≤20s, ≤1&nbsp;MB per check). If a check is refused or the
        service is paused, <a href="/demo" className="underline underline-offset-2 hover:text-amber">/demo</a> always
        works — it runs the same engine offline, with zero caps.
      </p>
      <LiveClient />
    </main>
  );
}
