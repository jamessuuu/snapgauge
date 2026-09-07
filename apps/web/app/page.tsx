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
 *
 * 2026-09-07: the verdict became the hero. It was previously the fourth
 * thing on the page, under a name, a tagline and three buttons; the finding
 * is the only thing on this page a visitor cannot get from the README.
 */
export default async function HomePage() {
  const hero = await computeHeroDiff();
  const emphasized = tierRank(hero.headline.tier) >= tierRank(hero.gateFailOn);

  // The four rungs, as a histogram. A coloured cap rule plus a coloured
  // numeral reads as a scale; a tinted pill behind four short words reads as
  // highlighter pen, which is what the first pass of this looked like.
  const TIERS = [
    { key: "breaking", n: hero.summary.breaking, cap: "bg-breaking", num: "text-breaking" },
    { key: "risky", n: hero.summary.risky, cap: "bg-risky", num: "text-risky" },
    { key: "compatible", n: hero.summary.compatible, cap: "bg-compatible", num: "text-compatible" },
    { key: "cosmetic", n: hero.summary.cosmetic, cap: "bg-surface-3", num: "text-ink-3" },
  ] as const;

  return (
    <main>
      {/* ═══════════════════════════════════════════════════════ HERO ════ */}
      <section className="ambient px-6 pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div className="mx-auto grid max-w-6xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
          <div>
            <p className="eyebrow-chip rise">
              <span className="live-dot" />
              record · diff · gate
            </p>

            <h1 className="display-1 rise rise-1 mt-5">
              A tool vanished from the contract. <span className="text-breaking">CI exits {hero.exitCode}</span>.
            </h1>

            <p className="rise rise-2 mt-5 max-w-xl text-lg leading-relaxed text-ink-2">{SITE.tagline}</p>

            <div className="rise rise-3 mt-7 flex flex-wrap gap-3">
              <Link href="/demo" className="btn btn-primary">
                Run the offline demo
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link href="/live" className="btn btn-ghost">
                Check a live server
              </Link>
            </div>

            <p className="rise rise-4 mt-6 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.8125rem] text-ink-3">
              <span>
                <span className="text-ok">✓</span> fixtures in the repo
              </span>
              <span>
                <span className="text-ok">✓</span> runs offline
              </span>
              <span>
                <span className="text-ok">✓</span> no LLM anywhere
              </span>
            </p>
          </div>

          {/* The verdict, at size: the real engine over the committed
              drift-breaking@v2 pair, computed during `next build`. */}
          <div className="float rise rise-2 overflow-hidden" data-testid="hero-finding">
            <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-surface-2 px-4 py-3 font-mono text-xs tracking-wide text-ink-3">
              <span className="flex gap-[5px]">
                <i className="block size-[9px] rounded-full bg-breaking/55" />
                <i className="block size-[9px] rounded-full bg-surface-3" />
                <i className="block size-[9px] rounded-full bg-surface-3" />
              </span>
              <span>{hero.pairLabel}</span>
              <span className="ml-auto uppercase text-ok">build-time run</span>
            </div>

            {/* Exit code as the readout — the one number CI acts on. */}
            <div className="flex items-center gap-5 px-5 pt-5">
              <div
                className="shrink-0 rounded-[10px] bg-breaking/12 px-4 py-3 text-center ring-1 ring-breaking/30"
                data-testid="hero-exit-code"
              >
                <span className="block font-mono text-[2.6rem] font-medium leading-none tracking-[-0.04em] text-breaking">
                  {hero.exitCode}
                </span>
                <span className="mt-1.5 block font-mono text-[0.62rem] uppercase tracking-[0.1em] text-breaking/80">
                  exit code
                </span>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-ink-3">
                  gate fail-on={hero.gateFailOn}
                </p>
                <p className="mt-1 text-[1.05rem] font-semibold leading-snug">
                  {hero.gateFailed ? "This build would be blocked." : "This build would pass."}
                </p>
                <p className="mt-1 font-mono text-[0.72rem] text-ink-3">
                  {hero.totalFindings} finding{hero.totalFindings === 1 ? "" : "s"} in this diff
                </p>
              </div>
            </div>

            {/* Tier histogram — the product's whole vocabulary in one row. */}
            <div className="grid grid-cols-4 gap-2 px-5 pt-5">
              {TIERS.map((t) => (
                <div
                  key={t.key}
                  className="overflow-hidden rounded-[8px] bg-surface-2 text-center shadow-[var(--edge-top)]"
                >
                  <span className={`block h-[3px] w-full ${t.cap}`} aria-hidden="true" />
                  <span className={`mt-3 block font-mono text-2xl font-medium leading-none ${t.num}`}>{t.n}</span>
                  <span className="mb-3 mt-2 block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-3">
                    {t.key}
                  </span>
                </div>
              ))}
            </div>

            {/* The headline finding, verbatim from the engine. */}
            <div className="mx-5 mt-5 rounded-[10px] bg-surface-2 p-4 shadow-[var(--edge-top)]" data-testid="hero-headline">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={emphasized ? "tier-chip tier-breaking" : "tier-chip tier-cosmetic"}>
                  {hero.headline.tier}
                </span>
                <span className="font-mono text-sm text-ink">{hero.headline.ruleId}</span>
                <span className="font-mono text-xs text-ink-3">{hero.headline.subject}</span>
              </div>
              <p className="mt-2.5 leading-relaxed text-ink-2">{hero.headline.message}</p>
            </div>

            <p className="mt-5 border-t border-rule px-5 py-4 font-mono text-[0.72rem] leading-relaxed text-ink-3">
              A real diff from the committed fixtures.{" "}
              <Link href="/demo" className="underline decoration-rule underline-offset-2 hover:text-amber">
                Run this pair yourself
              </Link>{" "}
              — same engine, in your browser, offline.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════ READOUTS ════ */}
      <section className="border-t border-rule bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
          <div className="px-6 py-8 sm:px-8 sm:py-9">
            <span className="readout-n text-breaking">{hero.summary.breaking}</span>
            <span className="mt-2.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-3">
              breaking
            </span>
            <span className="mt-1 block text-[0.8125rem] leading-snug text-ink-3">a consumer will break</span>
          </div>
          <div className="px-6 py-8 shadow-[inset_1px_0_0_var(--color-rule)] sm:px-8 sm:py-9">
            <span className="readout-n text-risky">{hero.summary.risky}</span>
            <span className="mt-2.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-3">risky</span>
            <span className="mt-1 block text-[0.8125rem] leading-snug text-ink-3">the routing surface moved</span>
          </div>
          <div className="px-6 py-8 shadow-[inset_0_1px_0_var(--color-rule)] md:shadow-[inset_1px_0_0_var(--color-rule)] sm:px-8 sm:py-9">
            <span className="readout-n">37</span>
            <span className="mt-2.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-3">
              diff rules
            </span>
            <span className="mt-1 block text-[0.8125rem] leading-snug text-ink-3">one catalog, generated</span>
          </div>
          <div className="px-6 py-8 shadow-[inset_1px_0_0_var(--color-rule),inset_0_1px_0_var(--color-rule)] md:shadow-[inset_1px_0_0_var(--color-rule)] sm:px-8 sm:py-9">
            <span className="readout-n text-ok">0</span>
            <span className="mt-2.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-3">
              network calls
            </span>
            <span className="mt-1 block text-[0.8125rem] leading-snug text-ink-3">the demo runs offline</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ THE TIER LADDER ════ */}
      <section aria-labelledby="diagram-heading" className="border-t border-rule px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="kicker">the mechanism</p>
          <h2 id="diagram-heading" className="display-2 mt-3">
            How a diff gets a tier
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-2">
            <code className="font-mono text-sm text-ink">snapgauge record</code> writes a snapshot of a server&apos;s
            schema and observed behavior. <code className="font-mono text-sm text-ink">snapgauge check</code> records
            again and sorts every difference onto one of four rungs. The four rungs above are the {HERO_PAIR_LABEL}{" "}
            diff, read four ways.
          </p>

          <div className="panel mt-8 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-rule px-4 py-3 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-3">
              <span className="text-ink-2">generated from the real rule registry</span>
              <span>CI regenerates and diffs it on every push</span>
            </div>
            <div className="overflow-x-auto p-4 sm:p-6">
              <TierLadderDiagram />
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-3">
            <code className="font-mono text-xs text-risky">risky</code> is the rung most diff tools would call
            cosmetic: description and title text is the surface a model routes on, so a rewrite is treated as a
            behavior change. Full catalog (37 rules):{" "}
            <Link href="/docs#diff-taxonomy" className="underline underline-offset-2 hover:text-amber">
              /docs
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════ THE RECORDING ══ */}
      <section aria-labelledby="demo-heading" className="border-t border-rule bg-surface px-6 py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-12">
          <div>
            <p className="kicker">watch it run</p>
            <h2 id="demo-heading" className="display-2 mt-3">
              Not a mockup.
            </h2>
            <p className="mt-4 leading-relaxed text-ink-2">
              Recorded against the deployed site at{" "}
              <a
                href="https://snapgauge.vercel.app/demo"
                className="underline underline-offset-2 hover:text-amber"
              >
                snapgauge.vercel.app/demo
              </a>
              . It picks the {HERO_PAIR_LABEL} pair shown above, runs it, and shows the same tiered findings table and
              exit code.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink-3">
              Text alternative: the recording opens <code className="font-mono text-xs">/demo</code>, selects the{" "}
              <code className="font-mono text-xs">drift-breaking@v2</code> fixture pair, presses Run, and shows the
              resulting findings table — {hero.summary.breaking} breaking and {hero.summary.risky} risky findings,
              exit code {hero.exitCode}. No audio.
            </p>
          </div>
          <div className="panel overflow-hidden p-2">
            <DemoVideo
              src="/demo/snapgauge-demo.webm"
              poster="/demo/snapgauge-poster.png"
              width={1120}
              height={700}
              label={`Recording: selecting the ${HERO_PAIR_LABEL} fixture pair on /demo, running it, and the resulting findings table`}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════ POSITIONING ════ */}
      <section aria-labelledby="positioning-heading" className="border-t border-rule px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="kicker">not a replacement</p>
          <h2 id="positioning-heading" className="display-2 mt-3">
            Complementary to the official conformance suite
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-2">
            The{" "}
            <a href={SITE.officialConformanceUrl} className="underline underline-offset-2 hover:text-amber">
              official MCP conformance suite
            </a>{" "}
            answers whether a server obeys the spec today. snapgauge does not re-implement it — it answers a
            different, narrower question.
          </p>

          <div className="mt-8 grid gap-3 lg:grid-cols-2">
            {POSITIONING_TABLE.map((row) => (
              <div key={row.axis} className="panel panel-hover p-5">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-3">{row.axis}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[8px] bg-surface-2 p-3.5 shadow-[var(--edge-top)]">
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-3">
                      official suite
                    </p>
                    <p className="mt-1.5 text-sm leading-snug text-ink-2">{row.official}</p>
                  </div>
                  <div className="rounded-[8px] bg-amber/10 p-3.5 ring-1 ring-amber/25">
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-amber">snapgauge</p>
                    <p className="mt-1.5 text-sm leading-snug text-ink">{row.snapgauge}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════ EXIT CODES ═════ */}
      <section aria-labelledby="exit-heading" className="border-t border-rule bg-surface px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="kicker">what CI reads</p>
          <h2 id="exit-heading" className="display-2 mt-3">
            Exit codes
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-2">
            <code className="font-mono text-sm text-ink">1</code> vs{" "}
            <code className="font-mono text-sm text-ink">3</code> is deliberate: different owner, different fix.
          </p>

          <div className="panel mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-3">code</th>
                  <th className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-3">
                    meaning
                  </th>
                  <th className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-3">
                    who fixes it
                  </th>
                </tr>
              </thead>
              <tbody>
                {EXIT_CODE_TABLE.map((row) => (
                  <tr key={row.code} className="border-b border-rule align-top last:border-b-0">
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex size-8 items-center justify-center rounded-[6px] font-mono text-sm font-bold ${
                          row.code === 0
                            ? "bg-ok/15 text-ok"
                            : row.code === 1 || row.code === 3
                              ? "bg-breaking/15 text-breaking"
                              : "bg-surface-3 text-ink-2"
                        }`}
                      >
                        {row.code}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-ink">{row.meaning}</td>
                    <td className="px-4 py-3.5 text-ink-3">{row.whoFixesIt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════ INSTALL ════ */}
      <section aria-labelledby="install-heading" className="border-t border-rule px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="kicker">one command</p>
          <h2 id="install-heading" className="display-2 mt-3">
            Install
          </h2>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-10">
            <div className="overflow-hidden rounded-[var(--radius-brand)] bg-paper shadow-[var(--edge-top),var(--elev-2)]">
              <div className="flex items-center gap-2 border-b border-rule bg-surface-2 px-4 py-2.5 font-mono text-[0.72rem] tracking-[0.06em] text-ink-3">
                <i className="block size-[9px] rounded-full bg-surface-3" />
                <i className="block size-[9px] rounded-full bg-surface-3" />
                <i className="block size-[9px] rounded-full bg-surface-3" />
                bash
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-sm leading-[1.85]">
                <code>{SITE.installSnippet}</code>
              </pre>
            </div>

            <div className="panel p-5">
              <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">the shape of it</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">
                A sharp tool: one job, done deterministically. No dashboard, no accounts, no LLM anywhere in the
                product.{" "}
                <Link href="/docs" className="underline underline-offset-2 hover:text-amber">
                  Five-minute quickstart, the snapshot format, failure modes, and limitations
                </Link>{" "}
                are in the docs.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
