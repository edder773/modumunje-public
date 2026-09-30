import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createLocalAdminGoogleStorageState,
  createLocalGoogleStorageState,
} from "./local-google-session";

const now = "2026-09-03T06:00:00.000Z";

type AdminApiTrace = {
  actions: string[];
  reads: string[];
};

const question = {
  id: 101,
  displayOrder: 1,
  category: "데이터 모델링의 이해",
  topic: "데이터 모델의 이해",
  examScope: "SQLD",
  difficulty: "중",
  difficultyRationale: "핵심 개념 적용",
  kind: "single",
  prompt: "데이터 모델링의 목적을 고르시오.",
  choices: ["현실의 핵심을 구조화한다.", "데이터를 임의로 삭제한다.", "인덱스를 제거한다.", "권한을 우회한다."],
  correctAnswers: [0],
  explanation: "현실 세계의 핵심 구조를 목적에 맞게 표현한다.",
  tags: ["모델링"],
  scoringCriteria: [],
  requiredConcepts: [],
  acceptableAlternatives: [],
  deductionConditions: [],
  errorConditions: [],
  theoryId: 201,
  theory_title: "데이터 모델의 이해",
  active: true,
  totalAttempts: 10,
  correctAttempts: 8,
  incorrectAttempts: 2,
  correctnessRate: 80,
  wrongNoteCount: 2,
  averageDurationSeconds: 18,
  aiEvaluationErrors: 0,
  lastAttemptAt: now,
  created_at: now,
  updated_at: now,
};

const theory = {
  id: 201,
  title: "데이터 모델의 이해",
  category: "데이터 모델링의 이해",
  topic: "데이터 모델의 이해",
  sortOrder: 1,
  examScope: "SQLD",
  difficulty: "",
  summary: "데이터 모델의 역할과 구성 요소를 이해한다.",
  content: "## 핵심 개념\n\n데이터 모델은 현실의 핵심 구조를 표현한다.",
  reviewAnswers: "",
  keywords: ["데이터 모델"],
  active: true,
  linkedQuestions: 1,
  viewCount: 12,
  relatedStarts: 3,
  created_at: now,
  updated_at: now,
};

const responses: Record<string, unknown> = {
  dashboard: {
    period: { range: "7d", start: "2026-08-28", end: "2026-09-03" },
    excludeAdmin: true,
    operationalWarnings: [],
    performance: { webVitals: [], apiTimings: [] },
    retention: {
      retentionDays: 90,
      oldestEventAt: now,
      expiredRowCount: 0,
      lastCleanupAt: now,
      lastFailureAt: null,
      consecutiveFailures: 0,
    },
    metrics: {
      dailyActiveUsers: 3,
      monthlyActiveUsers: 15,
      visitors: 12,
      totalQuestions: 7684,
      activeQuestions: 7682,
      totalTheories: 582,
      questionAttempts: 24,
      totalQuestionAttempts: 240,
      recentErrors: 0,
      lastBackupAt: now,
    },
    contentBreakdown: [{
      field: "SQL",
      totalQuestions: 5225,
      activeQuestions: 5223,
      totalTheories: 122,
      activeTheories: 122,
      questionAttempts: 10,
      totalQuestionAttempts: 100,
    }],
    recent: { questions: [], theories: [], audits: [], errors: [], backups: [] },
    activityTrend: [{ day: "2026-09-03", dau: 3, mau: 15, questionAttempts: 24 }],
  },
  questions: {
    items: [question],
    pagination: { page: 1, pageSize: 20, total: 41, pages: 3 },
  },
  theories: {
    items: [theory],
    pagination: { page: 1, pageSize: 20, total: 21, pages: 2 },
  },
  quality: {
    generatedAt: now,
    cached: true,
    summary: { total: 0, error: 0, warning: 0, info: 0, autoFixable: 0 },
    issues: [],
  },
  backups: {
    items: [{
      id: "e2e-backup-2026-09-03",
      backup_type: "full",
      status: "completed",
      schema_version: "admin-4",
      app_version: "0.1.0",
      includedData: ["questions", "theories"],
      counts: { questions: 7684, theories: 582 },
      checksum: "1234567890abcdef1234567890abcdef",
      byteSize: 1024,
      created_at: now,
      error_message: "",
    }],
  },
  logs: {
    audits: [{
      id: "audit-1",
      action: "admin-session",
      target_type: "session",
      target_id: null,
      success: true,
      failure_reason: "",
      before: {},
      after: {},
      created_at: now,
    }],
    groupedErrors: [],
    recentErrors: [],
  },
  reports: {
    items: [{
      id: "report-1",
      category: "bug",
      title: "표가 깨져 보입니다.",
      description: "모바일 화면에서 표를 확인하기 어렵습니다.",
      page_path: "/learn/sql/sqld/theories/1",
      question_id: null,
      status: "new",
      admin_note: "",
      anonymous_user: "anonymous-user",
      created_at: now,
      updated_at: now,
    }],
  },
  settings: {
    values: {
      site_notice: "",
      maintenance_mode: false,
      default_exam_mode: "SQLD",
      ai_grading_enabled: false,
      ai_grading_max_retries: 0,
      analytics_enabled: true,
      analytics_retention_days: 90,
      backup_retention_count: 10,
      auto_backup_enabled: true,
    },
  },
};

