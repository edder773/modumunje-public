import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { tsImport } from "tsx/esm/api";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { restoreSwSessionSnapshot } from "../apps/frontend/src/features/study/model/sw-session-restore.mjs";
import { validateSwStudyMutationRequest } from "../packages/shared/src/study/study-mutation-contract.mjs";

const { createSwAccountSync } = await tsImport("../apps/frontend/src/features/study/model/sw-account-sync.ts", import.meta.url);
const { persistSwPracticeQuestionBatch } = await tsImport("../apps/frontend/src/features/study/model/sw-session-snapshot.ts", import.meta.url);
const { GET, POST } = await tsImport("../apps/backend/src/modules/sw-study/sw-study.service.ts", import.meta.url);
const { learnerUserHash } = await tsImport("../apps/backend/src/common/auth/admin-auth.ts", import.meta.url);
const { AUTHENTICATED_USER_EMAIL_HEADER, SW_STUDY_OWNER_HEADER } = await tsImport("../packages/shared/src/auth/authenticated-user.ts", import.meta.url);
const { writeAdminAudit } = await tsImport("../apps/backend/src/common/observability/index.ts", import.meta.url);
globalThis.__BAEUMZIP_APP_VERSION__ = "0.1.0-test";
const { readLogs } = await tsImport("../apps/backend/src/modules/admin/admin-read-use-cases.ts", import.meta.url);
const email = "p2-synthetic@example.test";
const owner = await learnerUserHash(email);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function syncHarness(overrides = {}) {
  const events = [];
  let local = 'local-draft';
  const sync = createSwAccountSync({
    snapshot: () => local,
    importSnapshot: async () => { events.push("import"); },
    readAccount: async () => { events.push("read"); return "account"; },
    applyAccount: (value) => { events.push("apply"); local = value; },
    onBusy: (value) => events.push(["busy", value]),
    onError: (error) => events.push(["error", error]),
    ...overrides,
  });
  return { ...sync, events, local: () => local };
}

test("P2 sync: failed import stays visible and preserves local draft until a successful retry", async () => {
  let fail = true;
  const error = new Error("503 import unavailable");
  const sync = syncHarness({ importSnapshot: async () => { if (fail) throw error; } });
  assert.equal(await sync.run(), false);
  assert.equal(sync.local(), "local-draft");
  assert.ok(!sync.events.includes("read"));
  assert.ok(sync.events.some((event) => event[0] === "error" && event[1] === error));
  fail = false;
  assert.equal(await sync.run(), true);
  assert.equal(sync.local(), "account");
  assert.deepEqual(sync.events.slice(-2), [["error", null], ["busy", false]]);
  const count = sync.events.length;
  assert.equal(await sync.run(), true);
  assert.equal(sync.events.length, count);
});

test("P2 sync: successful import is not repeated after a failed account read", async () => {
  let imports = 0, reads = 0;
  const sync = syncHarness({
    importSnapshot: async () => { imports += 1; },
    readAccount: async () => { if (++reads === 1) throw new Error("offline"); return "account"; },
  });
  assert.equal(await sync.run(), false);
  assert.equal(sync.local(), "local-draft");
  assert.equal(await sync.run(), true);
  assert.equal(imports, 1); assert.equal(reads, 2);
});

test("P4-2 sync: a verified account returned by import avoids the dependent GET", async () => {
  let reads = 0;
  const sync = syncHarness({
    importSnapshot: async () => ({ account: "imported-account" }),
    accountFromImport: (result) => result.account,
    readAccount: async () => { reads += 1; return "stale-account"; },
  });
  assert.equal(await sync.run(), true);
  assert.equal(sync.local(), "imported-account");
  assert.equal(reads, 0);
  assert.deepEqual(sync.events.slice(0, 3), [["busy", true], "apply", ["error", null]]);
});

