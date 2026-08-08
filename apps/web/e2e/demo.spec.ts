import { expect, test } from "@playwright/test";

test("/demo: the Web Worker runs the real engine and produces findings", async ({ page }) => {
  await page.goto("/demo");

  // Default selection is clean@v1 -> clean@v2-identical; switch to the
  // breaking pair so the findings table has real rows to assert on.
  await page.getByRole("radio", { name: /drift-breaking@v2/i }).check();
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText(/exit code: 1/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("tool.removed")).toBeVisible();
  await expect(page.getByRole("cell", { name: "breaking" }).first()).toBeVisible();

  // The negative case: identical snapshots produce zero findings, exit 0.
  await page.getByRole("radio", { name: /clean@v2-identical/i }).check();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/exit code: 0/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No drift: the two snapshots are equivalent.")).toBeVisible();
});

test("/demo: nonconformant-legacy fails the probe cleanly instead of hanging", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("radio", { name: /nonconformant-legacy/i }).check();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/exit code 2/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/PROBE_FAILURE/)).toBeVisible();
});
