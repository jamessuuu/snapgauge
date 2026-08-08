import Link from "next/link";
import { LIMITATIONS, POSITIONING_TABLE, SITE } from "@/lib/site";

/**
 * `/` — the static landing page (SPEC §4/§9/§10). MUST render fully with JS
 * disabled and with every Vercel function paused (D3, PROGRAM.md): this is a
 * plain server component with no client data fetching, so it is statically
 * generated at build time — no function needs to run for this page to serve.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <div className="flex items-center gap-4">
          <img src="/brand/glyph.svg" alt="" width={48} height={48} aria-hidden="true" />
          <h1 className="text-3xl font-semibold tracking-tight">{SITE.name}</h1>
        </div>
        <p className="mt-4 max-w-xl text-lg text-ink/80">{SITE.tagline}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="inline-block border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper"
          >
            Run the offline demo
          </Link>
          <Link
            href="/live"
            className="inline-block border border-rule px-4 py-2 text-sm font-medium hover:border-ink"
          >
            Check a live server
          </Link>
        </div>
      </header>

      <section aria-labelledby="install-heading" className="mb-12">
        <h2 id="install-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Install
        </h2>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{SITE.installSnippet}</code>
        </pre>
      </section>

      <section aria-labelledby="what-heading" className="mb-12">
        <h2 id="what-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          What it does
        </h2>
        <p className="mt-3 leading-relaxed">
          <code className="font-mono text-sm">snapgauge record</code> probes an MCP server and writes
          a snapshot of its schema and observable behavior —{" "}
          <code className="font-mono text-sm">.snapgauge/&lt;target&gt;.snapshot.json</code>, committed
          to your repo. <code className="font-mono text-sm">snapgauge check</code> probes the server
          again on every CI run, diffs it against the stored snapshot, classifies every difference into
          one of four tiers (breaking, risky, compatible, cosmetic), and fails the build when something
          at or above your gate moved. A second surface — the compat engine — replays the same probes
          under reduced client-capability profiles (SPEC's D-group) to catch servers that degrade
          incorrectly, or lie about what version they support.
        </p>
        <p className="mt-3 leading-relaxed">
          Deterministic. Offline-capable (see <Link href="/demo" className="underline underline-offset-2 hover:text-amber">/demo</Link>).
          Zero LLM calls anywhere in the product, at any traffic level.
        </p>
      </section>

      <section aria-labelledby="positioning-heading" className="mb-12">
        <h2 id="positioning-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Complementary to the official conformance suite
        </h2>
        <p className="mt-3 leading-relaxed">
          The{" "}
          <a
            href={SITE.officialConformanceUrl}
            className="underline underline-offset-2 hover:text-amber"
          >
            official MCP conformance suite
          </a>{" "}
          answers whether a server obeys the spec today. snapgauge does not re-implement it — it answers
          a different, narrower question.
        </p>
        <div className="mt-4 overflow-x-auto border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-semibold"></th>
                <th className="px-3 py-2 font-semibold">official conformance suite</th>
                <th className="px-3 py-2 font-semibold">snapgauge</th>
              </tr>
            </thead>
            <tbody>
              {POSITIONING_TABLE.map((row) => (
                <tr key={row.axis} className="border-b border-rule last:border-b-0 align-top">
                  <th scope="row" className="px-3 py-2 font-medium text-ink/70 whitespace-nowrap">
                    {row.axis}
                  </th>
                  <td className="px-3 py-2">{row.official}</td>
                  <td className="px-3 py-2">{row.snapgauge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="tier-heading" className="mb-12">
        <h2 id="tier-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Tier
        </h2>
        <p className="mt-3 leading-relaxed">
          This is a <strong className="text-ink">sharp tool</strong>: one job, done deterministically,
          not a flagship product. It has no dashboard, no team plan, no LLM-assisted anything. If you
          need contract tests for an MCP server's schema and behavior across releases, this is built for
          exactly that and nothing more.
        </p>
      </section>

      <section aria-labelledby="limitations-heading">
        <h2 id="limitations-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Limitations
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          {LIMITATIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
