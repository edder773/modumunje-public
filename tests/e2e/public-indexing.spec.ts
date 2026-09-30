import { expect, test } from "@playwright/test";

test("@production public sitemap documents render complete content and head metadata without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: "ko-KR",
    storageState: { cookies: [], origins: [] },
  });
  try {
    const sitemap = await context.request.get(new URL("/sitemap.xml", baseURL).href);
    expect(sitemap.status()).toBe(200);
    const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThanOrEqual(9);
    const page = await context.newPage();
    for (const canonical of urls) {
      const pathname = new URL(canonical).pathname;
      const response = await page.goto(new URL(pathname, baseURL).href, { waitUntil: "load" });
      expect(response?.status(), pathname).toBe(200);
      await expect(page.locator("main:visible"), pathname).toHaveCount(1);
      await expect(page.locator("h1:visible"), pathname).toHaveCount(1);
      await expect(page.locator('head link[rel="canonical"]'), pathname).toHaveCount(1);
      const declared = await page.locator('head link[rel="canonical"]').getAttribute("href");
      expect(new URL(declared!).href, pathname).toBe(canonical);
      if (pathname.startsWith("/guides")) {
        await expect(page.locator("#public-content"), pathname).toBeVisible();
        expect(await page.locator("#public-content").innerText(), pathname).not.toContain("페이지를 불러오는 중");
        await expect(page.locator("a.catalog-field-link"), pathname).toHaveCount(0);
      }
    }
  } finally {
    await context.close();
  }
});