async function openAdminPage(browser: Browser) {
  const context = await browser.newContext({ storageState: createLocalAdminGoogleStorageState() });
  const page = await context.newPage();
  return { context, page };
}

async function installAdminApi(page: Page, options: { delayOnceMs?: number; failOnce?: string; backupScheduleVerified?: boolean } = {}) {
  const trace: AdminApiTrace = { actions: [], reads: [] };
  let delayed = false;
  let failed = false;
  let qualityRefreshes = 0;
  await page.route(/\/api\/admin(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      const payload = request.postDataJSON() as { action?: string };
      trace.actions.push(String(payload.action ?? ""));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload.action === "admin-session"
          ? { ok: true, backupScheduleVerified: options.backupScheduleVerified === true }
          : { ok: true }),
      });
      return;
    }

    const url = new URL(request.url());
    const resource = url.searchParams.get("resource") ?? "";
    trace.reads.push(url.searchParams.toString());
    if (resource === "quality" && options.delayOnceMs && !delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, options.delayOnceMs));
    }
    if (resource === options.failOnce && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "E2E_TRANSIENT", error: "일시적인 관리자 조회 오류" }),
      });
      return;
    }
    const response = responses[resource];
    if (!response) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: `Unknown admin test resource: ${resource}` }),
      });
      return;
    }
    const body = resource === "quality" && url.searchParams.get("refresh") === "1"
      ? {
          ...(response as object),
          cached: false,
          generatedAt: new Date(Date.parse(now) + (++qualityRefreshes * 60_000)).toISOString(),
          summary: {
            ...(response as { summary: object }).summary,
            total: qualityRefreshes,
            info: qualityRefreshes,
          },
        }
      : resource === "questions"
        ? {
            ...(response as object),
            pagination: {
              ...(response as { pagination: object }).pagination,
              page: Number(url.searchParams.get("page") ?? 1),
            },
          }
        : response;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return trace;
}

async function expectSection(page: Page, menu: string, heading: string) {
  await page.getByRole("complementary", { name: "관리자 메뉴" })
    .getByRole("link", { name: new RegExp(`^${menu}`) })
    .click();
  await expect(page.getByRole("heading", { name: heading, exact: true, level: 2 })).toBeVisible();
  await expect(page.locator(".admin-loading")).toHaveCount(0);
}

test("administrator pages require sign-in and reject an authenticated non-admin", async ({ browser }) => {
  const guest = await browser.newContext();
  const guestResponse = await guest.request.get("/api/admin?resource=dashboard");
  expect([401, 403]).toContain(guestResponse.status());
  await guest.close();

  const learner = await browser.newContext({ storageState: createLocalGoogleStorageState() });
  const learnerApiResponse = await learner.request.get("/api/admin?resource=dashboard");
  expect(learnerApiResponse.status()).toBe(403);
  const page = await learner.newPage();
  const response = await page.goto("/admin", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "관리자 권한이 없습니다." })).toBeVisible();
  await expect(page.locator("[data-admin-access='administrator']")).toHaveCount(0);
  await learner.close();
});

