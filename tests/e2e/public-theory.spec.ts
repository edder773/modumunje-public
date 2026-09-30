import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const javaScriptEnabled of [false, true]) {
  test(`@production all released theory collections are readable on mobile with JavaScript ${javaScriptEnabled ? "on" : "off"}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 844 }, locale: "ko-KR", storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const sitemap = await context.request.get(new URL("/sitemap.xml", baseURL).href);
      const lists = [...(await sitemap.text()).matchAll(/<loc>([^<]+\/theories)<\/loc>/gu)].map((match) => new URL(match[1]).pathname);
      expect(lists).toHaveLength(9);
      for (const list of lists) {
        await page.goto(new URL(list, baseURL).href, { waitUntil: "load" });
        const first = page.locator(`a[href^="${list}/lesson-"]`).first();
        const title = (await first.locator("h3").innerText()).trim();
        await first.click();
        // With JavaScript disabled, navigation commits before the new page's CSS finishes loading.
        await page.waitForLoadState("load");
        await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
        await expect(page.locator("article h2").first()).toBeVisible();
        await expect(page.locator("article.card.theory-reader")).toBeVisible();
        await expect(page.locator(".theory-content")).toHaveCSS("font-family", /Georgia/);
        const toc = page.getByRole("navigation", { name: "이 단원의 목차" });
        await expect(toc).toBeVisible();
        for (const href of await toc.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
          expect(await page.evaluate((id) => Boolean(document.getElementById(id!)), href?.slice(1))).toBe(true);
        }
        const code = page.locator(".theory-content .code-block").first();
        if (await code.count()) {
          await expect(code).toHaveCSS("background-color", "rgb(51, 45, 39)");
          await expect(code.locator("pre code")).toHaveCSS("color", "rgb(255, 253, 248)");
        }
        await expect(page.getByRole("button", { name: /학습 완료|학습 중|미완료/ })).toHaveCount(0);
        expect(await page.locator("head title").textContent()).toContain(title);
        expect(await page.locator('head meta[name="robots"]').getAttribute("content")).not.toContain("noindex");
        const sizes = await page.locator("html").evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
        expect(sizes.scroll, list).toBeLessThanOrEqual(sizes.width + 1);
        if (javaScriptEnabled && list.includes("sqld")) {
          const accessibility = await new AxeBuilder({ page }).include("#public-content").analyze();
          expect(accessibility.violations).toEqual([]);
          await page.screenshot({ path: testInfo.outputPath("public-theory-mobile.png"), fullPage: true });
        }
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("@production public theory uses the established desktop reader width and typography", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const sitemap = await context.request.get(new URL("/sitemap.xml", baseURL).href);
    const lists = [...(await sitemap.text()).matchAll(/<loc>([^<]+\/theories)<\/loc>/gu)].map((match) => new URL(match[1]).pathname);
    expect(lists).toHaveLength(9);
    for (const list of lists) {
      await page.goto(new URL(list, baseURL).href, { waitUntil: "load" });
      await page.locator(`a[href^="${list}/lesson-"]`).first().click();
      await page.waitForLoadState("load");
      const reader = page.locator("article.card.theory-reader");
      await expect(reader).toHaveCSS("max-width", "1120px");
      expect((await reader.boundingBox())!.width, list).toBeGreaterThan(1000);
      await expect(reader.locator("h1")).toHaveCSS("font-size", "44px");
      await expect(reader.locator(".theory-toc ol")).toHaveCSS("grid-template-columns", /^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/);
      await expect(reader.locator(".theory-content")).toHaveCSS("font-family", /Georgia/);
    }
  } finally { await context.close(); }
});

for (const javaScriptEnabled of [false, true]) {
  test(`@production theory selection restores course controls and responsive cards with JavaScript ${javaScriptEnabled ? "on" : "off"}`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ javaScriptEnabled, locale: "ko-KR", storageState: { cookies: [], origins: [] } });
    context.setDefaultTimeout(10_000);
    try {
      const page = await context.newPage();
      const sitemap = await context.request.get(new URL("/sitemap.xml", baseURL).href);
      const lists = [...(await sitemap.text()).matchAll(/<loc>([^<]+\/theories)<\/loc>/gu)].map((match) => new URL(match[1]).pathname);
      expect(lists).toHaveLength(9);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const list of lists) {
          await page.goto(new URL(list, baseURL).href, { waitUntil: "load" });
          const isSw = list.includes("software-major");
          const columns = width === 1440 ? 3 : 1;
          expect((await page.locator(".theory-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns)).split(" ")).toHaveLength(columns);
          await expect(page.locator(width === 1440 ? ".sidebar" : ".mobile-nav")).toBeVisible();
          await expect(page.locator(".theory-card h3").first()).toHaveCSS("font-family", /Georgia/);
          await expect(page.locator(".theory-index").first()).toHaveText("01");
          await expect(page.locator(".theory-card .keyword-row span").first()).toBeVisible();
          if (isSw) {
            const select = page.getByLabel("대분류", { exact: true });
            await select.selectOption((await select.locator("option").last().getAttribute("value"))!);
            if (!javaScriptEnabled) { await page.getByRole("button", { name: "검색·필터 적용" }).click(); await page.waitForLoadState("load"); }
            const category = await select.inputValue();
            for (const value of await page.locator(".theory-card .category-label").allTextContents()) expect(value).toBe(category);
            await expect(page.locator(".theory-filter-count")).toHaveCount(1);
            await expect(page.locator(".theory-results-head")).toHaveCount(0);
          } else {
            const categories = page.getByRole("navigation", { name: "이론 과목" });
            const lastCategory = categories.getByRole("link").last();
            const target = new URL((await lastCategory.getAttribute("href"))!, baseURL).searchParams.get("category")!;
            await lastCategory.click();
            if (!javaScriptEnabled) await page.waitForLoadState("load");
            expect(new URL((await categories.locator('[aria-current="page"]').getAttribute("href"))!, baseURL).searchParams.get("category")).toBe(target);
            await expect(page.locator(".theory-results-head")).toContainText(target);
            const select = page.getByLabel("소분류", { exact: true });
            const topic = await select.locator("option").nth(1).getAttribute("value");
            await select.selectOption(topic!);
            if (!javaScriptEnabled) { await page.getByRole("button", { name: "검색·필터 적용" }).click(); await page.waitForLoadState("load"); }
            expect(await page.locator(".theory-card-path > strong").allTextContents()).not.toHaveLength(0);
            for (const value of await page.locator(".theory-card-path > strong").allTextContents()) expect(value).toBe(topic);
          }
          const title = (await page.locator(".theory-card h3").first().innerText()).trim();
          await page.getByRole("searchbox").fill(title);
          if (!javaScriptEnabled) {
            await page.getByRole("button", { name: "검색·필터 적용" }).click();
            await page.waitForLoadState("load");
          }
          await expect(page.locator(".theory-card h3").first()).toHaveText(title);
          await page.getByRole("link", { name: "검색 지우기", exact: true }).click();
          if (!javaScriptEnabled) await page.waitForLoadState("load");
          await expect(page.getByRole("searchbox")).toHaveValue("");
          await expect(page.locator(".theory-progress-badge, .theory-progress-panel")).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), list).toBe(true);
        }
      }
      if (javaScriptEnabled) {
        await page.goto(new URL("/learn/sql/sqld/theories", baseURL).href, { waitUntil: "load" });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    } finally { await context.close(); }
  });
}
