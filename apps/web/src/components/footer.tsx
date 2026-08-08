import { SITE } from "@/lib/site";

/**
 * BRAND-KIT.md requirement 3: chip mark + "Built by James Lorenz Santos" +
 * link to agentjames.vercel.app + link to the GitHub repo, on EVERY page.
 * Plain server-rendered markup — must render with JS disabled (D3/SPEC §4).
 */
export function Footer() {
  return (
    <footer className="border-t border-rule mt-16">
      <div className="mx-auto max-w-4xl px-6 py-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-ink/70">
        <a href={SITE.portfolioUrl} className="flex items-center gap-2 hover:text-amber">
          <img src="/brand/mark.svg" alt="" width={20} height={20} aria-hidden="true" />
          <span>
            Built by <span className="text-ink">{SITE.author}</span>
          </span>
        </a>
        <span aria-hidden="true" className="text-rule">
          ·
        </span>
        <a href={SITE.portfolioUrl} className="hover:text-amber underline underline-offset-2">
          agentjames.vercel.app
        </a>
        <span aria-hidden="true" className="text-rule">
          ·
        </span>
        <a href={SITE.repoUrl} className="hover:text-amber underline underline-offset-2">
          GitHub repo
        </a>
        <span aria-hidden="true" className="text-rule">
          ·
        </span>
        <a href="/schema/v1.json" className="hover:text-amber underline underline-offset-2">
          config schema
        </a>
      </div>
    </footer>
  );
}
