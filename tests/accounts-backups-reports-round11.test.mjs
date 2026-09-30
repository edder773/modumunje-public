import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("account migration preserves the content bank and removes unattributable shared learning state", () => {
  const database = materializeDatabase();
  const tables = new Set(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );

  assert.ok(database.prepare("SELECT COUNT(*) AS count FROM questions").get().count > 0);
  assert.ok(database.prepare("SELECT COUNT(*) AS count FROM theories").get().count > 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exam_sessions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'theory_progress'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_evaluations").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_settings").get().count, 0);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM questions WHERE bookmarked != 0").get().count,
    0,
  );
  assert.ok(tables.has("user_bookmarks"));
  assert.ok(tables.has("user_reports"));
  assert.ok(tables.has("backup_chunks"));
});

test("catalog stays public while learning APIs and account data remain identity scoped", () => {
  const page = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const recordQueries = source("apps/backend/src/modules/study/study-records.repository-queries.ts");
  const scopes = source("apps/backend/src/modules/study/study-read-scope.ts");

  assert.match(pageSession, /getSiteUser\(\)/);
  assert.match(pageSession, /siteSignInPath\(initialPath\)/);
  assert.match(pageSession, /displayName: "비로그인 학습"/);
  assert.match(pageSession, /userKey: "guest-browser"/);
  assert.match(page, /session\.status === "guest"/);
  assert.match(page, /isAuthenticated=\{false\}/);
  assert.match(auth, /sql-study-user:/);
  assert.match(api, /parseStudyReadScope\(requestedScope\)/);
  assert.match(api, /readPublicStudyResponseCache\(request, publicKey/);
  assert.doesNotMatch(scopes, /["']full["']/);
  assert.match(api, /authorization\.response\.status !== 401/);
  assert.match(api, /authorizeLearnerRequest\(request,/);
  assert.match(api, /authorizePrefetchedLearner\(email, userKey, context\.accountRow\)/);
  assert.match(api, /authorization\.account\.userKey/);
  assert.doesNotMatch(api, /readAll\(/);
  assert.match(recordQueries, /WHERE a\.user_key = \? AND a\.exam_type = \?/);
  assert.match(recordQueries, /\.bind\(userKey, selectedExam/);
  assert.match(api, /eq\(userBookmarks\.userKey, userKey\)/);
  assert.doesNotMatch(api, /return\s+["']owner["']/);
});

test("legacy D1 backups remain readable through ordered bounded compatibility chunks", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts")
    + source("apps/backend/src/modules/admin/backup-payload.ts")
    + source("packages/shared/src/admin/backup-contract.mjs");
  const schema = source("apps/backend/src/infrastructure/database/schema.ts");

  assert.match(api, /const BACKUP_CHUNK_LENGTH = 120_000/);
  assert.match(api, /writeBackupPayload\(id, serialized\)/);
  assert.match(api, /payload = \?/);
  assert.match(api, /"@chunked"/);
  assert.match(api, /INSERT INTO backup_chunks \(snapshot_id, chunk_index, payload\)/);
  assert.match(api, /ORDER BY chunk_index/);
  assert.match(api, /chunks\.map\(\(chunk\) => String\(chunk\.payload\)\)\.join\(""\)/);
  assert.match(schema, /export const backupChunks = sqliteTable\("backup_chunks"/);
});

test("manual backups keep their request alive and stale attempts are recoverable", () => {
  const adminClient = source("apps/frontend/src/features/admin/model/admin-api-client.ts");
  const adminApi = source("apps/backend/src/modules/admin/backup-lifecycle.ts");
  const adminUi = source("apps/frontend/src/features/admin/components/admin-core-sections.tsx");
  const studyApi = source("apps/backend/src/modules/study/study.service.ts");

  assert.match(adminClient, /DURABLE_ADMIN_ACTION_BUDGET_MS = 180_000/);
  for (const action of [
    "backup-create", "backup-auto-if-due", "restore-run", "import-preview", "import-commit",
  ]) {
    assert.match(adminClient, new RegExp(`"${action}"`));
  }
  assert.match(adminClient, /attemptTimeoutMs: DURABLE_ADMIN_ACTION_BUDGET_MS/);
  assert.match(adminApi, /expireStalledBackups\(\)/);
  assert.match(adminApi, /status = 'creating'/);
  assert.match(adminApi, /'-15 minutes'/);
  assert.match(adminUi, /completed \? <a href=/);
  assert.match(adminUi, /disabled=\{locked \|\| !completed\}/);
  assert.match(adminUi, />저장 안 됨</);
  assert.match(studyApi, /이론을 찾을 수 없습니다/);
  assert.match(studyApi, /throw new StudyRequestError\(/);
});

test("learner reports are authenticated, privacy-minimized, and reviewable by admins", () => {
  const reportApi = source("apps/backend/src/modules/reports/reports.service.ts");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const adminUi = source("apps/frontend/src/features/admin/components/admin-app.tsx");

  assert.match(reportApi, /authorizeLearnerRequest\(request,/);
  assert.match(reportApi, /authorization\.account\.userKey/);
  assert.match(reportApi, /verifyUserMutationRequest\(request\)/);
  assert.match(reportApi, /INSERT INTO user_reports/);
  assert.doesNotMatch(reportApi, /INSERT INTO user_reports[\s\S]*email/);
  assert.match(adminApi, /resource === "reports"/);
  assert.match(adminApi, /action === "report-status"/);
  assert.match(adminApi, /substr\(user_key, 1, 10\) AS anonymous_user/);
  assert.match(adminUi, /사용자 제보/);
  assert.match(adminUi, /ReportsSection/);
});

test("theory navigation and descriptive setup follow their context-specific rules", () => {
  const theoryView = source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx");
  const practice = source("apps/frontend/src/features/study/components/sql/practice/practice-screen.tsx");

  assert.match(theoryView, /availableCategories\.map/);
  assert.doesNotMatch(theoryView, /<button[^>]*>\s*전체\s*</);
  assert.match(theoryView, /returnToQuestion \?/);
  assert.match(theoryView, /문제로 돌아가기/);
  assert.match(theoryView, /nextTheory/);
  assert.match(theoryView, /다음 단원 →/);
  assert.match(theoryView, /href=\{learningPath\(\{ examType, page: "theory", id: nextTheory\.id \}\)\}/);
  assert.match(practice, /type !== "descriptive" && <fieldset[\s\S]*<legend>난이도/);
  assert.match(practice, /if \(value === "descriptive"\) onDifficulty\("전체"\)/);
});

test("quality checks reuse internal model answers and dashboard exposes meaningful trends", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const adminUi = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const learnerUi = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(api, /normalizeComparableContent\(extractModelAnswer\(explanation\)\)/);
  assert.match(api, /hasSubstantiveModelAnswer/);
  assert.match(api, /!scoringCriteria\.length && !hasSubstantiveModelAnswer/);
  assert.match(api, /activityTrend/);
  assert.match(api, /AS dau/);
  assert.match(api, /AS mau/);
  assert.match(api, /AS question_attempts/);
  assert.match(adminUi, /function TrendChart/);
  assert.match(adminUi, /DAU·MAU 변화/);
  assert.match(adminUi, /문제 풀이 변화/);
  assert.match(adminUi, /trendView/);
  assert.match(adminUi, /일간 활성 사용자 \(DAU\)/);
  assert.match(adminUi, /월간 활성 사용자 \(MAU\)/);
  assert.match(learnerUi, /function questionDisplayParts/);
  assert.match(learnerUi, /주요 조건 및 자료/);
});
