import type { Metadata } from "next";
import { boardStatus } from "@/lib/board";
import { loadBoards } from "@/lib/board-loader";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Board",
  description: "Public MCP servers, checked on a schedule, published as committed dated results.",
};

export default function BoardPage() {
  const boards = loadBoards();
  const status = boardStatus(boards, new Date());

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-ink/80">
        A refreshed, public read of 8–12 named MCP servers: era (modern-only / dual / legacy), the
        advertised protocol versions, the T-group framing assertions, cache-hint presence,{" "}
        <code className="font-mono text-sm">x-mcp-header</code> validity, and the D-group checks
        reachable without <code className="font-mono text-sm">tools/call</code>. Unauthenticated,
        read-only — servers that require auth are rows marked{" "}
        <code className="font-mono text-sm">not tested (auth required)</code>, never guessed.
      </p>

      <section aria-labelledby="disclosure-heading" className="mt-10 border border-rule p-4">
        <h2 id="disclosure-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Disclosure policy
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/80">
          For any MUST-level violation, an upstream issue is filed first and the row records{" "}
          <code className="font-mono text-xs">reportedAt</code>; publication follows at least 7 days
          later (<code className="font-mono text-xs">publishedAt</code>). Findings are stated as neutral
          observations — &quot;returns 200 on GET; the revision says 405&quot; — never as scores, grades,
          or security claims.
        </p>
      </section>

      <section aria-labelledby="board-heading" className="mt-10">
        <h2 id="board-heading" className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Results
        </h2>

        {status.kind === "empty" && (
          <div className="mt-3 border border-rule px-4 py-6 text-sm leading-relaxed">
            <p className="font-medium">No board published yet.</p>
            <p className="mt-2 text-ink/70">
              The board job (a weekly GitHub Actions run that commits{" "}
              <code className="font-mono text-xs">boards/&lt;date&gt;.json</code>) lands at milestone M6
              (<a href={SITE.repoUrl} className="underline underline-offset-2 hover:text-amber">
                {SITE.repoUrl.replace("https://", "")}
              </a>
              , <code className="font-mono text-xs">docs/SPEC.md</code> §10). This build (M5) ships the
              page, the disclosure policy above, and the dead-man banner logic below it — with nothing to
              show yet, honestly, rather than a placeholder table of invented rows.
            </p>
          </div>
        )}

        {status.kind === "stale" && (
          <div
            role="alert"
            data-testid="board-stale-banner"
            className="mt-3 border border-amber bg-amber/5 px-4 py-3 text-sm text-amber"
          >
            <strong>Stale:</strong> the newest board is from {status.newest.date} —{" "}
            {status.daysSince} days ago. The refresh job may have stopped running (GitHub Actions
            auto-disables a workflow after 60 days with no commits). This is not presented as current.
          </div>
        )}

        {status.kind === "fresh" && (
          <div className="mt-3">
            <p className="text-sm text-ink/70">Newest board: {status.newest.date}.</p>
            <div className="mt-3 overflow-x-auto border border-rule">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule bg-ink/[0.03] text-left">
                    <th className="px-3 py-2 font-semibold">server</th>
                    <th className="px-3 py-2 font-semibold">fields</th>
                  </tr>
                </thead>
                <tbody>
                  {status.newest.rows.map((row, index) => (
                    <tr key={`${row.server}-${String(index)}`} className="border-b border-rule last:border-b-0 align-top">
                      <td className="px-3 py-2 font-mono">{row.server}</td>
                      <td className="px-3 py-2 font-mono text-xs">{JSON.stringify(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
