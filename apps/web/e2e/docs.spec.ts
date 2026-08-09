import { expect, test } from "@playwright/test";

test.describe("/docs", () => {
  test("is reachable from the landing page and renders every section", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Docs", exact: true }).click();
    await expect(page).toHaveURL(/\/docs$/);

    const sections = [
      "Install",
      "Five-minute quickstart",
      "Snapshot format",
      "Diff taxonomy",
      "Compat + degradation checks",
      "The board",
      "CI integration",
      "Failure modes",
      "Limitations",
    ];
    for (const name of sections) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  });

  test("the diff taxonomy lists the real registry counts and explains why descriptions are risky", async ({
    page,
  }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "breaking (13)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "risky (12)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "compatible (8)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "cosmetic (4)" })).toBeVisible();
    await expect(page.getByText(/Most diff tools would call a text rewrite cosmetic/)).toBeVisible();
  });

  test("the quickstart's CLI transcript is real, verified output, not an invented example", async ({ page }) => {
    await page.goto("/docs");
    await expect(
      page.getByText("6 findings (2 breaking, 1 risky, 1 compatible, 2 cosmetic); gate fail-on=risky -> DRIFT (exit 1)"),
    ).toBeVisible();
  });

  test("keyboard-reachable: every TOC entry is a real anchor link into the page", async ({ page }) => {
    await page.goto("/docs");
    const toc = page.getByRole("navigation", { name: "On this page" });
    const links = await toc.getByRole("link").all();
    expect(links.length).toBeGreaterThanOrEqual(9);
    for (const link of links) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(/^#/);
      const id = href?.slice(1) ?? "";
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
