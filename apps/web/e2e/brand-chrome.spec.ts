import { expect, test } from "@playwright/test";

/** BRAND-KIT.md requirement: footer + favicon identically on every page. */
const ROUTES = ["/", "/demo", "/live", "/board", "/docs"];

for (const route of ROUTES) {
  test(`footer attribution + favicon present on ${route}`, async ({ page }) => {
    await page.goto(route);

    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer.getByText("James Lorenz Santos")).toBeVisible();
    await expect(footer.getByRole("link", { name: "agentjames.vercel.app" })).toHaveAttribute(
      "href",
      "https://agentjames.vercel.app",
    );
    await expect(footer.getByRole("link", { name: "GitHub repo" })).toHaveAttribute(
      "href",
      "https://github.com/jamessuuu/snapgauge",
    );

    const favicon = page.locator('link[rel="icon"]');
    await expect(favicon).toHaveAttribute("href", "/brand/favicon.svg");
  });
}
