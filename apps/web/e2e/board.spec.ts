import { expect, test } from "@playwright/test";

/**
 * e2e/run-e2e.mjs plants a `boards/<15-days-ago>.json` fixture BEFORE
 * `playwright test` (and its webServer's `next build`) even starts, so this
 * exercises the real dead-man banner (SPEC §6/§10 M6) through the actual
 * static-generation pipeline, not a mock — then removes the fixture once the
 * run finishes. The repo commits with `boards/` absent.
 */
test("/board: the dead-man banner fires for a >10-day-old board", async ({ page }) => {
  await page.goto("/board");
  // A test id, not role — Next.js's own route announcer also carries
  // role="alert" (empty, for screen-reader navigation), so a bare
  // getByRole("alert") is a strict-mode double match on every page.
  const banner = page.getByTestId("board-stale-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("days ago");
  await expect(page.getByText("No board published yet.")).toHaveCount(0);
});

test("/board: explainer and disclosure policy are always present", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByRole("heading", { name: "Disclosure policy" })).toBeVisible();
  await expect(page.getByText(/reportedAt/)).toBeVisible();
  await expect(page.getByText(/not tested \(auth required\)/)).toBeVisible();
});