test("P2 sync: manual and online retries share one request; cancellation ignores late results", async () => {
  const first = deferred(), second = deferred();
  let reads = 0;
  const sync = syncHarness({ readAccount: () => (++reads === 1 ? first.promise : second.promise) });
  const abandoned = sync.run();
  assert.equal(sync.run(), abandoned);
  await new Promise((done) => setImmediate(done));
  sync.cancel();
  const retry = sync.run();
  assert.notEqual(retry, abandoned);
  await new Promise((done) => setImmediate(done));
  const eventCount = sync.events.length;
  first.resolve("old-account");
  assert.equal(await abandoned, false);
  assert.equal(sync.local(), "local-draft");
  assert.equal(sync.events.length, eventCount);
  second.resolve("new-account");
  assert.equal(await retry, true);
  assert.equal(sync.local(), "new-account");
});

test("P2 sync: local edits after a failed read are imported on the next retry", async () => {
  let local = "first", reads = 0;
  const imported = [];
  const sync = syncHarness({
    snapshot: () => local,
    importSnapshot: async (snapshot) => { imported.push(snapshot); },
    readAccount: async () => { if (++reads === 1) throw new Error("offline"); return "done"; },
  });
  await sync.run(); local = "edited";
  assert.equal(await sync.run(), true);
  assert.deepEqual(imported, ["first", "edited"]);
});

function globalValue(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  });
}
function database(t) {
  const db = openCanonicalTestDatabase(process.cwd());
  t.after(() => db.close());
  class Statement {
    constructor(sql) { this.sql = sql; this.values = []; }
    bind(...values) { this.values = values; return this; }
    execute() { return { success: true, results: db.prepare(this.sql).all(...this.values), meta: db.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get() }; }
    async all() { return this.execute(); }
    async first(column) { const row = this.execute().results[0] ?? null; return column && row ? row[column] : row; }
    async run() { return this.execute(); }
  }
  globalValue(t, "__BAEUMZIP_ENV__", {
    GOOGLE_AUTH_SESSION_SECRET: "p2-synthetic-session-secret-at-least-32-characters",
    DB: { prepare: (sql) => new Statement(sql), async batch(statements) {
      db.exec("BEGIN");
      try { const results = statements.map((statement) => statement.execute()); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    } },
  });
  globalValue(t, "__BAEUMZIP_BUILD_SHA__", "374d3a8b07e69ee2fd638fd5e1293a002c417028");
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected external network request"); });
  return db;
}
function post(payload) {
  return POST(new Request("https://baeumzip.test/api/sw-study", { method: "POST", headers: {
    "Content-Type": "application/json", "x-sql-study-user-request": "1",
    [AUTHENTICATED_USER_EMAIL_HEADER]: email, [SW_STUDY_OWNER_HEADER]: owner,
  }, body: JSON.stringify(payload) }));
}
function sample(db, count = 120) {
  const rows = db.prepare("SELECT id FROM sw_questions WHERE subject_id = 'algorithms' ORDER BY id LIMIT ?").all(count);
  assert.equal(rows.length, count);
  return rows;
}
function session(ids, extras = {}) {
  return { id: "sw_p2_session_0001", revision: 0, mode: "practice", subjectIds: ["algorithms"], questionIds: ids,
    answers: {}, revealedQuestionIds: [], currentIndex: 0, ...extras };
}
async function save(value, action = "sw-session-save") {
  const response = await post({ ...value, action, sessionId: value.id });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return { status: "saved", ...body };
}

test("P4-2 sync: real API returns account state after repaired import without a follow-up GET", async (t) => {
  const db = database(t);
  const { requestSwStudyMutation } = await tsImport("../apps/frontend/src/features/study/model/study-mutation-api-client.ts", import.meta.url);
  const { requestSwStudyData } = await tsImport("../apps/frontend/src/features/study/model/sw-study-api-client.ts", import.meta.url);
  globalValue(t, "window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  const calls = [], errors = [];
  let snapshot = { completedTheoryIds: [], activeSession: session(["SW-MISSING-P2"]) };
  const original = JSON.stringify(snapshot);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new Request(new URL(String(url), "https://baeumzip.test"), init);
    assert.equal(request.headers.get(SW_STUDY_OWNER_HEADER), owner);
    request.headers.set(AUTHENTICATED_USER_EMAIL_HEADER, email);
    calls.push(request.method);
    return request.method === "POST" ? POST(request) : GET(request);
  });
  let applied = 0;
  const sync = createSwAccountSync({
    snapshot: () => JSON.stringify(snapshot),
    importSnapshot: (raw, signal) => requestSwStudyMutation("sw-import", JSON.parse(raw), signal, owner),
    accountFromImport: (result) => result.account,
    readAccount: (signal) => requestSwStudyData({ view: "state", cacheMode: "none", expectedUserKey: owner, signal }),
    applyAccount: (account) => { applied += 1; assert.equal(account.sessions[0].id, snapshot.activeSession.id); },
    onBusy() {}, onError: (error) => errors.push(error),
  });
  assert.equal(await sync.run(), false);
  assert.equal(errors[0].code, "SW_SESSION_CONTENT_CHANGED");
  assert.equal(JSON.stringify(snapshot), original);
  assert.deepEqual(calls, ["POST"]); assert.equal(applied, 0);
  snapshot = { ...snapshot, activeSession: session(sample(db, 1).map((q) => q.id)) };
  assert.equal(await sync.run(), true);
  assert.deepEqual(calls, ["POST", "POST"]);
  assert.equal(applied, 1); assert.equal(errors.at(-1), null);
});

