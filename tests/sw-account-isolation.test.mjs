import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const { createSwLearningStore, parseSwLearningState, createSwSessionDraft } = await tsImport(
  "../apps/frontend/src/features/study/persistence/sw-learning-store.ts", import.meta.url,
);
const { GET, POST } = await tsImport(
  "../apps/backend/src/modules/sw-study/sw-study.service.ts", import.meta.url,
);
const { learnerUserHash } = await tsImport(
  "../apps/backend/src/common/auth/admin-auth.ts", import.meta.url,
);
const { AUTHENTICATED_USER_EMAIL_HEADER, SW_STUDY_OWNER_HEADER } = await tsImport(
  "../packages/shared/src/auth/authenticated-user.ts", import.meta.url,
);
const { requestSwStudyMutation } = await tsImport(
  "../apps/frontend/src/features/study/model/study-mutation-api-client.ts", import.meta.url,
);
const { requestSwStudyData } = await tsImport(
  "../apps/frontend/src/features/study/model/sw-study-api-client.ts", import.meta.url,
);
const A = "sw-owner-a@example.test", B = "sw-owner-b@example.test";
const aKey = await learnerUserHash(A), bKey = await learnerUserHash(B);
const legacyKey = "baeumzip-sw-curriculum-selection:v1";

function setGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  });
}

