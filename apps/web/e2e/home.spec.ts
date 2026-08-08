import { expect, test } from "@playwright/test";

test.describe("/ — static landing, must render with JS disabled (D3 blackout-safe, SPEC §4)", () => {
  test.use({ javaScriptEnabled: false });

  test("core content renders with every function paused and JS off", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: "snapgauge" })).toBeVisible();
    await expect(page.getByText(/fail CI when the next version moves/i)).toBeVisible();
    await expect(page.getByText("npx snapgauge@1 check")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Limitations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /complementary to the official/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /official mcp conformance suite/i })).toHaveAttribute(
      "href",
      "https://github.com/modelcontextprotocol/conformance",
    );
    await expect(page.getByText(/sharp tool/i)).toBeVisible();
  });
});
