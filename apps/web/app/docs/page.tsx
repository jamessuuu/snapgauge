import type { Metadata } from "next";
import Link from "next/link";
import { RULE_CATALOG } from "@/generated/rules-catalog";
import { EXIT_CODE_TABLE, LIMITATIONS, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Install, a five-minute quickstart, the snapshot format, the diff taxonomy, compat/degradation checks, the board, CI integration, failure modes, and limitations.",
};

const TOC = [
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Five-minute quickstart" },
  { id: "snapshot-format", label: "Snapshot format" },
  { id: "diff-taxonomy", label: "Diff taxonomy" },
  { id: "compat", label: "Compat + degradation checks" },
  { id: "board", label: "The board" },
  { id: "ci", label: "CI integration" },
  { id: "failure-modes", label: "Failure modes" },
  { id: "limitations", label: "Limitations" },
] as const;

const TIER_ORDER = ["breaking", "risky", "compatible", "cosmetic"] as const;

const FAILURE_MODES = [
  {
    situation: "Target unreachable, TLS failure, or timeout",
    contract: "Exit 2. No snapshot written, no partial diff. check never writes a snapshot.",
  },
  {
    situation: "Target returns 5xx mid-probe",
    contract:
      "That probe is marked error; remaining probes still run. The result carries incomplete: true — missing evidence is never treated as \"no change\" (exit 2).",
  },
  {
    situation: "Server is non-deterministic (list order or values churn)",
    contract:
      "3 repeats per list; disagreement becomes order.nondeterministic (risky) instead of a false breaking. Value churn is why shape-capture is the default.",
  },
  {
    situation: "probeSpecHash changed since the stored snapshot",
    contract: "Exit 4 — \"config changed; re-record.\" Never a silent partial comparison.",
  },
  {
    situation: "Stored snapshot's formatVersion is newer than this binary",
    contract: "Exit 4 with the required version. An older formatVersion migrates only with --migrate.",
  },
  {
    situation: "Auth token missing or expired",
    contract: "Exit 2, classified auth. The token is never written to the snapshot or the log.",
  },
  {
    situation: "Redirect on the MCP endpoint",
    contract: "Not followed. Recorded as a transport.redirect finding, not a hop.",
  },
  {
    situation: "Response over 256 KB, or a snapshot over 1 MB",
    contract: "Truncated, marked truncated: true — that probe cannot produce a breaking finding (evidence is incomplete).",
  },
  {
    situation: "stdio server hangs or dies",
    contract: "10s per-request timeout, SIGKILL on teardown, exit 2. No orphan processes.",
  },
  {
    situation: "Hosted /live: target refused by the SSRF policy",
    contract: "400 TARGET_NOT_ALLOWED with the reason class only — never the resolved address.",
  },
  {
    situation: "Hosted /live: rate limit or cost cap hit",
    contract: "429, or the service is paused with a banner — /demo always still works (offline, zero caps, same engine).",
  },
  {
    situation: "Board job fails or GitHub auto-disables it (60-day rule)",
    contract: "/board shows a dead-man banner once the newest boards/*.json is more than 10 days old, dated. Never presented as current.",
  },
] as const;

