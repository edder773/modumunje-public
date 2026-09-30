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

const subjectThreeTopics = [
  "데이터베이스 아키텍처",
  "SQL 처리 과정",
  "SQL 파싱과 최적화",
  "옵티마이저",
  "실행계획",
  "통계정보",
  "SQL 성능 문제 진단",
  "데이터베이스 Call 최소화",
  "인덱스 기본 원리",
  "인덱스 스캔 방식",
  "테이블 액세스 최소화",
  "조인 순서와 조인 방식",
  "NL 조인",
  "소트 머지 조인",
  "해시 조인",
  "소트 튜닝",
  "스칼라 서브쿼리",
  "서브쿼리와 조인 변환",
  "옵티마이저 쿼리 변환",
  "고급 SQL 활용",
  "파티셔닝",
  "병렬 처리",
  "트랜잭션",
  "동시성 제어",
  "Lock",
  "DML 튜닝",
];

test("subject-three theory order is durable and exactly matches the requested curriculum", () => {
  const database = materializeDatabase();
  const topics = database.prepare(`
    SELECT topic, MIN(sort_order) AS first_order
    FROM theories
    WHERE active = 1 AND category = 'SQL 고급 활용 및 튜닝'
    GROUP BY topic
    ORDER BY first_order, topic
  `).all().map((row) => row.topic);

  assert.deepEqual(topics, subjectThreeTopics);
  assert.ok(database.prepare(
    "SELECT COUNT(*) AS count FROM guest_import_batches",
  ).get().count === 0);
});

test("guest grading keeps bounded local drafts while account import remains authenticated", () => {
  const page = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/persistence/guest-learning-store.ts");
  const api = source("apps/backend/src/modules/study/study.service.ts");

  assert.match(pageSession, /userKey: "guest-browser"/u);
  assert.match(page, /userKeyHash=\{session\.userKey\}/u);
  assert.match(study, /GUEST_LEARNING_STORAGE_KEY = "baeumzip-guest-learning:v1"/u);
  assert.doesNotMatch(study, /authentication required for grading/u);
  assert.match(study, /attempts: \[\.\.\.guest.attempts, payload.attempt\].slice\(-200\)/u);
  assert.match(study, /writeGuestLearningState\(\{\s*\.\.\.guest,\s*bookmarks\s*\}\)/u);
  assert.match(study, /requestStudyMutation<GuestImportCompletion>\(\s*"guest-import"/u);
  assert.doesNotMatch(study, /window\.localStorage\.removeItem\(GUEST_LEARNING_STORAGE_KEY\)/u);
  assert.match(study, /reconcileGuestImportSnapshot\(submitted, userKeyHash\)/u);
  assert.match(study, /window\.localStorage\.setItem\(key, JSON\.stringify\(receipt\)\)/u);
  assert.match(api, /WHERE marker\.user_key = \? AND marker\.import_id = \?/u);
  assert.match(api, /GUEST_IMPORT_MARKER_SQL/u);
  assert.match(api, /question\.kind === "descriptive"/u);
  assert.match(api, /selectedAnswers\.every\(\(answer, index\) => answer === question\.correctAnswers\[index\]\)/u);
  assert.match(source("apps/backend/drizzle/0554_schema_baseline.sql"), /PRIMARY KEY\s*\(`user_key`, `import_id`\)/u);
});

test("theory practice is direct-linked and selected practice headings do not break by character", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(study, /const linked = questions\.filter\(\(question\) => question\.theoryId === theoryId\)/u);
  assert.doesNotMatch(study, /question\.tags.*article\.keywords|question\.topic === article\.topic/u);
  assert.doesNotMatch(study, /학습 흐름 선택/u);
  assert.match(styles, /\.quiz-map > strong\s*\{[\s\S]*font-size:\s*clamp\(20px,\s*1\.8vw,\s*26px\)[\s\S]*word-break:\s*keep-all/u);
});

test("admin content lists paginate before aggregation and question search accepts ID or display number", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(api, /CAST\(q\.id AS TEXT\) LIKE \?/u);
  assert.match(api, /CAST\(q\.display_order AS TEXT\) LIKE \?/u);
  assert.match(api, /WITH page_questions AS \([\s\S]*LIMIT \? OFFSET \?[\s\S]*FROM page_questions q/u);
  assert.match(api, /WITH page_theories AS \([\s\S]*LIMIT \? OFFSET \?[\s\S]*FROM page_theories t/u);
  assert.match(ui, /placeholder="문제 번호·ID·본문·소분류·태그"/u);
  assert.match(ui, /const \[pageSize, setPageSize\] = useState\(20\)/u);
  assert.match(ui, /<option value=\{50\}>50개<\/option>/u);
  assert.match(styles, /\.admin-pagination\s*\{/u);
});

test("admin dashboard omits the operational metrics the owner no longer needs", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const combined = `${ui}\n${api}`;

  for (const label of [
    "진행 중인 모의고사",
    "완료된 모의고사",
    "페이지 조회 수",
    "모의고사 중도 이탈",
    "서술형 제출 수",
    "첫 진입 페이지",
    "많이 방문한 페이지",
    "객관식 정답률",
  ]) {
    assert.doesNotMatch(combined, new RegExp(label, "u"));
  }
  assert.match(ui, /DAU·MAU 변화/u);
  assert.match(ui, /문제 풀이 변화/u);
});
