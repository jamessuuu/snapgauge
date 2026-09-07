import { SITE } from "@/lib/site";
import { Attribution } from "./attribution";

/**
 * BRAND-KIT.md requirement 3: chip mark + "Built by James Lorenz Santos" +
 * link to agentjames.vercel.app + link to the GitHub repo, on EVERY page.
 * Plain server-rendered markup — must render with JS disabled (D3/SPEC §4).
 *
 * The maker line is the shared attribution kit (attribution-kit v1): the chip mark
 * inline in currentColor, the portfolio and LinkedIn links with rel="me".
 */
export function Footer() {
  return (
    <footer className="border-t border-rule bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-ink-3">
        <Attribution linkClassName="hover:text-amber underline underline-offset-2" />
        <span aria-hidden="true" className="text-rule">
          ·
        </span>
        <a href={SITE.repoUrl} className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-2 underline underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-amber">
          GitHub repo
        </a>
        <span aria-hidden="true" className="text-rule">
          ·
        </span>
        <a href="/schema/v1.json" className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-2 underline underline-offset-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-amber">
          config schema
        </a>
      </div>
    </footer>
  );
}