const COMPAT_ROWS = [
  { id: "compat.era", class: "info", note: "modern-only | dual | legacy, from a modern-then-initialize probe." },
  {
    id: "compat.version_advertised_unsupported",
    class: "violation",
    note: "A version listed in discover.supportedVersions fails a plain tools/list — the server is lying about support.",
  },
  {
    id: "compat.set_varies_per_connection",
    class: "violation",
    note: "Same profile, two fresh connections, different tool set (MUST NOT).",
  },
  {
    id: "degrade.wrong_error",
    class: "violation",
    note: "Under a reduced profile a call must succeed or fail with -32021 naming exactly the missing capabilities. A 500, a generic error, a hang, or a text blob is a violation.",
  },
  {
    id: "degrade.over_declared",
    class: "violation",
    note: "-32021 names a capability the tool never actually exercises under modern-full — gating at request entry instead of at use.",
  },
  {
    id: "degrade.silent",
    class: "risky",
    note: "A complete result under a reduced profile that differs in shape from modern-full with no signal at all. Permitted by the spec — reported, not failed. This is what the board exists to publish.",
  },
  {
    id: "degrade.reported",
    class: "info",
    note: "The good citizen: the result degrades under the reduced profile AND says so via the degradation marker.",
  },
  {
    id: "xhdr.not_statically_reachable",
    class: "violation",
    note: "An x-mcp-header binding sits behind items/oneOf/anyOf/allOf/$ref instead of a plain properties chain — invisible to conforming clients.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink/80">
        Everything below is grounded in the committed spec (
        <a href={`${SITE.repoUrl}/blob/main/docs/SPEC.md`} className="underline underline-offset-2 hover:text-amber">
          docs/SPEC.md
        </a>
        ) and the rule registry (
        <a href={`${SITE.repoUrl}/blob/main/docs/RULES.md`} className="underline underline-offset-2 hover:text-amber">
          docs/RULES.md
        </a>
        ), not restated from memory.
      </p>

      <nav aria-label="On this page" className="mt-8 border border-rule p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">On this page</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {TOC.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="underline underline-offset-2 hover:text-amber">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="install-h" id="install" className="mt-12">
        <h2 id="install-h" className="text-xl font-semibold tracking-tight">
          <a href="#install" className="hover:text-amber">
            Install
          </a>
        </h2>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{`npx snapgauge@1 init --url https://mcp.example.com/mcp   # or --command / --fixture
npx snapgauge@1 record                                    # writes .snapgauge/<target>.snapshot.json
npx snapgauge@1 check                                      # probe live -> diff vs stored -> gate -> exit code`}</code>
        </pre>
        <p className="mt-3 leading-relaxed text-ink/80">
          As a GitHub Action, against a snapshot already committed to your repo:
        </p>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{`- uses: jamessuuu/snapgauge@v1
  with:
    config: snapgauge.config.json   # default
    fail-on: risky                  # default (SPEC §5)`}</code>
        </pre>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="quickstart-h" id="quickstart" className="mt-12">
        <h2 id="quickstart-h" className="text-xl font-semibold tracking-tight">
          <a href="#quickstart" className="hover:text-amber">
            Five-minute quickstart
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          The fastest way to see the engine work with nothing installed:{" "}
          <Link href="/demo" className="underline underline-offset-2 hover:text-amber">
            /demo
          </Link>{" "}
          runs the real engine against fixture servers bundled into the page, entirely offline, in a Web
          Worker.
        </p>
        <p className="mt-3 leading-relaxed">
          To run it on your own machine against a real MCP server, clone the repo — the CLI is not yet
          published (see the README status banner) — and record twice, then diff:
        </p>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{`git clone ${SITE.repoUrl}
cd snapgauge && pnpm install && pnpm --filter snapgauge build

# record a baseline against a bundled fixture server (no MCP server of your own required)
node packages/snapgauge/dist/cli/index.js record demo --fixture clean@v1 --dir /tmp/snapgauge-demo

# record a "next release" of the same server — one tool removed, one new required argument
node packages/snapgauge/dist/cli/index.js record demo-v2 --fixture drift-breaking@v2 --dir /tmp/snapgauge-demo

# diff them — offline, no network
node packages/snapgauge/dist/cli/index.js diff /tmp/snapgauge-demo/demo.snapshot.json /tmp/snapgauge-demo/demo-v2.snapshot.json`}</code>
        </pre>
        <p className="mt-3 text-sm text-ink/70">This is the actual, verified output of that last command:</p>
        <pre className="mt-2 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-xs leading-relaxed">
          <code>{`breaking   tool.input.required.added          tools.get_weather.inputSchema.required.date — input "date" is now required — a client recorded against the old contract does not send it
breaking   tool.removed                       tools.archive_note — tool "archive_note" was removed — a client holding the old contract will fail
risky      tool.description.changed           tools.get_weather.description — description changed — the trigger surface a model routes on (SPEC §5: risky, not cosmetic)
compatible tool.input.optional.added          tools.list_notes.inputSchema.properties.cursor — optional input "cursor" was added
cosmetic   serverInfo.version.changed         discover.serverInfo.version — serverInfo.version changed
cosmetic   tool.icons.changed                 tools.get_weather.icons — icons changed
6 findings (2 breaking, 1 risky, 1 compatible, 2 cosmetic); gate fail-on=risky -> DRIFT (exit 1)`}</code>
        </pre>
        <p className="mt-3 leading-relaxed">
          Exit code 1: two findings (breaking and risky) are at or above the default gate. Fixing this
          means one of two things — the consumer decides the drift was intentional and runs{" "}
          <code className="font-mono text-sm">check --update</code> to accept the new snapshot, or the
          server owner reverts the change. See{" "}
          <a href="#failure-modes" className="underline underline-offset-2 hover:text-amber">
            failure modes
          </a>{" "}
          below for the full exit-code table.
        </p>
        <p className="mt-3 leading-relaxed">
          Once published, replace the fixture shortcut above with a real target:{" "}
          <code className="font-mono text-sm">npx snapgauge@1 init --url https://your-server/mcp</code> writes{" "}
          <code className="font-mono text-sm">snapgauge.config.json</code>, then{" "}
          <code className="font-mono text-sm">record</code> and <code className="font-mono text-sm">check</code>{" "}
          run the identical pipeline against it.
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="snapshot-format-h" id="snapshot-format" className="mt-12">
        <h2 id="snapshot-format-h" className="text-xl font-semibold tracking-tight">
          <a href="#snapshot-format" className="hover:text-amber">
            Snapshot format
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          One file per target, committed to your repo:{" "}
          <code className="font-mono text-sm">.snapgauge/&lt;target&gt;.snapshot.json</code>. It records{" "}
          <code className="font-mono text-sm">discover</code> (supported versions, capabilities,
          serverInfo, instructions, cache hints), every <code className="font-mono text-sm">tool</code>{" "}
          (schema, annotations, icons, x-mcp-header bindings), resources, prompts, the observed{" "}
          <code className="font-mono text-sm">behavior</code> of any probes you declared, and the T-group
          transport assertion results.
        </p>
        <p className="mt-3 leading-relaxed">
          <strong className="text-ink">Shape, not values, by default.</strong> A probed call&apos;s response
          is stored as a recursive type sketch — keys sorted, array element types unioned — not the actual
          values. Text content is stored as <code className="font-mono text-sm">{"{ type: \"text\", sha256 }"}</code>.
          This is deliberate: shape-capture is what makes a snapshot safe to commit (it cannot leak a real
          customer&apos;s data out of a tool response) and stable against servers that return live data —
          weather, timestamps, ids. <code className="font-mono text-sm">capture: &quot;values&quot;</code> is
          opt-in per probe, for fixtures and for tools you know are deterministic.
        </p>
        <p className="mt-3 leading-relaxed">
          Canonicalization is part of the format: keys sorted lexicographically, 2-space indent, a trailing
          newline — chosen for git-diff legibility over byte-canonical JCS (hashes are computed separately,
          over JCS bytes, for comparison). A snapshot is only ever comparable to itself:{" "}
          <code className="font-mono text-sm">probeSpecHash</code> (a hash of the target&apos;s declared
          probes) must match between two snapshots being diffed, or the run exits 4 rather than producing a
          silent partial comparison.
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="diff-taxonomy-h" id="diff-taxonomy" className="mt-12">
        <h2 id="diff-taxonomy-h" className="text-xl font-semibold tracking-tight">
          <a href="#diff-taxonomy" className="hover:text-amber">
            Diff taxonomy
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          Every difference between two snapshots is classified into exactly one of four tiers, direction-aware
          (old → new). The default gate is <code className="font-mono text-sm">fail-on: risky</code> —
          breaking and risky findings fail CI; compatible and cosmetic ones do not.
        </p>
        <p className="mt-3 leading-relaxed">
          <strong className="text-ink">Descriptions and titles are risky, not cosmetic.</strong> Most diff
          tools would call a text rewrite cosmetic. This one does not: a tool&apos;s description and title
          are the trigger surface a model routes on when deciding which tool to call — rewrite the wording
          and an agent&apos;s behavior can change even though the schema did not move a single byte.
        </p>
        <div className="mt-5 space-y-6">
          {TIER_ORDER.map((tier) => (
            <div key={tier}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
                {tier} ({RULE_CATALOG[tier].length})
              </h3>
              <div className="mt-2 overflow-x-auto border border-rule">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-ink/[0.03] text-left">
                      <th className="px-3 py-2 font-semibold">rule id</th>
                      <th className="px-3 py-2 font-semibold">what it means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RULE_CATALOG[tier].map((rule) => (
                      <tr key={rule.id} className="border-b border-rule last:border-b-0 align-top">
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{rule.id}</td>
                        <td className="px-3 py-2">{rule.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="compat-h" id="compat" className="mt-12">
        <h2 id="compat-h" className="text-xl font-semibold tracking-tight">
          <a href="#compat" className="hover:text-amber">
            Compat + degradation checks
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          The official conformance suite answers whether a server obeys the 2026-07-28 revision right now.
          It does not check whether the server still works with a client one version back, whether it
          degrades correctly when a client declares fewer capabilities, or whether it is honest about which
          protocol versions it actually supports. That surface is what the compat engine covers.
        </p>
        <p className="mt-3 leading-relaxed">
          A <strong className="text-ink">profile</strong> is (protocol version, client capabilities,
          extensions, header behavior). Built-ins include <code className="font-mono text-sm">modern-full</code>
          , <code className="font-mono text-sm">modern-minimal</code> (no extensions declared — the critical
          one), and legacy/no-capability variants. Every declared probe is replayed under every profile, and
          the response is scored per (tool × profile):{" "}
          <code className="font-mono text-sm">ok | declined-correctly | degraded-reported | degraded-silent | violation</code>.
          Any <code className="font-mono text-sm">violation</code> exits 3 — the server is wrong, not merely
          different, which is a different owner and a different fix than exit 1.
        </p>
        <div className="mt-4 overflow-x-auto border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-semibold">rule id</th>
                <th className="px-3 py-2 font-semibold">class</th>
                <th className="px-3 py-2 font-semibold">what it means</th>
              </tr>
            </thead>
            <tbody>
              {COMPAT_ROWS.map((row) => (
                <tr key={row.id} className="border-b border-rule last:border-b-0 align-top">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{row.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.class}</td>
                  <td className="px-3 py-2">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink/70">
          Full T-group (transport framing) and X-group (x-mcp-header validity) catalogs — 20 and 9 rule ids
          respectively — are in{" "}
          <a href={`${SITE.repoUrl}/blob/main/docs/RULES.md`} className="underline underline-offset-2 hover:text-amber">
            docs/RULES.md
          </a>
          .
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="board-h" id="board" className="mt-12">
        <h2 id="board-h" className="text-xl font-semibold tracking-tight">
          <a href="#board" className="hover:text-amber">
            The board
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          <Link href="/board" className="underline underline-offset-2 hover:text-amber">
            /board
          </Link>{" "}
          publishes a refreshed, public read of 8–12 named MCP servers: era (modern-only / dual / legacy),
          advertised protocol versions, the T-group framing assertions, cache-hint presence, x-mcp-header
          validity, and the D-group checks reachable without <code className="font-mono text-sm">tools/call</code>
          . Unauthenticated and read-only — a server that requires auth is a row marked{" "}
          <code className="font-mono text-sm">not tested (auth required)</code>, never guessed. A GitHub
          Actions job refreshes it weekly and commits <code className="font-mono text-sm">boards/&lt;date&gt;.json</code>
          ; the commit history is the durable, un-fakeable record.
        </p>
        <p className="mt-3 leading-relaxed">
          <strong className="text-ink">Disclosure policy.</strong> For any MUST-level violation, an
          upstream issue is filed first and the row records <code className="font-mono text-sm">reportedAt</code>
          ; publication follows at least 7 days later (<code className="font-mono text-sm">publishedAt</code>
          ). Findings are stated as neutral observations — &quot;returns 200 on GET; the revision says
          405&quot; — never as scores, grades, or security claims.
        </p>
        <p className="mt-3 leading-relaxed text-ink/80">
          <code className="font-mono text-sm">boards/roster.json</code> ships empty on purpose: which
          public servers belong on the board is a decision, not a default, so the page shows the honest
          empty state until that decision is made.
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="ci-h" id="ci" className="mt-12">
        <h2 id="ci-h" className="text-xl font-semibold tracking-tight">
          <a href="#ci" className="hover:text-amber">
            CI integration
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">
          <code className="font-mono text-sm">action.yml</code> is a composite GitHub Action. It runs{" "}
          <code className="font-mono text-sm">snapgauge check --json</code> against your committed config
          and snapshot, then reuses <code className="font-mono text-sm">snapgauge report</code> — the same
          pure reformatter the CLI itself uses — to turn the saved result into GitHub Actions annotations
          (<code className="font-mono text-sm">::error::</code> / <code className="font-mono text-sm">::warning::</code>{" "}
          per finding) and a job-summary markdown table. No second live check runs to build the summary.
        </p>
        <pre className="mt-3 overflow-x-auto border border-rule bg-paper px-4 py-3 font-mono text-sm">
          <code>{`- uses: jamessuuu/snapgauge@v1
  with:
    config: snapgauge.config.json   # default
    fail-on: risky                  # default
    # target: my-server             # only needed when the config has more than one`}</code>
        </pre>
        <p className="mt-3 leading-relaxed">
          Output: <code className="font-mono text-sm">exit-code</code>, the same value{" "}
          <code className="font-mono text-sm">snapgauge check</code> would exit with locally. A finding&apos;s
          location is a JSON path into the target&apos;s schema (e.g.{" "}
          <code className="font-mono text-sm">tools.get_weather.description</code>), never a source file
          position — the action does not fabricate one.
        </p>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="failure-modes-h" id="failure-modes" className="mt-12">
        <h2 id="failure-modes-h" className="text-xl font-semibold tracking-tight">
          <a href="#failure-modes" className="hover:text-amber">
            Failure modes
          </a>
        </h2>
        <p className="mt-3 leading-relaxed">Exit codes:</p>
        <div className="mt-3 overflow-x-auto border border-rule">
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
        <p className="mt-6 leading-relaxed">The ugly paths, by situation:</p>
        <div className="mt-3 overflow-x-auto border border-rule">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-semibold">situation</th>
                <th className="px-3 py-2 font-semibold">contract</th>
              </tr>
            </thead>
            <tbody>
              {FAILURE_MODES.map((row) => (
                <tr key={row.situation} className="border-b border-rule last:border-b-0 align-top">
                  <td className="px-3 py-2 font-medium">{row.situation}</td>
                  <td className="px-3 py-2 text-ink/70">{row.contract}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      <section aria-labelledby="limitations-h" id="limitations" className="mt-12 mb-4">
        <h2 id="limitations-h" className="text-xl font-semibold tracking-tight">
          <a href="#limitations" className="hover:text-amber">
            Limitations
          </a>
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          {LIMITATIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed text-ink/80">
          Non-goals, by design: no security scanning, tool-poisoning heuristics, or trust scores; no LLM
          anywhere in the product; no re-implementation of the official conformance suite; no SARIF at v1;
          client-side (agent-side) conformance is out of scope — snapgauge tests servers.
        </p>
      </section>
    </main>
  );
}