test("P2 import: missing content returns 409 and ignores retired theory progress; retry is idempotent", async (t) => {
  const db = database(t);
  const theoryId = db.prepare("SELECT id FROM sw_theories ORDER BY id LIMIT 1").get().id;
  const payload = { action: "sw-import", completedTheoryIds: [theoryId], activeSession: session(["SW-MISSING-P2"]) };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await post(payload); const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.code, "SW_SESSION_CONTENT_CHANGED");
    assert.equal(body.sessionImport.status, "failed");
    assert.equal(typeof body.importedTheoryProgress, "number");
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'sw_theory_progress'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sw_learning_sessions WHERE user_key = ?").get(owner).count, 0);
  const repaired = await post({ ...payload, activeSession: session(sample(db, 1).map((q) => q.id)) });
  assert.equal(repaired.status, 200);
  assert.equal((await repaired.json()).sessionImport.status, "saved");
});

test("P2 import: revision, competing active-session and submitted-session conflicts preserve server rows", async (t) => {
  const db = database(t);
  const draft = session(sample(db, 1).map((q) => q.id));
  const first = await save(draft);
  const changed = { ...first.session, answers: { [draft.questionIds[0]]: [0] } };
  const latest = await save(changed);
  for (const stale of [draft, { ...draft, id: "sw_p2_session_other" }]) {
    const before = db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner);
    const response = await post({ action: "sw-import", activeSession: stale });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "SW_SESSION_CONFLICT"); assert.equal(body.ok, false);
    assert.deepEqual(db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner), before);
  }
  const submitted = await save(latest.session, "sw-session-submit");
  const before = db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner);
  const response = await post({ action: "sw-import", activeSession: submitted.session });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).sessionImport.status, "failed");
  assert.deepEqual(db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner), before);
});