test("administrator can load, search, filter, and paginate question and theory screens", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  const trace = await installAdminApi(page);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "운영 현황 요약" })).toBeVisible();
  await expect(page.getByText("7682문항", { exact: true })).toBeVisible();

  await expectSection(page, "문제 관리", "SQL 문제은행 관리");
  await page.getByPlaceholder("문제 번호·ID·본문·소분류·태그").fill("모델링 목적");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => trace.reads.some((query) => query.includes("resource=questions") && query.includes("search=%EB%AA%A8%EB%8D%B8%EB%A7%81"))).toBe(true);
  await page.getByRole("button", { name: "다음 →" }).click();
  await expect.poll(() => trace.reads.some((query) => query.includes("resource=questions") && query.includes("page=2"))).toBe(true);
  await page.getByLabel("난이도").selectOption({ label: "상" });
  await expect.poll(() => trace.reads.some((query) => query.includes("resource=questions") && query.includes("difficulty=%EC%83%81"))).toBe(true);

  await expectSection(page, "이론 관리", "SQL 이론 콘텐츠 관리");
  await page.getByPlaceholder("제목·요약·키워드").fill("데이터 모델");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => trace.reads.some((query) => query.includes("resource=theories") && query.includes("search=%EB%8D%B0%EC%9D%B4%ED%84%B0"))).toBe(true);
  await page.getByLabel("연결 문제").selectOption("available");
  await expect.poll(() => trace.reads.some((query) => query.includes("resource=theories") && query.includes("linked=available"))).toBe(true);
  await context.close();
});

test("administrator quality, backup, settings, logs, and reports recover without stuck loading", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  const trace = await installAdminApi(page);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  // The server-rendered heading can appear before the client attaches menu handlers.
  // Wait for the mount effect before using links that otherwise trigger a document navigation.
  await expect.poll(() => trace.actions.filter((action) => action === "admin-session").length).toBe(1);
  await expect.poll(() => trace.actions.filter((action) => action === "backup-auto-if-due").length).toBe(1);

  await expectSection(page, "문제 품질 점검", "전체 분야 문제·이론 품질 점검");
  await page.getByRole("button", { name: "새로 점검" }).click();
  await expect(page.getByText(/새 검사 결과/u)).toBeVisible();
  await expect(page.getByText("확인할 항목", { exact: true }).locator("..")).toContainText("1건");
  await expect.poll(() => trace.reads.filter((query) => query.includes("resource=quality") && query.includes("refresh=1")).length).toBe(1);
  await page.getByRole("button", { name: "새로 점검" }).click();
  await expect(page.getByText("확인할 항목", { exact: true }).locator("..")).toContainText("2건");
  await expect.poll(() => trace.reads.filter((query) => query.includes("resource=quality") && query.includes("refresh=1")).length).toBe(2);

  await expectSection(page, "백업 및 복원", "백업 및 복원");
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "다운로드", exact: true })).toBeVisible();
  await expectSection(page, "사용자 제보", "사용자 제보");
  await expect(page.getByText("표가 깨져 보입니다.", { exact: true })).toBeVisible();
  await expectSection(page, "시스템 로그", "관리자 작업·시스템 로그");
  await expect(page.getByText("admin-session", { exact: true })).toBeVisible();
  await expectSection(page, "사이트 설정", "사이트 설정");
  await expect(page.getByRole("button", { name: "변경사항 저장" })).toBeEnabled();
  expect(trace.actions).toContain("admin-session");
  await expect.poll(() => trace.actions.filter((action) => action === "backup-auto-if-due").length).toBe(1);
  await context.close();
});

test("verified private schedule omits the admin-entry backup request", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  const trace = await installAdminApi(page, { backupScheduleVerified: true });
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "운영 현황 요약" })).toBeVisible();
  await expect.poll(() => trace.actions.filter((action) => action === "admin-session").length).toBe(1);
  expect(trace.actions).not.toContain("backup-auto-if-due");
  await context.close();
});

test("administrator API failure exposes a retry and restores the dashboard", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page, { failOnce: "dashboard" });
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("일시적인 관리자 조회 오류", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "운영 현황 요약" })).toBeVisible();
  await expect(page.locator(".admin-loading")).toHaveCount(0);
  await context.close();
});