function browser(t, { blocked = false } = {}) {
  const entries = new Map();
  const target = new EventTarget();
  const localStorage = {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, value); },
  };
  const fakeWindow = Object.assign(target, { setTimeout, clearTimeout });
  Object.defineProperty(fakeWindow, "localStorage", { get() {
    if (blocked) throw new Error("Storage disabled");
    return localStorage;
  } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const previous = globalThis.window;
  globalThis.window = fakeWindow;
  t.after(() => { globalThis.window = previous; });
  return { entries, target, localStorage };
}

function state(store) { return parseSwLearningState(store.readSwCurriculumSelection()); }

test("A → B → A keeps selection, progress, answers and location with their owner", (t) => {
  browser(t);
  const a = createSwLearningStore(aKey), b = createSwLearningStore(bKey);
  const session = createSwSessionDraft("sw_owner_session_a", "mock", ["algorithms"], ["SW-A-1"]);
  session.answers = { "SW-A-1": [1] };
  a.writeSwLearningState(() => ({
    version: 4, selectedSubjectIds: ["algorithms"], completedTheoryIds: [1],
    recentPracticeQuestionIds: ["SW-A-1"], activeSession: session,
    lastLocation: { view: "mock", title: "A", detail: "A draft", updatedAt: session.updatedAt },
  }));
  const original = a.readSwCurriculumSelection();
  assert.deepEqual(state(b).completedTheoryIds, []);
  assert.equal(state(b).activeSession, undefined);
  b.writeSwCurriculumSelection(new Set(["data-structures"]));
  assert.equal(createSwLearningStore(aKey).readSwCurriculumSelection(), original);
  assert.deepEqual(state(b).selectedSubjectIds, ["data-structures"]);
  assert.equal(state(createSwLearningStore("guest")).lastLocation, undefined);
  assert.throws(() => createSwLearningStore(""), /requires an owner/u);
});

test("unowned legacy arrays and full drafts remain byte-for-byte intact without being claimed", (t) => {
  const { entries } = browser(t);
  for (const raw of [JSON.stringify(["algorithms"]), JSON.stringify({
    version: 4, selectedSubjectIds: ["algorithms"], completedTheoryIds: [17],
    activeSession: createSwSessionDraft("sw_legacy_session", "mock", ["algorithms"], ["SW-A-1"]),
  })]) {
    entries.set(legacyKey, raw);
    for (const key of [aKey, bKey, "guest"]) {
      const store = createSwLearningStore(key);
      assert.deepEqual(state(store).completedTheoryIds, []);
      assert.equal(state(store).activeSession, undefined);
      store.writeSwCurriculumSelection(new Set());
    }
    assert.equal(entries.get(legacyKey), raw);
  }
});

test("failed browser storage uses owner-specific memory and never falls back to another account", (t) => {
  const { target } = browser(t, { blocked: true });
  const a = createSwLearningStore("blocked-a"), b = createSwLearningStore("blocked-b");
  let failures = 0;
  target.addEventListener("baeumzip:storage-failure", () => { failures += 1; });
  a.writeSwLearningState((s) => ({ ...s, selectedSubjectIds: ["subject-17"] }));
  assert.deepEqual(state(b).selectedSubjectIds, []);
  b.writeSwCurriculumSelection(new Set(["algorithms"]));
  assert.deepEqual(state(createSwLearningStore("blocked-a")).selectedSubjectIds, ["subject-17"]);
  assert.deepEqual(state(b).selectedSubjectIds, ["algorithms"]);
  assert.equal(failures, 2);
});

test("subscriptions isolate accounts, share same-owner changes and handle storage.clear", (t) => {
  const { target, entries, localStorage } = browser(t);
  const a = createSwLearningStore("events-a"), b = createSwLearningStore("events-b");
  let updatesA = 0, updatesB = 0;
  const stopA = a.subscribeSwCurriculumSelection(() => { updatesA += 1; });
  const stopB = b.subscribeSwCurriculumSelection(() => { updatesB += 1; });
  a.writeSwCurriculumSelection(new Set(["algorithms"]));
  assert.equal(updatesA, 1); assert.equal(updatesB, 0);
  const aStorageKey = [...entries.keys()][0];
  entries.set(aStorageKey, JSON.stringify({ version: 4, selectedSubjectIds: ["subject-9"] }));
  target.dispatchEvent(Object.assign(new Event("storage"), { key: aStorageKey, storageArea: localStorage }));
  assert.equal(updatesA, 2); assert.equal(updatesB, 0);
  assert.deepEqual(state(a).selectedSubjectIds, ["subject-9"]);
  entries.clear();
  target.dispatchEvent(Object.assign(new Event("storage"), { key: null, storageArea: localStorage }));
  assert.equal(updatesA, 3); assert.equal(updatesB, 1);
  assert.deepEqual(state(a).selectedSubjectIds, []);
  stopA(); stopB();
  a.writeSwCurriculumSelection(new Set());
  assert.equal(updatesA, 3);
});

test("late A callbacks still write A's store after B has become the displayed account", async (t) => {
  browser(t);
  const a = createSwLearningStore(aKey), b = createSwLearningStore(bKey);
  let release;
  const pending = new Promise((resolve) => { release = resolve; }).then(() => {
    a.writeSwLearningState((s) => ({ ...s, selectedSubjectIds: ["subject-23"] }));
  });
  b.writeSwLearningState((s) => ({ ...s, selectedSubjectIds: ["subject-7"] }));
  release(); await pending;
  assert.deepEqual(state(a).selectedSubjectIds, ["subject-23"]);
  assert.deepEqual(state(b).selectedSubjectIds, ["subject-7"]);
});

function post(email, owner, payload) {
  return new Request("https://baeumzip.test/api/sw-study", {
    method: "POST", headers: {
      "Content-Type": "application/json", "x-sql-study-user-request": "1",
      ...(email ? { [AUTHENTICATED_USER_EMAIL_HEADER]: email } : {}),
      ...(owner === undefined ? {} : { [SW_STUDY_OWNER_HEADER]: owner }),
    }, body: JSON.stringify(payload),
  });
}

test("all SW writes reject missing, stale and forged owner expectations before any database access", async (t) => {
  let accesses = 0;
  setGlobal(t, "__BAEUMZIP_ENV__", { DB: {
    prepare() { accesses += 1; throw new Error("Should not reach DB"); },
  } });
  const session = { sessionId: "sw_owner_session_1", revision: 0, mode: "mock", subjectIds: ["algorithms"], questionIds: ["SW-A-1"] };
  const payloads = [
    { action: "sw-progress", theoryId: 1, completed: true },
    { action: "sw-import", completedTheoryIds: [1] },
    { action: "sw-session-save", ...session },
    { action: "sw-session-submit", ...session },
    { action: "sw-attempt", questionId: "SW-A-1", sessionId: session.sessionId, mode: "practice", selectedAnswers: [0], clientOperationId: "sw_owner_attempt_1", feedbackAuthorization: "test-only" },
  ];
  for (const payload of payloads) {
    for (const owner of [undefined, aKey, "forged-key"]) {
      const response = await POST(post(B, owner, payload));
      assert.equal(response.status, 409, `${payload.action}: ${owner}`);
      assert.equal((await response.json()).code, "SW_ACCOUNT_CHANGED");
    }
  }
  const anonymous = await POST(post(null, aKey, payloads[0]));
  assert.equal(anonymous.status, 401);
  assert.equal(accesses, 0);
});

test("stale tabs cannot read B's private SW state into A's local namespace", async (t) => {
  let accesses = 0;
  setGlobal(t, "__BAEUMZIP_ENV__", { DB: { prepare() { accesses += 1; throw new Error("Unexpected DB access"); } } });
  for (const view of ["state", "session", "practice"]) {
    for (const owner of [undefined, aKey]) {
      const request = new Request(`https://baeumzip.test/api/sw-study?view=${view}`, {
        headers: { [AUTHENTICATED_USER_EMAIL_HEADER]: B, ...(owner ? { [SW_STUDY_OWNER_HEADER]: owner } : {}) },
      });
      const response = await GET(request);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "SW_ACCOUNT_CHANGED");
    }
  }
  assert.equal(accesses, 0);
});

