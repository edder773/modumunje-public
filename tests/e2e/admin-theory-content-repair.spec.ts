import { expect, test, type Browser } from "@playwright/test";
import { createLocalAdminGoogleStorageState } from "./local-google-session";

const packageSha256 = "a".repeat(64);
const questionChecksum = "b".repeat(64);
const beforeChecksum = "c".repeat(64);
const afterChecksum = "d".repeat(64);
const confirmation = `REPAIR learning-2026.09.13.6 ${packageSha256}`;

async function openRepairPage(browser: Browser, baseURL: string | undefined, loseRunResponse: boolean) {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname),
    "repair UI fixture is local-only");
  const context = await browser.newContext({ storageState: createLocalAdminGoogleStorageState() });
  const page = await context.newPage();
  const actions: string[] = [];
  await page.route(/\/api\/admin(?:\?.*)?$/u, async route => {
    const request = route.request();
    if (request.method() === "GET") {
      const resource = new URL(request.url()).searchParams.get("resource");
      return route.fulfill({ status: 200, json: resource === "backups"
        ? { items: [], storage: { externalAvailable: true, defaultMode: "external", warning: "" } }
        : { items: [] } });
    }
    const payload = request.postDataJSON() as Record<string, unknown>;
    const action = String(payload.action ?? "");
    actions.push(action);
    if (action === "admin-session")
      return route.fulfill({ status: 200, json: { ok: true, backupScheduleVerified: true } });
    if (action === "theory-content-repair-preview")
      return route.fulfill({ status: 200, json: {
        packageSha256, releaseVersion: "learning-2026.09.13.6",
        backupId: "11111111-1111-1111-1111-111111111111",
        backupCreatedAt: "2026-09-30T16:00:00.000Z", changedTheories: 106,
        questionCount: 11084, theoryCount: 523,
        before: { questions: questionChecksum, theories: beforeChecksum },
        after: { questions: questionChecksum, theories: afterChecksum }, confirmation,
      } });
    if (action === "theory-content-repair-run") {
      expect(payload.previewSha256).toBe(packageSha256);
      expect(payload.confirmation).toBe(confirmation);
      return route.fulfill(loseRunResponse
        ? { status: 503, json: { error: "response lost after commit" } }
        : { status: 200, json: { repaired: 106, questionChecksum, theoryChecksum: afterChecksum } });
    }
    if (action === "theory-content-repair-status")
      return route.fulfill({ status: 200, json: {
        state: "target-present", packageSha256, questionChecksum,
        theoryChecksum: afterChecksum, auditReceiptId: "22222222-2222-2222-2222-222222222222",
      } });
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
  await expect.poll(() => actions.includes("admin-session")).toBe(true);
  await expect(page.locator(".admin-loading")).toHaveCount(0);
  const repair = page.getByRole("region", { name: "검토된 이론 공백 복구" });
  await expect(repair).toBeVisible();
  await repair.locator('input[type="file"]').setInputFiles({
    name: "repair-private.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "synthetic-ui-fixture", rows: [] })),
  });
  await expect(repair.getByRole("button", { name: "패키지·백업 검증" })).toBeEnabled();
  await repair.getByRole("button", { name: "패키지·백업 검증" }).click();
  await expect(repair.getByText(packageSha256, { exact: true })).toBeVisible();
  const run = repair.getByRole("button", { name: "106건 복구 실행" });
  await expect(run).toBeDisabled();
  await repair.getByLabel("실행 확인 문구").fill(confirmation);
  await expect(run).toBeEnabled();
  await run.click();
  return { context, page, actions };
}

test("admin repair uploads, previews, confirms, and runs once without exposing source content", async ({ browser, baseURL }) => {
  const { context, page, actions } = await openRepairPage(browser, baseURL, false);
  try {
    await expect(page.getByText(/106건의 공백을 복구하고 전체 콘텐츠 체크섬을 확인했습니다/u)).toBeVisible();
    expect(actions.filter(action => action === "theory-content-repair-run")).toHaveLength(1);
    expect(actions).not.toContain("theory-content-repair-status");
    await expect(page.getByRole("region", { name: "검토된 이론 공백 복구" }))
      .not.toContainText("synthetic-ui-fixture");
  } finally { await context.close(); }
});

test("lost run response checks read-only target state and never retries mutation", async ({ browser, baseURL }) => {
  const { context, page, actions } = await openRepairPage(browser, baseURL, true);
  try {
    await expect(page.getByText(/응답이 유실됐지만 목표 콘텐츠 체크섬과 관리자 감사 영수증/u)).toBeVisible();
    expect(actions.filter(action => action === "theory-content-repair-run")).toHaveLength(1);
    expect(actions.filter(action => action === "theory-content-repair-status")).toHaveLength(1);
  } finally { await context.close(); }
});