test("administrator quality scan outlives the generic request timeout without a false error", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page, { delayOnceMs: 3_250 });
  await page.goto("/admin/quality", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", {
    name: "전체 분야 문제·이론 품질 점검",
    exact: true,
    level: 2,
  })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("관리자 데이터를 불러오지 못했습니다.", { exact: true })).toHaveCount(0);
  await context.close();
});

test("external backup preview waits for part verification beyond the ordinary request timeout", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  const trace = await installAdminApi(page);
  let previews = 0;
  await page.route(/\/api\/admin$/u, async (route) => {
    const payload = route.request().postDataJSON() as { action?: string };
    if (payload.action !== "restore-preview") return route.fallback();
    previews += 1;
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      metadata: { generatedAt: now, schemaVersion: "0554" },
      conflicts: { questions: { incoming: 11_503, existingIds: 11_503 } },
      fullReplace: { ready: true, missingTables: [] },
    }) });
  });
  await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "복원", exact: true }).click();
  await expect(page.getByText("백업 형식과 무결성을 검증하는 중입니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("무결성 검증", { exact: true }).locator("..")).toContainText("통과", { timeout: 8_000 });
  await expect(page.getByText("포함 11503건", { exact: true })).toBeVisible();
  await expect(page.getByText("관리자 작업을 완료하지 못했습니다.", { exact: true })).toHaveCount(0);
  expect(previews).toBe(1);
  expect(trace.actions).not.toContain("restore-run");
  await page.getByRole("button", { name: "백업 복원 닫기", exact: true }).click();
  await context.close();
});

test("backup creation controls stay aligned across screen sizes, storage warnings and backup scopes", async ({ browser, baseURL }, testInfo) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "backup UI fixtures are local-only");
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page);
  let warning = "";
  const creations: Array<Record<string, unknown>> = [];
  let finishCreate: (() => void) | undefined;
  const releaseCreate = new Promise<void>(resolve => { finishCreate = resolve; });
  await page.route(/\/api\/admin(?:\?.*)?$/u, async route => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).searchParams.get("resource") === "backups") {
      return route.fulfill({ status: 200, json: {
        ...(responses.backups as object),
        storage: { configuredMode: "external", externalAvailable: !warning, defaultMode: warning ? "database" : "external", location: "테스트", warning },
      } });
    }
    if (request.method() === "POST" && request.postDataJSON().action === "backup-create") {
      creations.push(request.postDataJSON());
      await releaseCreate;
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fallback();
  });
  try {
    await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("region", { name: "새 백업 생성", exact: true });
    const scope = card.getByRole("combobox", { name: "백업 범위", exact: true });
    const storage = card.getByRole("combobox", { name: "보관 위치", exact: true });
    const analytics = card.getByRole("checkbox", { name: "익명 방문 통계 포함" });
    await expect(storage).toHaveValue("external");
    for (const withWarning of [false, true]) {
      if (withWarning) {
        warning = "외부 저장소를 사용할 수 없어 D1 호환 저장을 사용합니다. 저장소 연결 상태와 백업 보관 정책을 확인해 주세요.";
        await page.getByRole("button", { name: "새로고침", exact: true }).click();
        await expect(storage).toHaveValue("database");
        await expect(storage).toHaveAttribute("aria-describedby", "backup-storage-warning");
        await expect(storage.locator('option[value="external"]')).toHaveAttribute("disabled", "");
      }
      for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width <= 768) {
          await expect.poll(() => page.locator(".admin-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
        }
        const metrics = await card.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const blocks = Array.from(element.children).map(child => child.getBoundingClientRect());
          const inputs = Array.from(element.querySelectorAll("select, button")).map(child => child.getBoundingClientRect());
          return {
            outside: [...blocks, ...inputs].some(child => child.left < rect.left || child.right > rect.right),
            overlap: blocks.some((child, index) => index > 0 && child.top < blocks[index - 1].bottom),
            minimumControlHeight: Math.min(...inputs.map(child => child.height)),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        expect(metrics.outside, `${width}px warning=${withWarning}`).toBe(false);
        expect(metrics.overlap, `${width}px warning=${withWarning}`).toBe(false);
        expect(metrics.minimumControlHeight).toBeGreaterThanOrEqual(44);
        expect(metrics.overflow).toBeLessThanOrEqual(1);
        if (!withWarning && [390, 1440].includes(width)) await card.screenshot({ path: testInfo.outputPath(`backup-create-${width}.png`) });
      }
    }
    for (const value of ["content", "learning", "settings"]) {
      await scope.selectOption(value);
      await expect(analytics).toHaveCount(0);
      await expect(card.getByRole("button", { name: "백업 생성", exact: true })).toBeVisible();
    }
    await scope.selectOption("full");
    await analytics.check();
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    expect(await card.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await scope.focus();
    await page.keyboard.press("Tab");
    await expect(storage).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(analytics).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: "백업 생성", exact: true })).toBeFocused();
    await card.getByRole("button", { name: "백업 생성", exact: true }).click();
    await expect(card.getByRole("button", { name: "백업 생성 중…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "취소 요청", exact: true })).toHaveCount(0);
    await expect(page.getByText("페이지를 닫아도 생성 중 항목을 다시 이어할 수 있습니다.", { exact: false })).toHaveCount(0);
    await expect.poll(() => creations.length).toBe(1);
    expect(creations[0]).toMatchObject({ action: "backup-create", type: "full", includeAnalytics: true, storageMode: "database" });
    finishCreate!();
    await expect(card.getByRole("button", { name: "백업 생성", exact: true })).toBeEnabled();
  } finally {
    finishCreate!();
    await context.close();
  }
});