for (const size of [99, 100, 101, 120]) {
  test(`P2 practice: ${size} accumulated questions save the same bounded window and cursor in SQLite`, async (t) => {
    const db = database(t);
    const questions = sample(db, size);
    const current = questions.slice(0, size - 20), next = questions.slice(size - 20);
    const initial = await save(session(current.map((q) => q.id)));
    const attempt = await post({ action: "sw-attempt", questionId: current[0].id, selectedAnswers: [0], mode: "practice",
      sessionId: initial.session.id, clientOperationId: "p2_attempt_before_roll", feedbackAuthorization: initial.questions.find((q) => q.id === current[0].id).feedbackAuthorization });
    assert.equal(attempt.status, 201, await attempt.text());
    const history = db.prepare("SELECT * FROM sw_attempts WHERE user_key = ?").all(owner);
    let saved;
    const result = await persistSwPracticeQuestionBatch({
      current, next, ...initial.session,
      answers: Object.fromEntries(current.map((q) => [q.id, [0]])),
      revealedQuestionIds: current.map((q) => q.id), currentIndex: current.length,
      save: async (value) => { saved = await save(value); return saved; },
    });
    const expected = questions.slice(-100).map((q) => q.id);
    assert.deepEqual(result.map((q) => q.id), expected);
    assert.deepEqual(saved.session.questionIds, expected);
    assert.equal(saved.session.currentIndex, expected.indexOf(next[0].id));
    assert.deepEqual(Object.keys(saved.session.answers), current.filter((q) => expected.includes(q.id)).map((q) => q.id));
    assert.deepEqual(db.prepare("SELECT * FROM sw_attempts WHERE user_key = ?").all(owner), history);
    const headers = { [AUTHENTICATED_USER_EMAIL_HEADER]: email, [SW_STUDY_OWNER_HEADER]: owner };
    const accountResponse = await GET(new Request("https://baeumzip.test/api/sw-study?view=state", { headers }));
    assert.equal(accountResponse.status, 200);
    const reloaded = (await accountResponse.json()).sessions[0];
    const params = new URLSearchParams({ view: "session", ids: reloaded.questionIds.join(","),
      subjects: "algorithms", mode: "practice", sessionId: reloaded.id });
    const restoreResponse = await GET(new Request(`https://baeumzip.test/api/sw-study?${params}`, { headers }));
    assert.equal(restoreResponse.status, 200);
    const restored = restoreSwSessionSnapshot({ session: reloaded, questions: (await restoreResponse.json()).questions,
      requestedQuestionIds: expected });
    assert.equal(restored.scopeIsComplete, true);
    assert.deepEqual(restored.questions.map((q) => q.id), expected);
    assert.deepEqual(restored.answers, saved.session.answers);
    assert.equal(restored.currentIndex, expected.indexOf(next[0].id));
    const newQuestion = result.find((q) => q.id === next[0].id);
    assert.equal(typeof newQuestion.feedbackAuthorization, "string");
    const grade = await post({ action: "sw-attempt", questionId: newQuestion.id, selectedAnswers: [0], mode: "practice",
      sessionId: saved.session.id, clientOperationId: "p2_attempt_after_roll", feedbackAuthorization: newQuestion.feedbackAuthorization });
    assert.equal(grade.status, 201, await grade.text());
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sw_attempts WHERE user_key = ?").get(owner).count, 2);
  });
}

test("P2 practice: oversized save, submit and import fail before mutating any existing session", async (t) => {
  const db = database(t);
  const questions = sample(db);
  const initial = await save(session(questions.slice(0, 100).map((q) => q.id)));
  const before = db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner);
  for (const count of [101, 120]) {
    const oversized = { ...initial.session, questionIds: questions.slice(0, count).map((q) => q.id), currentIndex: 100 };
    for (const action of ["sw-session-save", "sw-session-submit", "sw-import"]) {
      const payload = action === "sw-import" ? { action, activeSession: oversized } : { action, ...oversized, sessionId: oversized.id };
      assert.equal(validateSwStudyMutationRequest(payload).code, "SW_SESSION_TOO_LARGE");
      const response = await post(payload);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "SW_SESSION_TOO_LARGE");
    }
  }
  assert.deepEqual(db.prepare("SELECT * FROM sw_learning_sessions WHERE user_key = ?").all(owner), before);
});

test("P2 practice: pending answers are never evicted and a mismatched server response is rejected", async () => {
  const current = Array.from({ length: 100 }, (_, i) => ({ id: `SW-P2-${i}` }));
  const input = { current, next: [{ id: "SW-P2-100" }], ...session(current.map((q) => q.id)), currentIndex: 100 };
  let writes = 0;
  await assert.rejects(persistSwPracticeQuestionBatch({ ...input, save: async () => { writes += 1; } }), /풀이를 마치지/u);
  assert.equal(writes, 0);
  await assert.rejects(persistSwPracticeQuestionBatch({ ...input, revealedQuestionIds: current.map((q) => q.id),
    save: async (value) => ({ status: "saved", session: { ...value, currentIndex: 98 } }),
  }), /학습 범위가 일치하지/u);
  const failed = await persistSwPracticeQuestionBatch({ ...input, revealedQuestionIds: current.map((q) => q.id), save: async () => ({ status: "failed" }) });
  assert.equal(failed, null); assert.equal(input.current.length, 100);
});

