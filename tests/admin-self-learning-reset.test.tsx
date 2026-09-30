import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCanonicalMigrations } from "../scripts/lib/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { adminUserHash, learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "../packages/shared/src/auth/authenticated-user";
import { SELF_LEARNING_RESET_CONFIRMATION, SELF_LEARNING_RESET_LABELS } from "../packages/shared/src/admin/self-learning-reset";
import AdminSelfLearningReset from "../apps/frontend/src/features/admin/components/admin-self-learning-reset";

const email = "admin@example.test";
const resetTables = new Set(Object.keys(SELF_LEARNING_RESET_LABELS));
function snapshot(db: DatabaseSync) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [String(name), db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}
async function fixture() {
  const db = applyCanonicalMigrations(new DatabaseSync(":memory:"), process.cwd());
  const userKey = await learnerUserHash(email);
  const identity = { email, hash: await adminUserHash(email) };
  db.exec(`
    INSERT INTO course_content_scopes VALUES ('SQLD', 'both'), ('SQLP', 'both');
    INSERT INTO course_subjects VALUES ('SQLD', 'test'), ('SQLP', 'test');
    INSERT INTO theories (id, title, category) VALUES (1, 'Preserved theory', 'test');
    INSERT INTO questions (id, category, prompt, choices, correct_answers, theory_id) VALUES (1, 'test', 'Preserved question', '["A","B"]', '[0]', 1);
    INSERT INTO sw_theories (id, subject_group_id, subject_id, category, topic, title) VALUES (1, 'g', 's', 'c', 't', 'Preserved SW theory');
    INSERT INTO sw_questions (id, theory_id, subject_group_id, subject_id, category, topic, prompt, choices, correct_answers) VALUES ('q1', 1, 'g', 's', 'c', 't', 'Preserved SW question', '["A","B","C","D"]', '[0]');
    INSERT INTO sw_question_tags (question_id, tag) VALUES ('q1', 'keep');
    INSERT INTO site_settings (key, value) VALUES ('site_notice', 'Preserve settings');
    INSERT INTO admin_audit_logs (id, admin_user_hash, action) VALUES ('old-audit', 'old-admin', 'preserve');
    INSERT INTO backup_snapshots (id, backup_type, status, schema_version, app_version, included_data, counts, checksum, payload, byte_size, created_by_hash, created_at, error_message)
      VALUES ('preserved-backup', 'full', 'completed', '0557', 'test', '[]', '{}', 'hash', '{}', 2, 'admin', '2026-09-09T00:00:00Z', '');
    INSERT INTO backup_chunks VALUES ('preserved-backup', 0, 'keep backup');
  `);
  for (const key of [userKey, "other-user", "owner", "anonymous-legacy"]) {
    const run = (sql: string, ...values: SQLInputValue[]) => db.prepare(sql).run(...values);
    run("INSERT INTO user_accounts (user_key, email, display_name) VALUES (?, ?, ?)", key, key === userKey ? email : `${key}@example.test`, key);
    run("INSERT INTO user_settings (user_key, selected_exam) VALUES (?, 'SQLD')", key);
    run("INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, 1)", key);
    run("INSERT INTO guest_import_batches (user_key, import_id) VALUES (?, 'already-imported')", key);
    run("INSERT INTO user_reports (id, user_key, category, title, description) VALUES (?, ?, 'bug', 'Keep report', 'Keep description')", `report-${key}`, key);
    run("INSERT INTO analytics_events (id, event_type, anonymous_session_id, user_key_hash, dedupe_key) VALUES (?, 'page_view', 'anonymous-session', ?, ?)", `visit-${key}`, key, `dedupe-${key}`);
    const evaluation = run("INSERT INTO ai_evaluations (user_key, question_id, answer_hash, result, score) VALUES (?, 1, 'answer', 'correct', 100)", key);
    run("INSERT INTO attempts (question_id, selected_answers, correct, result, user_key, evaluation_id, is_admin) VALUES (1, '[0]', 1, 'correct', ?, ?, ?)", key, evaluation.lastInsertRowid, key === userKey ? 0 : 1);
    run("INSERT INTO sw_attempts (user_key, question_id, correct, client_operation_id) VALUES (?, 'q1', 1, 'operation')", key);
    for (const status of ["active", "submitted"]) {
      const id = `${key}-${status}`;
      run("INSERT INTO exam_sessions (id, user_key, exam_type, status, question_ids, started_at, ends_at) VALUES (?, ?, 'SQLD', ?, '[1]', '2026-09-10T00:00:00Z', '2026-09-11T00:00:00Z')", id, key, status);
      run("INSERT INTO exam_session_items (session_id, question_id, position, selected_answers) VALUES (?, 1, 0, '[0]')", id);
      if (status === "active") run("INSERT INTO exam_active_sessions (user_key, exam_type, session_id) VALUES (?, 'SQLD', ?)", key, id);
      run("INSERT INTO sw_learning_sessions (id, user_key, mode, status) VALUES (?, ?, ?, ?)", id, key, status === "active" ? "practice" : "mock", status);
    }
  }
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database, ADMIN_EMAIL: email };
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "self-reset-test", configurable: true });
  const service = await import("../apps/backend/src/modules/admin/admin-self-learning-reset");
  const request = (resetId = crypto.randomUUID()) => ({ action: "self-learning-reset", resetId, confirmation: SELF_LEARNING_RESET_CONFIRMATION, acknowledged: true });
  return { db, userKey, identity, service, request, close() { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; } };
}