test("backup creation displays the returned list without a second short-budget GET", async ({ browser, baseURL }) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "backup UI fixtures are local-only");
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page);
  let backupReads = 0;
  const freshItem = { ...(responses.backups as { items: Array<Record<string, unknown>> }).items[0], id: "fresh-row-backup" };
  await page.route(/\/api\/admin(?:\?.*)?$/u, async route => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).searchParams.get("resource") === "backups") {
      backupReads += 1;
      return route.fulfill({ status: 200, json: responses.backups });
    }
    if (request.method() === "POST" && request.postDataJSON().action === "backup-create") {
      return route.fulfill({ status: 200, json: {
        id: freshItem.id,
        backupList: { ...(responses.backups as object), items: [freshItem, ...(responses.backups as { items: object[] }).items] },
      } });
    }
    return route.fallback();
  });
  try {
    await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "백업 및 복원", exact: true, level: 1 })).toBeVisible();
    await expect(page.locator(".admin-loading")).toHaveCount(0);
    expect(backupReads).toBe(1);
    await page.getByRole("region", { name: "새 백업 생성", exact: true })
      .getByRole("button", { name: "백업 생성", exact: true }).click();
    await expect(page.getByText("fresh-ro", { exact: true })).toBeVisible();
    expect(backupReads).toBe(1);
  } finally {
    await context.close();
  }
});


test("durable external backup retries one operation and uses its completed list", async ({ browser, baseURL }) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "backup UI fixtures are local-only");
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page);
  const storage = { configuredMode: "external", externalAvailable: true, defaultMode: "external", location: "테스트", warning: "" };
  const calls: Array<Record<string, unknown>> = [];
  let reads = 0;
  let finishVerify: (() => void) | undefined;
  const verifying = new Promise<void>(resolve => { finishVerify = resolve; });
  await page.route(/\/api\/admin(?:\?.*)?$/u, async route => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).searchParams.get("resource") === "backups") {
      reads += 1;
      return route.fulfill({ status: 200, json: { items: [], storage } });
    }
    if (request.method() !== "POST" || request.postDataJSON().action !== "backup-create") return route.fallback();
    const payload = request.postDataJSON();
    calls.push(payload);
    if (calls.length === 1) return route.fulfill({ status: 200, json: {
      id: payload.backupId, completed: false, progress: { phase: "collect", tableIndex: 4, tableCount: 50, revision: 4 },
    } });
    if (calls.length === 2) return route.fulfill({ status: 503, json: { error: "일시적인 저장소 장애" } });
    await verifying;
    const item = {
      ...(responses.backups as { items: Array<Record<string, unknown>> }).items[0],
      id: payload.backupId, status: "completed", storageMode: "external", schema_version: "admin-9",
    };
    return route.fulfill({ status: 200, json: { id: payload.backupId, completed: true, backupList: { items: [item], storage } } });
  });
  try {
    await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("combobox", { name: "보관 위치", exact: true })).toHaveValue("external");
    await page.getByRole("button", { name: "백업 생성", exact: true }).click();
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(3);
    expect(new Set(calls.map(call => call.backupId)).size).toBe(1);
    expect(String(calls[0].backupId)).toMatch(/^[a-f0-9-]{36}$/u);
    expect(calls.every(call => call.type === "full" && call.storageMode === "external")).toBe(true);
    await expect(page.getByRole("button", { name: "백업 생성 중…", exact: true })).toBeDisabled();
    finishVerify!();
    await expect(page.getByRole("link", { name: "다운로드", exact: true })).toHaveAttribute("href", `/api/admin?resource=backup-download&id=${calls[0].backupId}`);
    await expect(page.getByRole("button", { name: "백업 생성", exact: true })).toBeEnabled();
    expect(reads).toBe(1);
  } finally {
    finishVerify!();
    await context.close();
  }
});