test("the browser owner header cannot override the identity verified from the signed cookie", async (t) => {
  const { withSiteIdentity } = await tsImport("../apps/frontend/src/server/auth/site-auth.ts", import.meta.url);
  const { createGoogleSessionValue, googleSessionCookie } = await tsImport(
    "../apps/backend/src/common/auth/google-session.ts", import.meta.url,
  );
  let accesses = 0;
  setGlobal(t, "__BAEUMZIP_ENV__", {
    GOOGLE_AUTH_SESSION_SECRET: "sw-owner-synthetic-session-secret-at-least-32-characters",
    DB: { prepare() { accesses += 1; throw new Error("Unexpected DB access"); } },
  });
  const payload = { action: "sw-import", completedTheoryIds: [1] };
  const request = post(A, aKey, payload);
  const cookie = googleSessionCookie(await createGoogleSessionValue({
    id: "owner-b", email: B, displayName: "Synthetic B",
  }), request.url).split(";")[0];
  request.headers.set("cookie", cookie);
  const response = await withSiteIdentity(request, POST);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SW_ACCOUNT_CHANGED");
  assert.equal(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER), B);
  const unsigned = await withSiteIdentity(post(A, aKey, payload), POST);
  assert.equal(unsigned.status, 401);
  assert.equal(accesses, 0);
});

test("real SW service and SQLite import ignore retired progress for both accounts and legacy bytes separate", async (t) => {
  const { entries } = browser(t);
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
  const d1 = { prepare: (sql) => new Statement(sql), async batch(statements) {
    db.exec("BEGIN");
    try { const results = statements.map((s) => s.execute()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } };
  setGlobal(t, "__BAEUMZIP_ENV__", { DB: d1 });
  setGlobal(t, "__BAEUMZIP_BUILD_SHA__", "374d3a8b07e69ee2fd638fd5e1293a002c417028");
  const theoryId = db.prepare("SELECT id FROM sw_theories ORDER BY id LIMIT 1").get().id;
  const a = createSwLearningStore(aKey), b = createSwLearningStore(bKey);
  a.writeSwLearningState((s) => ({ ...s, completedTheoryIds: [theoryId] }));
  const legacy = a.readSwCurriculumSelection(); entries.set(legacyKey, legacy);
  assert.equal((await POST(post(A, aKey, { action: "sw-import", ...state(a) }))).status, 200);
  assert.equal((await POST(post(B, bKey, { action: "sw-import", ...state(b) }))).status, 200);
  const retired = () => db.prepare("SELECT name FROM sqlite_master WHERE name = 'sw_theory_progress'").all();
  assert.deepEqual(retired(), []);
  assert.equal((await POST(post(B, aKey, { action: "sw-import", ...state(a) }))).status, 409);
  assert.equal((await POST(post(B, undefined, { action: "sw-import", ...state(a) }))).status, 409);
  assert.deepEqual(retired(), []);
  const response = await GET(new Request("https://baeumzip.test/api/sw-study?view=state", { headers: {
    [AUTHENTICATED_USER_EMAIL_HEADER]: A, [SW_STUDY_OWNER_HEADER]: aKey,
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).progress.map((row) => row.theoryId), []);
  assert.equal(entries.get(legacyKey), legacy);
  assert.deepEqual(state(a).completedTheoryIds, []);
});

test("SW client attaches expected owner and separates concurrent/cached reads by account", async (t) => {
  const target = new EventTarget();
  const previousWindow = globalThis.window;
  globalThis.window = Object.assign(target, { setTimeout, clearTimeout });
  t.after(() => { globalThis.window = previousWindow; });
  setGlobal(t, "__BAEUMZIP_BUILD_SHA__", "374d3a8b07e69ee2fd638fd5e1293a002c417028");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const owner = new Headers(init.headers).get(SW_STUDY_OWNER_HEADER); calls.push(owner);
    if (init.method === "POST") return Response.json({ ok: true, theoryId: 1, completed: true });
    await Promise.resolve();
    return Response.json({ progress: [{ theoryId: owner === aKey ? 1 : 2, completed: true, updatedAt: "2026-09-08T00:00:00Z" }], sessions: [], attemptSummary: { total: 0, correct: 0, learningDays: 0 } });
  });
  await assert.rejects(requestSwStudyMutation("sw-progress", { theoryId: 1, completed: true }), { code: "SW_ACCOUNT_CHANGED" });
  assert.equal(calls.length, 0);
  await requestSwStudyMutation("sw-progress", { theoryId: 1, completed: true }, undefined, aKey);
  const [a, b] = await Promise.all([aKey, bKey].map((owner) => requestSwStudyData({ view: "state", cacheMode: "reuse", expectedUserKey: owner })));
  assert.equal(a.progress[0].theoryId, 1); assert.equal(b.progress[0].theoryId, 2);
  assert.deepEqual(calls, [aKey, aKey, bKey]);
  const again = await requestSwStudyData({ view: "state", cacheMode: "reuse", expectedUserKey: aKey });
  assert.equal(again.progress[0].theoryId, 1); assert.equal(calls.length, 3);
});
