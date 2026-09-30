import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { BACKUP_TABLES } from "../packages/shared/src/admin/backup-contract.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("admin migration preserves content and adds operational tables with safe defaults", () => {
  const database = materializeDatabase();
  const tables = new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));
  for (const table of [
    "analytics_events",
    "admin_audit_logs",
    "system_errors",
    "backup_snapshots",
    "site_settings",
    "user_accounts",
  ]) {
    assert.ok(tables.has(table), table);
  }

  const questionCounts = database.prepare(`
    SELECT COUNT(*) AS physical, SUM(active) AS active FROM questions
  `).get();
  assert.ok(questionCounts.physical >= questionCounts.active);
  assert.equal(questionCounts.physical, 11084);
  assert.equal(questionCounts.active, 11079);
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM theories").get().count > 0, true);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings").get().count, 16);
  assert.equal(
    database.prepare("SELECT value FROM site_settings WHERE key = 'content_revision_version'").get().value,
    "20260802_sqlp_122_learning_pairs",
  );
  assert.equal(
    database.prepare("SELECT value FROM site_settings WHERE key = 'theory_revision_version'").get().value,
    "20260729_sqlp_subject3_verified",
  );
  assert.equal(
    database.prepare("SELECT value FROM site_settings WHERE key = 'question_delivery_revision'").get().value,
    "20260803_theory_pairs_only",
  );
  assert.equal(
    database.prepare("SELECT value FROM site_settings WHERE key = 'sw_official_release_question_revision'").get().value,
    "20260806_reviewed_deduplicated",
  );
  assert.equal(
    database.prepare("SELECT value FROM site_settings WHERE key = 'sqlp_subject3_copyright_revision'").get().value,
    "20260809_expression_rewrite",
  );

  const attemptColumns = new Set(database.prepare("PRAGMA table_info(attempts)").all().map((row) => row.name));
  const sessionColumns = new Set(database.prepare("PRAGMA table_info(exam_sessions)").all().map((row) => row.name));
  const eventColumns = new Set(database.prepare("PRAGMA table_info(analytics_events)").all().map((row) => row.name));
  assert.ok(attemptColumns.has("is_admin"));
  assert.ok(sessionColumns.has("is_admin"));
  assert.ok(eventColumns.has("duration_ms"));

  for (const forbidden of [
    "ip",
    "ip_address",
    "answer",
    "answer_text",
    "sql_code",
    "token",
    "password",
    "fingerprint",
  ]) {
    assert.equal(eventColumns.has(forbidden), false, forbidden);
  }
});

test("admin authorization is fail-closed and every admin API path checks the server", () => {
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const publicApi = source("apps/backend/src/modules/study/study.service.ts");

  assert.match(auth, /getRuntimeEnv\(\)\.ADMIN_EMAIL/);
  assert.match(auth, /AUTHENTICATED_USER_EMAIL_HEADER/);
  assert.match(auth, /status:\s*401/);
  assert.match(auth, /status:\s*403/);
  assert.match(auth, /status:\s*503/);
  assert.match(auth, /verifyAdminMutationRequest/);
  assert.match(auth, /origin !== new URL\(request\.url\)\.origin/);
  assert.doesNotMatch(auth, /@gmail\.com|@naver\.com|@kakao\.com/);

  assert.match(api, /export async function GET\(request: Request\)[\s\S]*authorizeAdminRequest\(request\)/);
  assert.match(api, /export async function POST\(request: Request\)[\s\S]*authorizeAdminRequest\(request\)[\s\S]*verifyAdminMutationRequest\(request\)/);
  assert.match(pageSession, /requireSiteUser/);
  assert.match(pageSession, /isAdminEmail\(user\.email\)/);
  assert.match(pageSession, /if \(!isAdminEmail\(user\.email\)\) forbidden\(\)/);
  assert.match(publicApi, /문제 등록은 관리자 페이지에서만 사용할 수 있습니다/);
  assert.match(publicApi, /이론 등록은 관리자 페이지에서만 사용할 수 있습니다/);
});

