import { expect, test } from "@playwright/test";

/**
 * BRAND-KIT.md requirement: footer + favicon identically on every page.
 *
 * Icon hierarchy (BRAND-KIT.md "Icon hierarchy — CHANGED 2026-08-09"): the
 * favicon is snapgauge's OWN compact glyph (jaws closing on a part), not the
 * agentjames chip — the chip stays the maker's mark in the footer only. The
 * href for the SVG favicon is unchanged ("/brand/favicon.svg" — same path as
 * before the change), so asserting the href alone would NOT catch a
 * regression where the chip gets written back to that same file. The content
 * assertions below fetch the real bytes and check for chip fingerprints
 * (its "Agent James" aria-label, its <path> J-glyph stroke) that the compact
 * snapgauge glyph never has, and for its own aria-label, so this test fails
 * if the chip is ever wired back in as the favicon.
 */
const ROUTES = ["/", "/demo", "/live", "/board", "/docs"];

for (const route of ROUTES) {
  test(`footer attribution + favicon present on ${route}`, async ({ page }) => {
    await page.goto(route);

    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
    await expect(footer.getByText("James Lorenz Santos")).toBeVisible();
    await expect(footer.getByRole("link", { name: "James Lorenz Santos" })).toHaveAttribute(
      "href",
      "https://agentjames.vercel.app",
    );
    await expect(footer.getByRole("link", { name: "GitHub repo" })).toHaveAttribute(
      "href",
      "https://github.com/jamessuuu/snapgauge",
    );

    // Multiple <link rel="icon"> now exist (svg + 16/32/48 png rasters), so
    // scope to the svg-typed one to avoid a Playwright strict-mode violation.
    const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
    await expect(favicon).toHaveAttribute("href", "/brand/favicon.svg");

    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcon).toHaveAttribute("href", "/brand/apple-touch-icon.png");

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
  });
}

test("favicon resolves over real HTTP and is the snapgauge glyph, not the chip", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page
    .locator('link[rel="icon"][type="image/svg+xml"]')
    .getAttribute("href");
  expect(href).toBe("/brand/favicon.svg");

  const response = await request.get(href ?? "");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");

  const body = await response.text();
  // Positive: the compact snapgauge glyph's own label.
  expect(body).toContain('aria-label="snapgauge icon"');
  // Negative: fingerprints unique to the chip (agentjames maker's mark) —
  // its default label, and the <path> stroke that draws the chip's "J".
  // The compact snapgauge glyph is solid <rect> shapes only, no <path>.
  expect(body).not.toContain("Agent James");
  expect(body).not.toContain("<path");
});

test("apple-touch-icon and web manifest resolve over real HTTP", async ({ page, request }) => {
  await page.goto("/");

  const appleHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(appleHref).toBe("/brand/apple-touch-icon.png");
  const appleResponse = await request.get(appleHref ?? "");
  expect(appleResponse.ok()).toBe(true);
  expect(appleResponse.headers()["content-type"]).toContain("image/png");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");
  const manifestResponse = await request.get(manifestHref ?? "");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await manifestResponse.json()) as { icons: { src: string }[] };
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/brand/icon-192.png" }),
      expect.objectContaining({ src: "/brand/icon-512.png" }),
    ]),
  );
});
