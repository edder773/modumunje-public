import { expect, test } from "@playwright/test";
import { createLocalAdminGoogleStorageState } from "./local-google-session";

test.use({ storageState: createLocalAdminGoogleStorageState() });

test("new report badge persists on opening, updates after review, and is visible on mobile", async ({ page, baseURL }) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "local fixtures only");
  let count = 101;
  let status = "new";
  await page.route("**/api/events**", route => route.fulfill({ status: 204 }));
  await page.route("**/api/admin**", async route => {
    let body: unknown = {};
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "report-status") { status = input.status; count = 0; }
    } else {
      const resource = new URL(route.request().url()).searchParams.get("resource");
      if (resource === "report-notification") body = { newCount: count };
      if (resource === "reports") body = { items: [{ id: "report-1", title: "신규 제보 테스트", description: "확인할 내용", category: "bug", status, admin_note: "", anonymous_user: "test", created_at: "2026-09-14T00:00:00Z" }] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/admin/reports");
  const reportLink = page.getByRole("link", { name: /사용자 제보.*신규 제보 101건/ });
  await expect(reportLink).toContainText("99+");
  await expect(page.getByRole("heading", { name: "신규 제보 테스트" })).toBeVisible();
  await expect(reportLink).toContainText("99+");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const menu = page.getByRole("button", { name: "관리자 메뉴 열기 · 신규 제보 101건", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("99+");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "검토 중", exact: true }).click();
  await expect(page.getByRole("button", { name: "관리자 메뉴 열기", exact: true })).toBeVisible();
  await expect(page.locator(".admin-notification-badge")).toHaveCount(0);
});

test("report badge refreshes on returning to the tab without opening reports", async ({ page, baseURL }) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "local fixtures only");
  let count = 0;
  await page.route("**/api/events**", route => route.fulfill({ status: 204 }));
  await page.route("**/api/admin**", route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    const body = resource === "report-notification" ? { newCount: count } : { items: [], storage: { defaultMode: "external", externalAvailable: true } };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/admin/backups");
  await expect(page.getByText("생성된 백업이 없습니다.")).toBeVisible();
  await expect(page.locator(".admin-notification-badge")).toHaveCount(0);
  count = 2;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: /사용자 제보.*신규 제보 2건/ })).toContainText("2");
});