test("durable external backup resumes after reload and cancels after the current step", async ({ browser, baseURL }) => {
  test.skip(!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname), "backup UI fixtures are local-only");
  const { context, page } = await openAdminPage(browser);
  await installAdminApi(page);
  const id = "851cc70c-a0d6-47df-9e49-af7c581b25ba";
  const storage = { configuredMode: "external", externalAvailable: true, defaultMode: "external", location: "테스트", warning: "" };
  const item = {
    ...(responses.backups as { items: Array<Record<string, unknown>> }).items[0],
    id, status: "creating", resumable: true, storageMode: "external", checksum: "",
    includedData: ["questions", "analytics_events"], error_message: "",
  };
  const calls: Array<Record<string, unknown>> = [];
  let finishStep: (() => void) | undefined;
  const inFlight = new Promise<void>(resolve => { finishStep = resolve; });
  await page.route(/\/api\/admin(?:\?.*)?$/u, async route => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).searchParams.get("resource") === "backups") {
      return route.fulfill({ status: 200, json: { items: [item], storage } });
    }
    if (request.method() !== "POST") return route.fallback();
    const payload = request.postDataJSON();
    if (!["backup-create", "backup-cancel"].includes(payload.action)) return route.fallback();
    calls.push(payload);
    if (payload.action === "backup-cancel") {
      item.status = "failed";
      item.error_message = "관리자가 백업 작업을 취소했습니다.";
      return route.fulfill({ status: 200, json: { id, canceled: true } });
    }
    await inFlight;
    return route.fulfill({ status: 200, json: {
      id, completed: false, progress: { phase: "verify", tableIndex: 4, tableCount: 51, revision: 24 },
    } });
  });
  try {
    await page.goto("/admin/backups", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "이어하기", exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "이어하기", exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ backupId: id, type: "full", includeAnalytics: true, storageMode: "external" });
    await page.getByRole("button", { name: "취소 요청", exact: true }).click();
    expect(calls).toHaveLength(1);
    finishStep!();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({ action: "backup-cancel", backupId: id });
    await expect(page.getByRole("button", { name: "백업 생성", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "이어하기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "다운로드", exact: true })).toHaveCount(0);
  } finally {
    finishStep!();
    await context.close();
  }
});

test("@production administrator critical routes render from production chunks within the browser budget", async ({ browser }) => {
  const { context, page } = await openAdminPage(browser);
  const trace = await installAdminApi(page);
  const startedAt = Date.now();
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "운영 현황 요약" })).toBeVisible();
  for (const [menu, heading] of [
    ["문제 관리", "SQL 문제은행 관리"],
    ["이론 관리", "SQL 이론 콘텐츠 관리"],
    ["문제 품질 점검", "전체 분야 문제·이론 품질 점검"],
    ["백업 및 복원", "백업 및 복원"],
    ["사용자 제보", "사용자 제보"],
    ["시스템 로그", "관리자 작업·시스템 로그"],
    ["사이트 설정", "사이트 설정"],
  ] as const) {
    await expectSection(page, menu, heading);
  }
  expect(Date.now() - startedAt).toBeLessThan(15_000);
  for (const resource of ["dashboard", "questions", "theories", "quality", "backups", "reports", "logs", "settings"]) {
    expect(trace.reads.some((query) => query.includes(`resource=${resource}`)), resource).toBe(true);
  }
  await context.close();
});
