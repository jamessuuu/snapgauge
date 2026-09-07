import { expect, test } from "@playwright/test";

test.describe("/ — landing page, must render with JS disabled (D3 blackout-safe, SPEC §4)", () => {
  test.use({ javaScriptEnabled: false });

  test("core content renders with every function paused and JS off", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // The h1 is the FINDING, not the product name (2026-09-07 redesign): the
    // verdict is the only thing on this page a visitor cannot get from the
    // README, so it leads. The product still names itself, from the header.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText(/A tool vanished from the contract\. CI exits \d\./);
    await expect(page.locator("header").getByRole("link", { name: "snapgauge" })).toBeVisible();
    await expect(page.getByText(/fail CI when the next version moves/i)).toBeVisible();
    await expect(page.getByText("npx snapgauge@1 check")).toBeVisible();
    await expect(page.getByRole("heading", { name: /complementary to the official/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /official mcp conformance suite/i })).toHaveAttribute(
      "href",
      "https://github.com/modelcontextprotocol/conformance",
    );
    await expect(page.getByText(/sharp tool/i)).toBeVisible();

    // With JS disabled the demo video still renders as a plain, controllable
    // <video> (src/components/demo-video.tsx's SSR default) — never a blank
    // box and never an element that silently tries to autoplay without JS.
    const video = page.locator("video");
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).toHaveAttribute("poster", "/demo/snapgauge-poster.png");
  });
});

test.describe("/ — the real diff (hero evidence, computed at build time)", () => {
  test("shows a real breaking finding from the committed drift-breaking@v2 fixture, with tier and exit code", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.getByTestId("hero-finding");
    await expect(hero.getByText("clean@v1 → drift-breaking@v2")).toBeVisible();
    // The headline finding is scoped to its own panel: the tier histogram
    // beside it also prints the word "breaking", as a count label.
    const headline = page.getByTestId("hero-headline");
    // Tier text is CSS-uppercased (text-transform), not DOM-uppercased.
    await expect(headline.getByText("breaking", { exact: true })).toBeVisible();
    await expect(headline.getByText("tool.removed")).toBeVisible();
    await expect(headline.getByText(/tool "archive_note" was removed/)).toBeVisible();
    // The exit code is the readout CI acts on — rendered at size, not in prose.
    await expect(page.getByTestId("hero-exit-code")).toContainText("1");
    await expect(hero.getByText(/gate fail-on=/i)).toBeVisible();
    await expect(hero.getByText(/This build would be blocked\./)).toBeVisible();
  });
});

test.describe("/ — the mechanism diagram", () => {
  test("the tier-ladder diagram renders inline with a real title/desc, one amber rung", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "How a diff gets a tier" })).toBeVisible();
    const svg = page.locator("svg", { has: page.locator("title", { hasText: "The four diff tiers, as a ladder" }) });
    await expect(svg).toBeVisible();
    // All four example rule ids are present, each from the real registry
    // (scoped to <text> nodes only — the id also appears inside <desc>).
    for (const ruleId of ["tool.removed", "tool.description.changed", "tool.input.optional.added", "tool.icons.changed"]) {
      await expect(svg.locator("text", { hasText: ruleId })).toBeVisible();
    }
  });
});

test.describe("/ — exit codes", () => {
  test("the exit-code table includes the who-fixes-it column", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Exit codes" })).toBeVisible();
    const table = page.locator("table", { has: page.getByText("who fixes it") });
    await expect(table).toBeVisible();
    await expect(table.getByText("the server's maintainer", { exact: false })).toBeVisible();
  });
});
