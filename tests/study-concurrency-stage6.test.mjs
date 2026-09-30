import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  examAttemptOperationId,
  guestAttemptOperationId,
  sameSqlAttemptMutation,
  sameSwActiveSessionMutation,
  sameSwAttemptMutation,
} from "../packages/shared/src/study/study-concurrency-contract.mjs";
import {
  EXAM_SUBMISSION_ATTEMPT_SQL,
  EXAM_SUBMISSION_LEASE_DELETE_SQL,
  EXAM_SUBMISSION_UPDATE_SQL,
  EXAM_SUPERSEDE_UNLEASED_SQL,
  GUEST_IMPORT_ATTEMPT_SQL,
  GUEST_IMPORT_MARKER_SQL,
  GUEST_IMPORT_RECEIPT_SQL,
} from "../apps/backend/src/modules/study/study-concurrency-sql.mjs";
import {
  SW_SESSION_INSERT_SQL,
  SW_SESSION_UPDATE_SQL,
} from "../apps/backend/src/modules/sw-study/sw-study-concurrency-sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFeatureSource(path.join(root, file), "utf8");

function atomic(database, operations, failAfter = -1) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const results = operations.map((operation, index) => {
      const result = operation();
      if (index === failAfter) throw new Error("injected transaction failure");
      return result;
    });
    database.exec("COMMIT");
    return results;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function learningDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      selected_answers TEXT NOT NULL,
      correct INTEGER NOT NULL,
      mode TEXT NOT NULL,
      user_key TEXT NOT NULL,
      exam_type TEXT NOT NULL,
      result TEXT NOT NULL,
      score INTEGER NOT NULL,
      answer_text TEXT NOT NULL DEFAULT '',
      evaluation_id INTEGER,
      review_status TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      client_operation_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX attempts_user_operation_uidx
      ON attempts(user_key, client_operation_id)
      WHERE client_operation_id IS NOT NULL AND length(client_operation_id) > 0;
    CREATE TABLE guest_import_batches (
      user_key TEXT NOT NULL,
      import_id TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_key, import_id)
    );
    CREATE TABLE guest_import_receipts (
      user_key TEXT NOT NULL,
      import_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_key, import_id),
      FOREIGN KEY(user_key, import_id) REFERENCES guest_import_batches(user_key, import_id)
        DEFERRABLE INITIALLY DEFERRED
    );
  `);
  return database;
}

test("stage6 rejects one idempotency key reused for a different mutation", () => {
  const sqlExisting = {
    questionId: 7,
    selectedAnswers: "[1]",
    correct: true,
    mode: "practice",
    examType: "SQLP",
    result: "correct",
    score: 100,
    answerText: "",
    evaluationId: null,
    reviewStatus: "mastered",
    isAdmin: false,
  };
  assert.equal(sameSqlAttemptMutation(sqlExisting, { ...sqlExisting }), true);
  assert.equal(sameSqlAttemptMutation(sqlExisting, { ...sqlExisting, questionId: 8 }), false);
  assert.equal(sameSqlAttemptMutation(sqlExisting, { ...sqlExisting, selectedAnswers: "[0]" }), false);

  const swExisting = {
    questionId: "SW-1",
    selectedAnswers: "[0]",
    correct: false,
    mode: "practice",
  };
  assert.equal(sameSwAttemptMutation(swExisting, { ...swExisting, selectedAnswers: [0] }), true);
  assert.equal(sameSwAttemptMutation(swExisting, { ...swExisting, questionId: "SW-2" }), false);
});

test("guest import attempts and marker are replay-safe and roll back together", () => {
  const database = learningDatabase();
  database.exec("CREATE TABLE exam_sessions (id TEXT PRIMARY KEY, user_key TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE exam_session_items (session_id TEXT NOT NULL, question_id INTEGER NOT NULL);");
  const importId = "guest_import_123456";
  const operationId = guestAttemptOperationId(importId, 0);
  const expected = JSON.stringify([{
    operationId, questionId: 7, selectedAnswers: "[1]", correct: 1,
    mode: "guest-import:practice", examType: "SQLP", result: "correct", score: 100,
    answerText: "", reviewStatus: "mastered", isAdmin: 0,
    createdAt: "2026-08-23T00:00:00.000Z", compareCreatedAt: 1,
  }]);
  const insertAttempt = () => database.prepare(GUEST_IMPORT_ATTEMPT_SQL).run(
    7, "[1]", 1, "guest-import:practice", "user-1", "SQLP",
    "correct", 100, "", "mastered", 0, operationId, "2026-08-23T00:00:00.000Z",
    "[7]", "user-1",
    "user-1", importId,
  );
  const insertReceipt = () => database.prepare(GUEST_IMPORT_RECEIPT_SQL).run(
    "user-1", importId, "d".repeat(64), "[7]", "user-1", expected, "user-1", "user-1",
    `guest_${importId}_[0-9][0-9][0-9][0-9]`, expected, "user-1", importId,
  );
  const insertMarker = () => database.prepare(GUEST_IMPORT_MARKER_SQL).run(
    "user-1", importId, "[7]", "user-1", expected, "user-1", "user-1",
    `guest_${importId}_[0-9][0-9][0-9][0-9]`, expected, "user-1", importId, "d".repeat(64),
  );

  assert.throws(() => atomic(database, [insertAttempt, insertReceipt, insertMarker], 1), /injected/u);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM guest_import_batches").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM guest_import_receipts").get().count, 0);

  const first = atomic(database, [insertAttempt, insertReceipt, insertMarker]);
  const replay = atomic(database, [insertAttempt, insertReceipt, insertMarker]);
  assert.equal(first[0].changes, 1);
  assert.equal(first[1].changes, 1);
  assert.equal(first[2].changes, 1);
  assert.equal(replay[0].changes, 0);
  assert.equal(replay[1].changes, 0);
  assert.equal(replay[2].changes, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM guest_import_batches").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM guest_import_receipts").get().count, 1);
});

test("guest import cannot store grading for a question in the member's active exam", () => {
  const database = learningDatabase();
  database.exec("CREATE TABLE exam_sessions (id TEXT PRIMARY KEY, user_key TEXT NOT NULL, status TEXT NOT NULL); CREATE TABLE exam_session_items (session_id TEXT NOT NULL, question_id INTEGER NOT NULL);");
  database.prepare("INSERT INTO exam_sessions(id,user_key,status) VALUES('exam-1','user-1','active')").run();
  database.prepare("INSERT INTO exam_session_items(session_id,question_id) VALUES('exam-1',7)").run();
  const insert = (questionId, userKey) => database.prepare(GUEST_IMPORT_ATTEMPT_SQL).run(
    questionId, "[1]", 1, "guest-import:practice", userKey, "SQLP",
    "correct", 100, "", "mastered", 0, `import-${questionId}-${userKey}`,
    "2026-08-23T00:00:00.000Z",
    JSON.stringify([questionId]), userKey,
    userKey, "independent-import-id",
  );
  assert.equal(insert(7, "user-1").changes, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
  assert.equal(insert(7, "user-2").changes, 1);
  database.prepare("UPDATE exam_sessions SET status='submitted' WHERE id='exam-1'").run();
  assert.equal(insert(7, "user-1").changes, 1);
});

test("exam submission state, attempts, and active lease commit or roll back as one unit", () => {
  const database = learningDatabase();
  database.exec(`
    CREATE TABLE exam_sessions (
      id TEXT PRIMARY KEY, user_key TEXT NOT NULL, status TEXT NOT NULL,
      answers TEXT NOT NULL, descriptive_answers TEXT NOT NULL,
      descriptive_scores TEXT NOT NULL, descriptive_snapshots TEXT NOT NULL,
      flagged TEXT NOT NULL, current_index INTEGER NOT NULL,
      submitted_at TEXT, result TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE exam_active_sessions (
      user_key TEXT NOT NULL, exam_type TEXT NOT NULL, session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(user_key, exam_type)
    );
    INSERT INTO exam_sessions VALUES (
      'session_123456789', 'user-1', 'grading', '{}', '{}', '{}', '{}', '[]', 0,
      NULL, '{}', '2026-08-23T00:00:00.000Z'
    );
    INSERT INTO exam_active_sessions VALUES (
      'user-1', 'SQLP', 'session_123456789', '2026-08-23T00:00:00.000Z'
    );
  `);
  const submittedAt = "2026-08-23T00:01:00.000Z";
  const update = () => database.prepare(EXAM_SUBMISSION_UPDATE_SQL).run(
    "{\"7\":[1]}", "{}", "{}", "{}", "[]", 0, submittedAt,
    "{\"score\":100}", submittedAt, "session_123456789", "user-1",
  );
  const attempt = () => database.prepare(EXAM_SUBMISSION_ATTEMPT_SQL).run(
    7, "[1]", 1, "mock-exam", "user-1", "SQLP", "correct", 100,
    "", null, "mastered", 0, examAttemptOperationId("session_123456789", 7),
    "session_123456789", "user-1", submittedAt,
  );
  const release = () => database.prepare(EXAM_SUBMISSION_LEASE_DELETE_SQL).run(
    "user-1", "session_123456789", "session_123456789", "user-1", submittedAt,
  );

  assert.throws(() => atomic(database, [update, attempt, release], 0), /injected/u);
  assert.equal(database.prepare("SELECT status FROM exam_sessions").get().status, "grading");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exam_active_sessions").get().count, 1);

  atomic(database, [update, attempt, release]);
  assert.equal(database.prepare("SELECT status FROM exam_sessions").get().status, "submitted");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM attempts").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exam_active_sessions").get().count, 0);
});

test("simultaneous exam starts keep one leased active session and supersede the loser", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE exam_sessions (
      id TEXT PRIMARY KEY, user_key TEXT NOT NULL, status TEXT NOT NULL,
      submitted_at TEXT, result TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE exam_active_sessions (
      user_key TEXT NOT NULL, exam_type TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL, PRIMARY KEY(user_key, exam_type)
    );
  `);
  const start = (id) => atomic(database, [
    () => database.prepare(`
      INSERT INTO exam_sessions VALUES (?, 'user-1', 'active', NULL, '{}', ?)
    `).run(id, "2026-08-23T00:00:00.000Z"),
    () => database.prepare(`
      INSERT INTO exam_active_sessions VALUES ('user-1', 'SQLP', ?, ?)
      ON CONFLICT(user_key, exam_type) DO NOTHING
    `).run(id, "2026-08-23T00:00:00.000Z"),
    () => database.prepare(EXAM_SUPERSEDE_UNLEASED_SQL).run(
      "2026-08-23T00:00:00.000Z", "{\"superseded\":true}",
      "2026-08-23T00:00:00.000Z", id, "user-1", id,
    ),
  ]);
  start("session-first-1234");
  start("session-second-123");
  assert.deepEqual(
    database.prepare("SELECT id, status FROM exam_sessions ORDER BY id").all()
      .map((row) => ({ ...row })),
    [
      { id: "session-first-1234", status: "active" },
      { id: "session-second-123", status: "submitted" },
    ],
  );
  assert.equal(database.prepare("SELECT session_id FROM exam_active_sessions").get().session_id, "session-first-1234");
});

