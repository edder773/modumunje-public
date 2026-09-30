import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.DEPLOYED_BASE_URL, "Deployment quality gates require a deployed environment with migrated data.");

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

test("public landing loads required assets without browser errors", async ({ page }) => {
    const quality = monitorPageQuality(page);
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#main-content")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(quality.failedAssets).toEqual([]);
    expect(quality.consoleErrors).toEqual([]);
});

test("guest deployment permits learning and redirects administrator access", async ({ request }) => {
  for (const route of ["/learn/sql/sqld/practice", "/learn/software-major/practice"]) {
    expect((await request.get(route, { maxRedirects: 0 })).status()).toBe(200);
  }
  for (const route of ["/admin"]) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toMatch(/\/api\/auth\/google\/start/u);
  }
});