test("admin settings only round-trip supported editable keys", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-settings-section.tsx");

  assert.match(api, /const SETTING_DEFAULTS = \{/);
  assert.match(api, /item\.key in SETTING_RULES/);
  assert.match(api, /values:\s*\{\s*\.\.\.SETTING_DEFAULTS,\s*\.\.\.storedValues\s*\}/);
  assert.match(ui, /const editableValues = \{/);
  for (const key of [
    "site_notice",
    "maintenance_mode",
    "default_exam_mode",
    "analytics_enabled",
    "analytics_retention_days",
    "backup_retention_count",
    "auto_backup_enabled",
  ]) {
    assert.match(ui, new RegExp(`${key}: form\\.${key}`));
  }
});

test("question and theory writes validate type, scope, links, and preserve stable IDs", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const values = source("apps/backend/src/modules/admin/admin-content-values.ts");
  assert.match(values, /서술형 문제는 등록된 과정의 지정 과목에서만 등록할 수 있습니다/);
  assert.match(values, /객관식 문제에는 OX형 선택지 2개 또는 일반 선택지 4개가 필요합니다/);
  assert.match(values, /서술형 문제에는 채점 기준과 필수 핵심 내용이 필요합니다/);
  assert.match(api, /validateTheoryCompatibility/);
  assert.match(api, /문제와 이론의 과목이 일치하지 않습니다/);
  assert.match(api, /UPDATE questions SET active = 0/);
  assert.match(api, /deletionMode:\s*"soft"/);
  assert.match(api, /ROW_NUMBER\(\) OVER \(ORDER BY display_order, id\)/);
  assert.doesNotMatch(api, /UPDATE questions SET id\s*=/);
});

test("backup restore validates schema and checksum before atomic D1 batch", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const importUi = source("apps/frontend/src/features/admin/components/admin-core-sections.tsx");
  const repository = source("apps/backend/src/modules/admin/admin.repository.ts");
  assert.match(api, /backupVersion/);
  assert.match(api, /schemaVersion/);
  assert.match(api, /백업 무결성 검증값이 일치하지 않습니다/);
  assert.match(api, /source:\s*"pre-restore"/);
  assert.match(api, /전체 데이터를 복원합니다/);
  assert.match(api, /await adminRepository\.batch\(statements\)/);
  assert.match(repository, /await d1\.batch\(statements\)/);
  assert.match(api, /status = 'failed'/);
  assert.match(api, /safetyBackupId/);
  assert.match(api, /backupReplacementReadiness/);
  assert.match(api, /전체 교체에 필요한 백업 테이블이 누락되었습니다/);
  assert.match(api, /replacementCourseScope/);
  assert.match(api, /discardWithoutBackup/);
  assert.match(api, /skipSafetyBackup: envelope[.]metadata[.]discardWithoutBackup === true/);
  assert.match(api, /DELETE FROM questions WHERE exam_scope = \?/);
  assert.match(importUi, /백업 없이 삭제/);
  assert.match(importUi, /백업 없이 폐기 교체/);
  assert.doesNotMatch(api, /OPENAI_API_KEY[\s\S]*payload/);

  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  database.exec("INSERT INTO sample VALUES (1, 'before')");
  const rows = JSON.stringify([{ id: 1, value: "after" }, { id: 2, value: "new" }]);
  database.prepare(`
    INSERT INTO sample (id, value)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.value')
    FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET value = excluded.value
  `).run(rows);
  assert.deepEqual(
    database.prepare("SELECT * FROM sample ORDER BY id").all()
      .map((row) => ({ ...row })),
    [{ id: 1, value: "after" }, { id: 2, value: "new" }],
  );
});