test("reset deletes every self-owned record atomically, preserves all other tables and all other/legacy users byte-for-byte", async () => {
  const f = await fixture();
  try {
    const before = snapshot(f.db);
    const preview = await f.service.readSelfLearningReset(f.identity);
    assert.deepEqual(preview.counts, { attempts: 1, ai_evaluations: 1, sw_attempts: 1, exam_session_items: 2, exam_active_sessions: 1, exam_sessions: 2, sw_learning_sessions: 2 });
    assert.equal(preview.email, email);
    const result = await f.service.resetSelfLearningRecords(f.identity, f.request(preview.resetId));
    assert.deepEqual(result.deleted, preview.counts);
    assert.equal(result.replayed, false);
    const after = snapshot(f.db);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "admin_audit_logs") continue;
      const expected = resetTables.has(table) ? rows.filter(row => (
        table === "exam_session_items" ? !String(row.session_id).startsWith(`${f.userKey}-`) : row.user_key !== f.userKey
      )) : rows;
      assert.deepEqual(after[table], expected, table);
    }
    const audit = f.db.prepare("SELECT * FROM admin_audit_logs WHERE id = ?").get(preview.resetId)!;
    assert.deepEqual(JSON.parse(String(audit.before_summary)), preview.counts);
    assert.ok(Object.values(JSON.parse(String(audit.after_summary))).every(value => value === 0));
    assert.equal(audit.target_id, f.userKey.slice(0, 12));
    assert.equal(after.admin_audit_logs.length, before.admin_audit_logs.length + 1);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.ok(Object.values((await f.service.readSelfLearningReset(f.identity)).counts).every(count => count === 0));
  } finally { f.close(); }
});

test("storage failure rolls back the audit and every deletion, leaving the same operation safe to retry", async () => {
  const f = await fixture();
  try {
    f.db.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON sw_learning_sessions BEGIN SELECT RAISE(ABORT, 'simulated reset failure'); END;");
    const before = snapshot(f.db);
    const request = f.request();
    await assert.rejects(f.service.resetSelfLearningRecords(f.identity, request), /simulated reset failure/u);
    assert.deepEqual(snapshot(f.db), before);
    f.db.exec("DROP TRIGGER fail_reset");
    const result = await f.service.resetSelfLearningRecords(f.identity, request);
    assert.equal(result.deleted.attempts, 1);
  } finally { f.close(); }
});