test("P2 logs: long escaped Unicode summaries stay valid JSON, bounded and redacted through the admin reader", async (t) => {
  const db = database(t);
  for (const content of ["가나다🙂", '\\"🙂', "plain"]) {
    await writeAdminAudit({ adminUserHash: owner, action: "p2-log-long", before: { count: 3 }, after: {
      email: "secret@example.test", token: "do-not-persist", prompt: content.repeat(100), explanation: content.repeat(100),
      choices: Array.from({ length: 8 }, () => content.repeat(100)),
    } });
  }
  for (const length of [1599, 1600, 1601]) {
    const value = [...Array.from({ length: 5 }, () => "가".repeat(300)), "나".repeat(length - 1519)];
    assert.equal(JSON.stringify(value).length, length);
    await writeAdminAudit({ adminUserHash: owner, action: `p2-log-boundary-${length}`, after: value });
    const row = db.prepare("SELECT after_summary, json_valid(after_summary) AS valid FROM admin_audit_logs WHERE action = ?").get(`p2-log-boundary-${length}`);
    assert.equal(row.valid, 1); assert.ok(row.after_summary.length <= 1600);
    if (length <= 1600) assert.deepEqual(JSON.parse(row.after_summary), value);
    else assert.equal(JSON.parse(row.after_summary).truncated, true);
  }
  const rows = db.prepare("SELECT * FROM admin_audit_logs WHERE action = 'p2-log-long'").all();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row.after_summary.length <= 1600);
    const parsed = JSON.parse(row.after_summary);
    assert.equal(parsed.truncated, true); assert.ok(parsed.preview.length > 0);
    assert.ok(!row.after_summary.includes("secret@example.test")); assert.ok(!row.after_summary.includes("do-not-persist"));
    assert.deepEqual(JSON.parse(row.before_summary), { count: 3 });
  }
  const logs = await readLogs(new URL("https://baeumzip.test/api/admin?search=p2-log-long"));
  assert.equal(logs.audits.length, 3);
  for (const row of logs.audits) { assert.equal(row.after.truncated, true); assert.deepEqual(row.before, { count: 3 }); }
});

test("P2 logs: malformed legacy JSON is explicitly marked without rewriting its stored bytes", async (t) => {
  const db = database(t);
  await writeAdminAudit({ adminUserHash: owner, action: "p2-log-legacy", before: { previous: true } });
  const broken = '{"prompt":"legacy truncated…';
  db.prepare("UPDATE admin_audit_logs SET after_summary = ? WHERE action = 'p2-log-legacy'").run(broken);
  const logs = await readLogs(new URL("https://baeumzip.test/api/admin?search=p2-log-legacy"));
  assert.equal(logs.audits[0].after.unreadable, true);
  assert.equal(db.prepare("SELECT json_valid(after_summary) AS valid FROM admin_audit_logs WHERE action = 'p2-log-legacy'").get().valid, 0);
  assert.equal(logs.audits[0].after_summary, broken);
  assert.equal(db.prepare("SELECT after_summary FROM admin_audit_logs WHERE action = 'p2-log-legacy'").get().after_summary, broken);
});

test("P2 CI: every TypeScript test, including SQL feedback integration, is reachable from the default fast job", () => {
  const { scripts } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const visited = new Set();
  function expand(name) {
    if (visited.has(name)) return "";
    visited.add(name);
    const command = scripts[name]; assert.equal(typeof command, "string");
    return command + [...command.matchAll(/npm run ([\w:-]+)/gu)].map((match) => expand(match[1])).join(" ");
  }
  const defaultTests = expand("test:node:fast");
  for (const name of fs.readdirSync("tests").filter((name) => /\.test\.tsx?$/u.test(name))) {
    assert.ok(defaultTests.includes(`tests/${name}`), `${name} must run in default CI`);
  }
  assert.match(defaultTests, /tests\/sec-int-001-sql-feedback-integration\.test\.ts/u);
  assert.match(fs.readFileSync(".github/workflows/ci.yml", "utf8"), /run: npm run test:node:fast/u);
});
