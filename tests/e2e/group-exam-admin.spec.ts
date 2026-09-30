import { expect, test } from "@playwright/test";
import { createLocalAdminGoogleStorageState } from "./local-google-session";

test("group administration stays compact and requires the exact name before delete", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: createLocalAdminGoogleStorageState() });
  const page = await context.newPage();
  const data = {
    todayKst: "2026-09-21",
    pagination: { page: 1, pages: 1, total: 1 },
    bank: {
      policy: "각 영역 10문항이 검증되었습니다.", perAreaTenReady: true,
      areaCounts: ["언어이해", "자료해석", "창의수리", "언어추리", "수열추리"].map((area) => ({ area, eligible_count: 10 })),
    },
    groups: [{
      id: "group-admin-layout", name: "관리 화면 검증", status: "active", member_limit: 5,
      admin_question_count_override: null, effective_question_count: 50, revision: 7,
      owner_public_name: "대표", active_members: 3, run_count: 2, recent_run_status: "completed",
      recent_run_at: "2026-09-21T00:00:00.000Z", today_quota_total: 1,
      today_quota_available: 1, today_quota_reserved: 0, today_quota_consumed: 0,
    }],
  };
  await page.route("**/api/group-exams/admin**", (route) => route.fulfill({ status: 200, json: data }));
  await page.goto("/admin/group-exams");
  await expect(page.getByRole("heading", { name: "그룹 시험 관리", exact: true })).toBeVisible();
  await expect(page.getByText("문제은행 준비 상태", { exact: true })).toBeVisible();
  await expect(page.getByText("언어이해", { exact: true })).toBeVisible();
  const deleteButton = page.getByRole("button", { name: "그룹 삭제" });
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel("그룹 이름 확인").fill("관리 화면 검증");
  await expect(deleteButton).toBeEnabled();
  for (const [width, height, name] of [[1440, 1000, "1440"], [768, 900, "768"], [390, 844, "390"]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/group-exams");
    await expect(page.getByRole("heading", { name: "그룹 시험 관리", exact: true })).toBeVisible();
    await expect(page.getByText("관리 화면 검증", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && window.scrollX === 0)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`group-admin-v4-${name}.png`), fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
