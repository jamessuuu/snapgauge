import Link from "next/link";
import { tierRank } from "snapgauge";
import { DemoVideo } from "@/components/demo-video";
import { TierLadderDiagram } from "@/components/tier-ladder-diagram";
import { computeHeroDiff, HERO_PAIR_LABEL } from "@/lib/hero-diff";
import { EXIT_CODE_TABLE, POSITIONING_TABLE, SITE } from "@/lib/site";

/**
 * `/` — the landing page (SPEC §4/§9/§10, DESIGN-DIRECTION.md's evidence-
 * density order: claim -> proof -> escape hatch, repeated per section). An
 * `async` server component reading fixture data at build time is still
 * static generation — no client fetch, no function needed at request time
 * (D3, PROGRAM.md) — `computeHeroDiff()` and `<TierLadderDiagram>` both run
 * once during `next build`, exactly like the rest of this file.
 */
export default async function HomePage() {
  const hero = await computeHeroDiff();
  const emphasized = tierRank(hero.headline.tier) >= tierRank(hero.gateFailOn);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      {/* ---------------------------------------------------------------- */}
      {/* 1. Hero: name, one-line claim, a real diff rendered at size       */}
      {/* ---------------------------------------------------------------- */}
      <header className="mb-14">
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
          <Link
            href="/docs"
            className="inline-block border border-rule px-4 py-2 text-sm font-medium hover:border-ink"
          >
            Docs
          </Link>
        </div>

        <div className="mt-8 border border-rule" data-testid="hero-finding">
          <div className="border-b border-rule bg-ink/[0.03] px-4 py-2 text-sm">
            <span className="font-mono">{hero.pairLabel}</span>
            <span className="text-ink/60"> — a real diff, from the committed fixtures, computed at build time</span>
          </div>
          <div className="px-4 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={
                  emphasized ? "text-sm font-semibold uppercase tracking-wide text-amber" : "text-sm font-semibold uppercase tracking-wide"
                }
              >
                {hero.headline.tier}
              </span>
              <span className="font-mono text-sm">{hero.headline.ruleId}</span>
              <span className="font-mono text-xs text-ink/60">{hero.headline.subject}</span>
            </div>
            <p className="mt-2 leading-relaxed">{hero.headline.message}</p>
            <p className="mt-4 border-t border-rule pt-3 text-sm text-ink/70">
              {hero.totalFindings} finding{hero.totalFindings === 1 ? "" : "s"} in this diff ({hero.summary.breaking}{" "}
              breaking, {hero.summary.risky} risky, {hero.summary.compatible} compatible, {hero.summary.cosmetic}{" "}
              cosmetic) — gate <code className="font-mono">fail-on={hero.gateFailOn}</code>{" "}
              {hero.gateFailed ? "FAILED" : "passed"}, CI would exit{" "}
              <strong className="text-ink">{hero.exitCode}</strong>.{" "}
              <Link href="/demo" className="underline underline-offset-2 hover:text-amber">
                Run this pair yourself
              </Link>
              .
            </p>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* 2. The mechanism diagram                                         */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="diagram-heading" className="mb-14">
        <h2 id="diagram-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          How a diff gets a tier
        </h2>
        <p className="mt-3 leading-relaxed">
          <code className="font-mono text-sm">snapgauge record</code> writes a snapshot of a server&apos;s schema and
          observed behavior. <code className="font-mono text-sm">snapgauge check</code> records again and classifies
          every difference into one of four tiers. The rung each of the four findings above landed on is real — the
          same {HERO_PAIR_LABEL} diff, read four ways.
        </p>
        <div className="mt-5 overflow-x-auto">
          <TierLadderDiagram />
        </div>
        <p className="mt-3 text-sm text-ink/70">
          <code className="font-mono text-xs">risky</code> is the one tier most diff tools would call cosmetic:
          description and title text is the surface a model routes on, so a rewrite is treated as a behavior change.
          Full catalog (37 rules): <Link href="/docs#diff-taxonomy" className="underline underline-offset-2 hover:text-amber">/docs</Link>.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 3. The demo recording                                            */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="demo-heading" className="mb-14">
        <h2 id="demo-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Watch it run
        </h2>
        <p className="mt-3 leading-relaxed">
          Recorded against the deployed site at{" "}
          <a href="https://snapgauge.vercel.app/demo" className="underline underline-offset-2 hover:text-amber">
            snapgauge.vercel.app/demo
          </a>{" "}
          — not a mockup. It picks the {HERO_PAIR_LABEL} pair shown above, runs it, and shows the same tiered
          findings table and exit code.
        </p>
        <div className="mt-5">
          <DemoVideo
            src="/demo/snapgauge-demo.webm"
            poster="/demo/snapgauge-poster.png"
            width={1120}
            height={700}
            label={`Recording: selecting the ${HERO_PAIR_LABEL} fixture pair on /demo, running it, and the resulting findings table`}
          />
        </div>
        <p className="mt-3 text-sm text-ink/70">
          Text alternative: the recording opens <code className="font-mono text-xs">/demo</code>, selects the{" "}
          <code className="font-mono text-xs">drift-breaking@v2</code> fixture pair, presses Run, and shows the
          resulting findings table — {hero.summary.breaking} breaking and {hero.summary.risky} risky findings, exit
          code {hero.exitCode}. No audio.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 4. Complementary-to-official positioning table                   */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="positioning-heading" className="mb-14">
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

      {/* ---------------------------------------------------------------- */}
      {/* 5. Exit codes, with who fixes it                                 */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="exit-heading" className="mb-14">
        <h2 id="exit-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Exit codes
        </h2>
        <p className="mt-3 leading-relaxed">
          <code className="font-mono text-sm">1</code> vs <code className="font-mono text-sm">3</code> is
          deliberate: different owner, different fix.
        </p>
        <div className="mt-4 overflow-x-auto border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-semibold">code</th>
                <th className="px-3 py-2 font-semibold">meaning</th>
                <th className="px-3 py-2 font-semibold">who fixes it</th>
              </tr>
            </thead>
            <tbody>
              {EXIT_CODE_TABLE.map((row) => (
                <tr key={row.code} className="border-b border-rule last:border-b-0 align-top">
                  <td className="px-3 py-2 font-mono">{row.code}</td>
                  <td className="px-3 py-2">{row.meaning}</td>
                  <td className="px-3 py-2 text-ink/70">{row.whoFixesIt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 6. Install + the exact command                                   */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="install-heading">
        <h2 id="install-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Install
        </h2>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{SITE.installSnippet}</code>
        </pre>
        <p className="mt-3 leading-relaxed text-ink/80">
          A sharp tool: one job, done deterministically. No dashboard, no accounts, no LLM anywhere in the product.{" "}
          <Link href="/docs" className="underline underline-offset-2 hover:text-amber">
            Five-minute quickstart, the snapshot format, failure modes, and limitations
          </Link>{" "}
          are in the docs.
        </p>
      </section>
    </main>
  );
}