test("a repeated operation ID returns the original result without deleting newly created learning records", async () => {
  const f = await fixture();
  try {
    const request = f.request();
    const result = await f.service.resetSelfLearningRecords(f.identity, request);
    f.db.prepare("INSERT INTO attempts (question_id, selected_answers, correct, result, user_key) VALUES (1, '[0]', 1, 'correct', ?)").run(f.userKey);
    const replay = await f.service.resetSelfLearningRecords(f.identity, request);
    assert.deepEqual(replay, { ...result, replayed: true });
    assert.equal((await f.service.readSelfLearningReset(f.identity)).counts.attempts, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'self-learning-reset'").get()!.n, 1);
  } finally { f.close(); }
});

test("cross-account exam and grading links fail closed before any deletion", async () => {
  for (const kind of ["exam", "grading"]) {
    const f = await fixture();
    try {
      if (kind === "exam") {
        // Simulate a legacy corrupt row, then restore the current guard. Production
        // schema is unchanged; this tests defense beyond insert-time validation.
        const trigger = f.db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'exam_active_sessions_integrity_before_insert'").get()!;
        f.db.exec("DROP TRIGGER exam_active_sessions_integrity_before_insert");
        f.db.prepare("INSERT INTO exam_active_sessions (user_key, exam_type, session_id) VALUES ('other-user', 'SQLP', ?)").run(`${f.userKey}-submitted`);
        f.db.exec(String(trigger.sql));
      } else f.db.prepare("UPDATE attempts SET evaluation_id = (SELECT id FROM ai_evaluations WHERE user_key = ?) WHERE user_key = 'other-user'").run(f.userKey);
      const before = snapshot(f.db);
      await assert.rejects(f.service.resetSelfLearningRecords(f.identity, f.request()), /다른 계정의 연결/u);
      assert.deepEqual(snapshot(f.db), before);
    } finally { f.close(); }
  }
});

test("confirmation, acknowledgement and client-selected accounts/scopes are rejected", async () => {
  const f = await fixture();
  try {
    const before = snapshot(f.db);
    for (const overrides of [{ confirmation: "" }, { acknowledged: false }, { userKey: "other-user" }, { email: email }, { id: "owner" }, { tables: ["user_accounts"] }, { resetId: "' OR 1=1 --" }]) {
      await assert.rejects(f.service.resetSelfLearningRecords(f.identity, { ...f.request(), ...overrides }));
      assert.deepEqual(snapshot(f.db), before);
    }
    await assert.rejects(f.service.resetSelfLearningRecords({ email: "other@example.test", hash: f.identity.hash }, f.request()), /관리자 본인/u);
  } finally { f.close(); }
});

test("preview and reset enforce admin authentication and mutation origin, and the authenticated request targets self only", async () => {
  const f = await fixture();
  try {
    const { GET, POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const headers = { [AUTHENTICATED_USER_EMAIL_HEADER]: email, "x-sql-study-admin-request": "1", origin: "https://example.test" };
    for (const values of [{}, { [AUTHENTICATED_USER_EMAIL_HEADER]: "other@example.test" }]) {
      const result = await GET(new Request("https://example.test/api/admin?resource=self-learning-reset", { headers: values as HeadersInit }));
      assert.ok([401, 403].includes(result.status));
    }
    for (const requestHeaders of [{}, { [AUTHENTICATED_USER_EMAIL_HEADER]: email }, { ...headers, origin: "https://attacker.test" }]) {
      const result = await POST(new Request("https://example.test/api/admin", { method: "POST", headers: requestHeaders as HeadersInit, body: JSON.stringify(f.request()) }));
      assert.ok([401, 403].includes(result.status));
    }
    const preview = await GET(new Request("https://example.test/api/admin?resource=self-learning-reset", { headers }));
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("cache-control")!, /no-store/u);
    const body = await preview.json() as { resetId: string };
    const response = await POST(new Request("https://example.test/api/admin", { method: "POST", headers, body: JSON.stringify(f.request(body.resetId)) }));
    assert.equal(response.status, 200);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key = 'other-user'").get()!.n, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'self-learning-reset'").get()!.n, 1);
  } finally { f.close(); }
});

test("the feature is self-specific and starts with inspection, not an enabled destructive action", () => {
  const html = renderToStaticMarkup(<AdminSelfLearningReset onReset={async () => {}} />);
  assert.match(html, /관리자 본인 학습 기록 초기화/u);
  assert.match(html, /내 기록 초기화 범위 확인/u);
  assert.match(html, /북마크/u);
  assert.doesNotMatch(html, /내 기록 영구 삭제/u);
});