test("SW session CAS cannot overwrite a submitted session or create two active sessions", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE sw_learning_sessions (
      id TEXT PRIMARY KEY, user_key TEXT NOT NULL, mode TEXT NOT NULL,
      status TEXT NOT NULL, subject_ids TEXT NOT NULL, question_ids TEXT NOT NULL,
      answers TEXT NOT NULL, revealed_question_ids TEXT NOT NULL,
      current_index INTEGER NOT NULL, result TEXT NOT NULL,
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX sw_learning_sessions_active_uidx
      ON sw_learning_sessions(user_key, mode) WHERE status = 'active';
  `);
  const insert = (id) => database.prepare(SW_SESSION_INSERT_SQL).run(
    id, "user-1", "practice", "active", "[\"algorithms\"]", "[\"SW-1\"]",
    "{}", "[]", 0, "{}", "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z",
  );
  assert.equal(insert("sw_session_12345").changes, 1);
  assert.equal(insert("sw_session_67890").changes, 0);
  const submit = database.prepare(SW_SESSION_UPDATE_SQL).run(
    "submitted", "[\"algorithms\"]", "[\"SW-1\"]", "{\"SW-1\":[0]}",
    "[\"SW-1\"]", 0, "{\"score\":100}", "2026-08-23T00:01:00.000Z",
    "sw_session_12345", "user-1", 0,
  );
  assert.equal(submit.changes, 1);
  const reopen = database.prepare(SW_SESSION_UPDATE_SQL).run(
    "active", "[\"algorithms\"]", "[\"SW-1\"]", "{}", "[]", 0, "{}",
    "2026-08-23T00:02:00.000Z", "sw_session_12345", "user-1", 1,
  );
  assert.equal(reopen.changes, 0);
  assert.equal(database.prepare("SELECT status FROM sw_learning_sessions").get().status, "submitted");
});

test("identical SW active session retries are distinguishable from stale changes", () => {
  const existing = {
    mode: "practice",
    status: "active",
    subjectIds: "[\"algorithms\"]",
    questionIds: "[\"SW-1\"]",
    answers: "{\"SW-1\":[0]}",
    revealedQuestionIds: "[\"SW-1\"]",
    currentIndex: 0,
  };
  const requested = {
    mode: "practice",
    status: "active",
    subjectIds: ["algorithms"],
    questionIds: ["SW-1"],
    answers: { "SW-1": [0] },
    revealedQuestionIds: ["SW-1"],
    currentIndex: 0,
  };
  assert.equal(sameSwActiveSessionMutation(existing, requested), true);
  assert.equal(sameSwActiveSessionMutation(existing, {
    ...requested,
    answers: { "SW-1": [1] },
  }), false);
});

test("production repositories keep concurrency guards inside D1 batches", () => {
  const studyRepository = source("apps/backend/src/modules/study/study.repository.ts");
  const guestImportRepositoryQuery = source("apps/backend/src/modules/study/study-guest-import.repository-query.ts");
  const sessionRepository = source("apps/backend/src/modules/study/study-session.repository.ts");
  const swRepository = source("apps/backend/src/modules/sw-study/sw-study.repository.ts");
  const swConcurrencySql = source("apps/backend/src/modules/sw-study/sw-study-concurrency-sql.mjs");
  const sqlAttemptService = source("apps/backend/src/modules/study/study-attempt.service.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const integrity = source("scripts/lib/data-integrity.mjs");
  const schemaBaseline = source("apps/backend/drizzle/0554_schema_baseline.sql");
  const studyService = source("apps/backend/src/modules/study/study.service.ts");

  assert.match(studyRepository, /commitGuestImport\(this\.connection\(\), input\)/u);
  assert.match(guestImportRepositoryQuery, /guestAttemptOperationId\(input\.importId, index\)/u);
  assert.match(guestImportRepositoryQuery, /d1\.batch\(statements\)/u);
  assert.match(studyRepository, /sameSqlAttemptMutation/u);
  assert.match(sessionRepository, /EXAM_SUBMISSION_LEASE_DELETE_SQL/u);
  assert.match(sessionRepository, /EXAM_SUPERSEDE_UNLEASED_SQL/u);
  assert.doesNotMatch(sessionRepository, /await this\.orm\(\)\.delete\(examActiveSessions\)/u);
  assert.match(swRepository, /current\.status === "submitted"[\s\S]*outcome: "conflict"/u);
  assert.match(swConcurrencySql, /status = 'active' AND revision = \?/u);
  assert.match(sqlAttemptService, /STUDY_IDEMPOTENCY_CONFLICT/u);
  assert.match(swService, /SW_IDEMPOTENCY_CONFLICT/u);
  assert.match(integrity, /unleasedActiveExamSessions/u);
  assert.match(schemaBaseline, /submitted exam session cannot be reopened/u);
  assert.match(schemaBaseline, /submitted SW learning session cannot be reopened/u);
  assert.match(studyService, /EXAM_GRADING_LEASE_MS/u);
  assert.match(studyService, /staleBefore/u);
});
