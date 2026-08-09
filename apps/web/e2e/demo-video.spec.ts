import { expect, test } from "@playwright/test";

/**
 * DESIGN-DIRECTION.md §3: autoplay/muted/loop/playsinline/poster, no chrome,
 * a real adjacent text alternative, and `prefers-reduced-motion` -> poster +
 * link, never an autoplaying video. src/components/demo-video.tsx.
 */
test.describe("/ — demo recording", () => {
  test("normal motion preference: muted, looped, chrome-less autoplaying video with a poster", async ({ page }) => {
    await page.goto("/");
    const video = page.locator("video");
    await expect(video).toHaveAttribute("poster", "/demo/snapgauge-poster.png");
    await expect(video).toHaveAttribute("muted", "");
    await expect(video).toHaveAttribute("loop", "");
    await expect(video).toHaveAttribute("playsinline", "");
    // Once mounted with no reduced-motion preference, native controls are
    // removed (DESIGN-DIRECTION's "no browser chrome").
    await expect(video).not.toHaveAttribute("controls", "");
  });

  test("a real text alternative sits adjacent to the video, not hidden in a caption", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Text alternative:/)).toBeVisible();
    await expect(page.getByText(/selects the/)).toContainText("drift-breaking@v2");
  });

  test("prefers-reduced-motion: the poster frame and a link replace the video — never an autoplaying video", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("video")).toHaveCount(0);
    const poster = page.locator('img[src="/demo/snapgauge-poster.png"]');
    await expect(poster).toBeVisible();
    await expect(page.getByRole("link", { name: /open the recording/i })).toHaveAttribute(
      "href",
      "/demo/snapgauge-demo.webm",
    );
  });
});
