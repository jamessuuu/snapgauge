import Link from "next/link";

/**
 * Site chrome. Plain server-rendered markup with no client JS — it must
 * render with every Vercel function paused and with JavaScript off (D3 /
 * SPEC §4), exactly like the rest of the app.
 *
 * Added 2026-09-07: before this, the app had a footer and no header at all,
 * so /demo, /live and /board were reachable only from links buried in the
 * landing page's prose. A product surface names itself and shows its own
 * routes.
 */
const link =
  "inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-2 sm:px-2.5 text-ink-2 transition-[color,background-color] duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/90">
      <div className="mx-auto flex min-h-[60px] max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex min-h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] pr-1"
        >
          <img src="/brand/glyph-inv.svg" alt="snapgauge" width={26} height={26} className="rounded-[5px]" />
          <span className="text-[1.0625rem] font-semibold tracking-tight transition-colors duration-[var(--dur-fast)] group-hover:text-amber">
            snapgauge
          </span>
        </Link>

        <span className="hidden rounded-full bg-surface-2 px-2 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-ink-3 shadow-[var(--edge-top)] sm:inline-block">
          MCP contract tests
        </span>

        <nav aria-label="primary" className="ml-auto flex items-center gap-0.5 font-mono text-[0.8125rem] sm:text-sm">
          <Link href="/demo" className={link}>
            demo
          </Link>
          <Link href="/live" className={link}>
            live
          </Link>
          <Link href="/board" className={`${link} hidden sm:inline-flex`}>
            board
          </Link>
          <Link href="/docs" className={link}>
            docs
          </Link>
        </nav>
      </div>
    </header>
  );
}
