import type { Metadata } from "next";
import { DemoClient } from "./demo-client";

export const metadata: Metadata = {
  title: "Offline demo",
  description:
    "Run the real snapgauge engine against bundled fixture MCP servers, entirely offline, in a Web Worker.",
};

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Offline demo</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink/80">
        Picks a fixture pair, records both with the real engine, diffs them, and shows the tiered
        findings and exit code — the same <code className="font-mono text-sm">record</code> +{" "}
        <code className="font-mono text-sm">diff</code> pipeline the CLI runs, executing inside a Web
        Worker in your browser. Nothing here touches the network: the fixture servers are bundled into
        the page, not fetched. This is the primary way to see snapgauge work.
      </p>
      <DemoClient />
    </main>
  );
}
