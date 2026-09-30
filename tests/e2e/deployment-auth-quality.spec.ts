import { expect, test, type Page } from "@playwright/test";

// The deployed Playwright config deliberately starts without a local test session.
// Apply the supplied authenticated browser state to this suite when its gate is met.
test.use({ storageState: process.env.DEPLOYED_AUTH_STORAGE_STATE ?? { cookies: [], origins: [] } });

test.skip(
  !process.env.DEPLOYED_BASE_URL || !process.env.DEPLOYED_AUTH_STORAGE_STATE,
  "Authenticated deployment checks require a deployed URL and an authenticated state file.",
);

function monitorPageQuality(page: Page) {
  const failedAssets: string[] = [];
  const consoleErrors: string[] = [];
  page.on("requestfailed", (request) => {
    if (/\.(?:js|css)(?:\?|$)/u.test(request.url())) {
      failedAssets.push(`${request.failure()?.errorText ?? "request failed"}: ${request.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return { failedAssets, consoleErrors };
}

for (const route of ["/learn/sql/sqld/home", "/learn/software-major"]) {
  test(`authenticated ${route} loads required assets without browser errors`, async ({ page }) => {
    const quality = monitorPageQuality(page);
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#main-content")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(quality.failedAssets).toEqual([]);
    expect(quality.consoleErrors).toEqual([]);
  });
}

test("initial SQL scope is present before hydration without a duplicate browser request", async ({ page }) => {
  let browserScopeRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/study?") && request.url().includes("scope=practice-meta")) {
      browserScopeRequests += 1;
    }
  });
  const response = await page.goto("/learn/sql/sqld/practice", { waitUntil: "domcontentloaded" });
  expect(await response?.text()).toContain("배운 개념을 문제로 확인하세요.");
  await expect(page.getByRole("heading", { name: "배운 개념을 문제로 확인하세요." })).toBeVisible();
  expect(browserScopeRequests).toBeLessThanOrEqual(1);
});
