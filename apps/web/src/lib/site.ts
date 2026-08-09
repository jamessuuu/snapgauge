/**
 * Site-wide constants — one place so the footer, metadata, and README-style
 * copy on `/` never drift from each other (BRAND-KIT.md, SPEC §9/§10).
 */
export const SITE = {
  name: "snapgauge",
  tagline:
    "Snapshot an MCP server's schema and behavior, then fail CI when the next version moves. Fixture servers are in the repo, so it runs offline.",
  repoUrl: "https://github.com/jamessuuu/snapgauge",
  portfolioUrl: "https://agentjames.vercel.app",
  author: "James Lorenz Santos",
  officialConformanceUrl: "https://github.com/modelcontextprotocol/conformance",
  installSnippet: "npx snapgauge@1 check",
} as const;

export const POSITIONING_TABLE = [
  {
    axis: "Question",
    official: "Does this server obey the spec, right now?",
    snapgauge: "Did THIS server change vs. its own recorded contract — and how does it behave one client-version back?",
  },
  {
    axis: "Method",
    official: "Scenario-based, wire-schema validated, run fresh every time.",
    snapgauge: "Recorded snapshot diff (self-vs-self over time) + degradation profiles across client capability sets.",
  },
  {
    axis: "Output",
    official: "Pass/fail against the 2026-07-28 revision.",
    snapgauge: "Tiered findings (breaking/risky/compatible/cosmetic) with an exit code CI can gate on.",
  },
  {
    axis: "When it runs",
    official: "Any time, against any server, no history required.",
    snapgauge: "After the first `snapgauge record` — it needs a prior snapshot to compare against.",
  },
] as const;

/** README's exit-code table (SPEC §5, load-bearing for CI): the "who fixes
 * it" column is the point — 1 vs 3 is a different owner, different fix. */
export const EXIT_CODE_TABLE = [
  { code: 0, meaning: "Clean — no findings at/above the gate.", whoFixesIt: "Nobody — nothing to do." },
  {
    code: 1,
    meaning: "Drift at/above the gate (--fail-on, default risky).",
    whoFixesIt:
      "The consumer: review the diff, then either --update the stored snapshot (drift was intentional) or fix/pin the server.",
  },
  {
    code: 2,
    meaning: "Probe/connection failure (unreachable, auth, timeout, malformed response).",
    whoFixesIt: "The consumer's environment/config — check the target URL, credentials, and network reachability.",
  },
  {
    code: 3,
    meaning: "Compat/degradation violation — the server is wrong, not merely different.",
    whoFixesIt: "The server's maintainer — it violates the 2026-07-28 revision's degradation contract.",
  },
  {
    code: 4,
    meaning: "Usage/config/snapshot-format error (incl. probe-spec mismatch: re-record).",
    whoFixesIt: "The consumer — fix the CLI invocation or config, or re-run snapgauge record.",
  },
  {
    code: 5,
    meaning: "Internal error — a bug in snapgauge itself.",
    whoFixesIt: "snapgauge's maintainer — please report it (SECURITY.md).",
  },
] as const;

export const LIMITATIONS = [
  "Auth-gated tools: the hosted /live check never accepts a bearer token, so it can only audit a server's unauthenticated discovery surface.",
  "Per-tenant tool sets: if a server returns a different tools/list per API key, snapgauge only ever sees the one it was configured to see.",
  "Genuinely non-deterministic output: shape-capture (the default) absorbs most value churn, but a tool that returns a random SCHEMA shape will read as flaky drift.",
  "stdio's narrower assertion set: the T-group framing assertions (SPEC §5) require an HTTP layer — over stdio they report n/a (stdio), with the reason printed, never silently passed.",
] as const;
