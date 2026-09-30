import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

function method(sourceText, start, end) {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing method start: ${start}`);
  assert.ok(endIndex > startIndex, `missing method end: ${end}`);
  return sourceText.slice(startIndex, endIndex);
}

test("account touch keeps fresh authorization while collapsing persistence reads", () => {
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const authorization = method(
    auth,
    "export async function authorizeLearnerRequest(",
    "export const USER_REQUEST_HEADER",
  );
  const ensureAccount = method(
    auth,
    "export async function ensureLearnerAccount(",
    "export async function authorizeLearnerRequest(",
  );
  const ensureSetting = method(
    repository,
    "async ensureUserSetting(",
    "async readUserSetting(",
  );

  assert.match(authorization, /readLearnerRequestContext\(getD1\(\),userKey,\{includeRevision:true\}\)/u);
  assert.match(authorization, /authorizePrefetchedLearner\(email,userKey,context\.accountRow\)/u);
  assert.doesNotMatch(authorization, /readLearnerAccount\(email\)/u);
  assert.match(ensureAccount, /RETURNING[\s\S]*user_key AS userKey/u);
  assert.match(ensureAccount, /blocked_reason AS blockedReason/u);
  assert.match(ensureAccount, /\.first<LearnerAccount>\(\)/u);
  assert.doesNotMatch(ensureAccount, /await readLearnerAccount\(email\)/u);
  assert.match(ensureSetting, /await database\.batch\(\[/u);
  assert.match(ensureSetting, /ON CONFLICT\(user_key\) DO NOTHING/u);
  assert.match(ensureSetting, /SELECT[\s\S]*selected_exam AS selectedExam/u);
});

test("account upsert returns state without unblocking an existing learner", () => {
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const ensureAccount = method(
    auth,
    "export async function ensureLearnerAccount(",
    "export async function authorizeLearnerRequest(",
  );
  const insertSql = ensureAccount.match(
    /getD1\(\)\.prepare\(`([\s\S]*?)`\)\.bind/u,
  )?.[1];
  assert.ok(insertSql);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE user_accounts (
      user_key TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      blocked_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const statement = database.prepare(insertSql);
  const first = statement.get(
    "learner-key",
    "learner@example.com",
    "Learner",
    "2026-08-28T00:00:00.000Z",
    "2026-08-28T00:00:00.000Z",
    "2026-08-28T00:00:00.000Z",
    1,
  );
  assert.deepEqual({ ...first }, {
    userKey: "learner-key",
    email: "learner@example.com",
    displayName: "Learner",
    status: "active",
    blockedReason: "",
  });

  database.prepare(`
    UPDATE user_accounts
    SET status = 'blocked', blocked_reason = 'manual review'
    WHERE user_key = 'learner-key'
  `).run();
  const blocked = statement.get(
    "learner-key",
    "learner@example.com",
    "Renamed Learner",
    "2026-08-28T01:00:00.000Z",
    "2026-08-28T01:00:00.000Z",
    "2026-08-28T01:00:00.000Z",
    1,
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedReason, "manual review");
  assert.equal(blocked.displayName, "Renamed Learner");
  database.close();
});

test("question, bookmark, and optional setting reads share one D1 batch", () => {
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const questionQueries = source(
    "apps/backend/src/modules/study/study-question.repository-queries.ts",
  );
  const delivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");
  const recordQueries = source("apps/backend/src/modules/study/study-records.repository-queries.ts");
  const questionRead = method(
    questionQueries,
    "export async function readActiveQuestionsByIds(",
    "export async function readPracticeMetaWithSetting(",
  );

  assert.match(questionRead, /const statements = \[\.\.\.questionStatements, \.\.\.bookmarkStatements, \.\.\.settingStatements\]/u);
  assert.match(questionRead, /await database\.batch\(statements\)/u);
  assert.match(questionRead, /options\.knownBookmarkedIds === undefined/u);
  assert.doesNotMatch(questionRead, /Promise\.all\(chunks/u);
  assert.match(repository, /return readActiveQuestionsByIds\(this\.connection\(\), ids, userKey, options\)/u);
  assert.match(delivery, /includeSetting: Boolean\(key\)/u);
  assert.match(recordQueries, /options\.view === "bookmarks" \? options\.bookmarkCursor : options\.attemptCursor/u);
  assert.match(recordQueries, /FROM user_bookmarks AS b[\s\S]*b\.user_key = \?/u);
  assert.match(recordQueries, /add\("questions", recordQuestionPageStatement\(/u);
  assert.match(service, /recordQuestionPayloadsFromRows\(referencedIds, key, questionRows\)/u);
});

test("practice public metadata is cached while private settings and mock reads stay bounded", () => {
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const questionQueries = source(
    "apps/backend/src/modules/study/study-question.repository-queries.ts",
  );
  const delivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const examSessions = method(
    repository,
    "async readExamSessions(",
    "async guestImportExists(",
  );
  const practiceQuestions = questionQueries.slice(
    questionQueries.indexOf("export async function readPracticeQuestionsWithSetting("),
  );

  assert.match(practiceQuestions, /await database\.batch\(\[/u);
  assert.match(examSessions, /await database\.batch\(\[/u);
  assert.doesNotMatch(examSessions, /Promise\.all/u);
  assert.match(delivery, /readPublicContentCache\([\s\S]*findPracticeMeta\(selectedExam\)/u);
  assert.match(delivery, /Promise\.all\([\s\S]*readUserSetting\(key\)/u);
  assert.match(delivery, /findPracticeQuestionsWithSetting\(candidateInput, key\)/u);
});

test("answer confirmation batches exam-state and feedback reads", () => {
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const contextRead = source(
    "apps/backend/src/modules/study/study-attempt.repository-query.ts",
  );
  assert.match(repository, /return readPracticeAttemptContext\(this\.connection\(\), userKey, questionId\)/u);
  assert.match(contextRead, /await database\.batch\(\[/u);
  assert.match(contextRead, /exam_sessions\.status != 'submitted'/u);
  assert.match(contextRead, /correct_answers AS correctAnswers/u);
});

test("analytics events use a cached gate and a conditional single-call insert", () => {
  const repository = source("apps/backend/src/modules/events/events.repository.ts");
  const service = source("apps/backend/src/modules/events/events.service.ts");

  assert.match(repository, /ANALYTICS_SETTING_CACHE_TTL_MS = 5_000/u);
  assert.match(repository, /INSERT OR IGNORE INTO analytics_events[\s\S]*SELECT \?, \?,/u);
  assert.match(repository, /site_settings WHERE key = 'analytics_enabled'/u);
  assert.match(repository, /\? IS NULL OR EXISTS \([\s\S]*SELECT 1 FROM questions WHERE id = \?/u);
  assert.doesNotMatch(service, /repository\.questionExists/u);
  assert.match(service, /insertStatus === "disabled"/u);
  assert.match(service, /insertStatus === "invalid-question"/u);
});

test("the conditional analytics insert preserves disabled, invalid, and deduplicated outcomes", () => {
  const repository = source("apps/backend/src/modules/events/events.repository.ts");
  const insertSql = repository.match(
    /const inserted = await database\.prepare\(`([\s\S]*?)`\)\.bind/u,
  )?.[1];
  assert.ok(insertSql);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE questions (id INTEGER PRIMARY KEY);
    CREATE TABLE analytics_events (
      id TEXT PRIMARY KEY, event_type TEXT, occurred_at TEXT, anonymous_session_id TEXT,
      user_key_hash TEXT, is_admin INTEGER, exam_scope TEXT, subject TEXT,
      question_id INTEGER, content_id TEXT, answer_result TEXT, duration_ms INTEGER,
      page_path TEXT, referrer_host TEXT, device_category TEXT, viewport_bucket TEXT,
      browser_family TEXT, metric_name TEXT, metric_value REAL, api_route TEXT,
      http_status INTEGER, retry_count INTEGER, cache_source TEXT, build_sha TEXT,
      dedupe_key TEXT UNIQUE
    );
    INSERT INTO site_settings VALUES ('analytics_enabled', 'true');
    INSERT INTO questions VALUES (1);
  `);
  const statement = database.prepare(insertSql);
  const values = (id, dedupeKey, questionId) => [
    id, "page_view", "2026-08-28T00:00:00.000Z", "session", null,
    0, "SQLD", null, questionId, null, null, null, "/", "",
    "desktop", "1024-1439", "Chrome", null, null, null, 202, 0, null, null,
    dedupeKey,
  ];

  assert.equal(statement.run(...values("valid", "dedupe-valid", 1), 1, 1).changes, 1);
  assert.equal(statement.run(...values("duplicate", "dedupe-valid", 1), 1, 1).changes, 0);
  assert.equal(statement.run(...values("invalid", "dedupe-invalid", 999), 999, 999).changes, 0);
  database.prepare("UPDATE site_settings SET value = 'false'").run();
  assert.equal(statement.run(...values("disabled", "dedupe-disabled", null), null, null).changes, 0);
});

test("SW session restoration overlaps question and authorization reads", () => {
  const service = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const sessionRead = method(service, 'if (view === "session")', 'if (view === "practice")');

  assert.match(sessionRead, /const \[rows, authorization\] = await Promise\.all\(\[/u);
  assert.match(sessionRead, /repository\.findSessionQuestions\(\{/u);
  assert.match(sessionRead, /authorizeLearningSession\(request\)/u);
});