test("analytics stores only allowlisted minimal events and supports admin exclusion", () => {
  const events = source("apps/backend/src/modules/events/events.service.ts")
    + source("apps/backend/src/modules/events/events.repository.ts");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const app = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx")
    + source("apps/frontend/src/features/study/telemetry/page-view-tracker.tsx");

  for (const event of [
    "page_view",
    "question_session_started",
    "question_answer_submitted",
    "question_session_completed",
    "theory_viewed",
    "related_questions_started",
    "mock_exam_started",
    "mock_exam_completed",
    "mock_exam_abandoned",
    "mock_exam_paused",
  ]) {
    assert.match(events, new RegExp(`"${event}"`));
  }
  assert.match(events, /INSERT OR IGNORE INTO analytics_events/);
  assert.match(events, /duration_ms/);
  assert.doesNotMatch(events, /payload\.answer|payload\.sql|request\.headers\.get\(["']x-forwarded-for/);
  assert.match(api, /is_admin = 0/);
  assert.match(api, /analytics_retention_days/);
  assert.match(app, /eventType:\s*"page_view"/);
  assert.match(app, /eventType:\s*"mock_exam_paused"/);
  assert.match(events, /payload[.]examScope === "SW"/);
  assert.match(app, /examScope:\s*"SW"/);
});

test("admin dashboard, analytics, and backups include SW major content", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts")
    + source("packages/shared/src/admin/backup-contract.mjs");
  const ui = source("apps/frontend/src/features/admin/components/admin-dashboard-section.tsx")
    + source("apps/frontend/src/features/admin/components/admin-analytics-section.tsx")
    + source("apps/frontend/src/features/admin/components/admin-certification-submissions.tsx")
    + source("apps/frontend/src/features/admin/components/admin-logs-section.tsx");

  assert.match(api, /FROM sw_questions/u);
  assert.match(api, /FROM sw_theories/u);
  assert.match(api, /const contentBreakdown = \[/u);
  assert.match(api, /field:\s*"SW 전공"/u);
  assert.match(api, /FROM sw_attempts sa/u);
  assert.match(api, /sa[.]user_key != \?/u);
  assert.deepEqual(BACKUP_TABLES.content, [
    "theories", "questions", "sw_theories", "sw_questions", "content_releases",
    "skct_content_releases", "skct_question_public", "skct_question_secret",
    "skct_personal_releases", "skct_personal_public_items", "skct_personal_secret_items",
    "skct_personal_release_audit",
  ]);
  assert.match(api, /sw_theories:\s*\{/u);
  assert.match(api, /sw_questions:\s*\{/u);
  assert.match(ui, /학습 분야별 운영 현황/u);
  assert.match(ui, /data[.]contentBreakdown[.]map/u);
  assert.match(ui, /자격증별 답안 제출/u);
});

test("admin analytics keeps only daily traffic and essential learning summaries", () => {
  const api = source("apps/backend/src/modules/admin/admin-read-use-cases.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-analytics-section.tsx");

  assert.match(api, /SUM\(e[.]event_type = 'page_view'\) AS page_views/u);
  assert.match(api, /dailyMap/u);
  assert.match(ui, /DailyTrafficChart/u);
  assert.match(ui, /일간 조회수와 방문/u);
  assert.doesNotMatch(api, /referrer_host|device_category|viewport_bucket|browser_family/u);
  assert.doesNotMatch(ui, /유입 경로|기기 유형|브라우저 유형|오답률이 높은 문제/u);
});

test("admin dashboard separates all five domains and explains period versus cumulative attempts", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const dashboard = source("apps/frontend/src/features/admin/components/admin-dashboard-section.tsx");
  const contentTabs = source("apps/frontend/src/features/admin/components/admin-content-shared.tsx");

  assert.match(api, /COURSE_FIELD_DEFINITIONS/u);
  assert.match(api, /contentScopesForField\(field[.]id\)/u);
  assert.match(api, /totalQuestionAttempts/u);
  assert.match(dashboard, /선택 기간 · 누적/u);
  assert.match(dashboard, /선택 기간 풀이/u);
  assert.match(dashboard, /item[.]totalQuestionAttempts/u);
  assert.match(contentTabs, /CONTENT_ADMIN_DOMAINS.map/u);
  assert.match(dashboard, /contentDomainForLabel\(item.field\)/u);
  const domains = source("packages/shared/src/admin/content-domains.ts");
  for (const label of ["SQL 자격증", "데이터 아키텍처", "빅데이터분석기사", "정보처리기사", "SW 전공"]) assert.ok(domains.includes(label));
});

test("canonical certification content forms a complete SQL, DA, BAE, IPE, and ISE dashboard partition", () => {
  const database = materializeDatabase();
  const counts = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(exam_scope IN ('SQLD', 'SQLP', 'both')) AS sql_total,
      SUM(exam_scope IN ('DASP', 'DAP', 'DA')) AS da_total,
      SUM(exam_scope = 'BAE') AS bae_total,
      SUM(exam_scope IN ('IPE', 'IPEW', 'IPEP')) AS ipe_total,
      SUM(exam_scope IN ('ISEW', 'ISEP')) AS ise_total
    FROM questions
  `).get();
  const theories = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(exam_scope IN ('SQLD', 'SQLP', 'both')) AS sql_total,
      SUM(exam_scope IN ('DASP', 'DAP', 'DA')) AS da_total,
      SUM(exam_scope = 'BAE') AS bae_total,
      SUM(exam_scope IN ('IPE', 'IPEW', 'IPEP')) AS ipe_total,
      SUM(exam_scope IN ('ISEW', 'ISEP')) AS ise_total
    FROM theories
  `).get();

  assert.ok(counts.da_total > 0);
  assert.ok(theories.da_total > 0);
  assert.equal(counts.bae_total, 1600);
  assert.equal(theories.bae_total, 54);
  assert.equal(counts.ipe_total, 3350);
  assert.equal(theories.ipe_total, 153);
  assert.equal(counts.ise_total, 50);
  assert.equal(theories.ise_total, 97);
  assert.equal(counts.sql_total + counts.da_total + counts.bae_total + counts.ipe_total + counts.ise_total, counts.total);
  assert.equal(theories.sql_total + theories.da_total + theories.bae_total + theories.ipe_total + theories.ise_total, theories.total);
});

test("real user monitoring card uses the padded card and responsive table styles", () => {
  const component = source("apps/frontend/src/features/admin/components/admin-performance-card.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");
  assert.match(component, /className="admin-card admin-padded-card admin-performance-card"/u);
  assert.equal((component.match(/<table className="admin-table">/gu) ?? []).length, 2);
  assert.equal((component.match(/className="admin-table-wrap"/gu) ?? []).length, 2);
  assert.match(styles, /\.admin-card-head > div > span/u);
});

test("admin console exposes all real sections and contains responsive overflow boundaries", () => {
  const sections = source("apps/frontend/src/features/admin/model/admin-sections.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  for (const section of [
    "dashboard",
    "questions",
    "theories",
    "quality",
    "backups",
    "transfer",
    "analytics",
    "logs",
    "settings",
  ]) {
    assert.match(sections, new RegExp(`"${section}"`));
  }
  assert.match(ui, /관리자 활동 제외/);
  assert.match(ui, /가져오기 전 검증/);
  assert.match(ui, /복원 직전에 현재 전체 데이터가 자동 백업/);
  assert.match(ui, /문제 CSV · 목록 형식/);
  assert.doesNotMatch(ui, /모의고사 운영 지표|모의고사 중도 이탈|서술형 제출 수/);
  assert.doesNotMatch(ui, /문제 풀이 전환|questionFunnel|<Funnel/);
  assert.match(styles, /@media \(max-width:\s*1024px\)/);
  assert.match(styles, /@media \(max-width:\s*768px\)/);
  assert.match(styles, /@media \(max-width:\s*430px\)/);
  assert.match(styles, /\.admin-table-wrap[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /\.admin-modal[\s\S]*max-height:\s*calc\(100dvh - 24px\)/);
});

test("admin operational cards link to details, reports are removable, and mobile labels stay intact", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-core-sections.tsx")
    + source("apps/frontend/src/features/admin/components/admin-dashboard-section.tsx")
    + source("apps/frontend/src/features/admin/components/admin-reports-section.tsx")
    + source("apps/frontend/src/features/admin/components/admin-logs-section.tsx");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const adminStyles = source("apps/frontend/app/admin/admin.css");
  const learnerStyles = source("apps/frontend/app/globals.css");

  assert.match(ui, /href="\/admin\/logs\?view=errors"/);
  assert.doesNotMatch(ui, /unresolvedWrongQuestions|복습 대기 문제/);
  assert.match(ui, /apiAction\("report-delete"/);
  assert.match(ui, /제보 삭제/);
  assert.match(api, /action === "report-delete"[\s\S]*DELETE FROM user_reports WHERE id = \?/);
  assert.match(ui, /admin-padded-card quality-results-card/);
  assert.match(ui, /admin-padded-card admin-system-status-card/);
  assert.match(adminStyles, /\.admin-padded-card\s*\{[\s\S]*padding:/);
  assert.match(adminStyles, /\.report-filter-bar\s*\{[\s\S]*padding:/);
  assert.match(
    learnerStyles,
    /@media \(max-width:\s*680px\)[\s\S]*\.mobile-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    learnerStyles,
    /@media \(max-width:\s*680px\)[\s\S]*\.mobile-nav-item\s*>\s*span\s*\{[\s\S]*white-space:\s*nowrap/,
  );
});
