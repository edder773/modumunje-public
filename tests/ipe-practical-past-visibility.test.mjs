import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { PRACTICAL_PAST_FORMS, isHiddenPracticalPastQuestion } from "../packages/shared/src/study/ipe-practical-past.mjs";

// All mutations stay inside the disposable canonical SQLite fixture.
test("past questions and historical sessions are administrator-only; ordinary practical exams and all source data survive", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const origin = "https://modumunje.com";
  const secret = "past-visibility-regression-secret-at-least-32-characters";
  const env = { DB: sqliteD1(db), GOOGLE_AUTH_SESSION_SECRET: secret,
    GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", ADMIN_EMAIL: "admin@example.test",
    GOOGLE_OAUTH_REDIRECT_URI: `${origin}/api/auth/google/callback`,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  function cookie(email) {
    const now = Math.floor(Date.now() / 1000);
    const value = Buffer.from(JSON.stringify({ v: 1, sub: email, email, name: "Test", iat: now, exp: now + 3600 })).toString("base64url");
    return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
  }
  async function request(path, session = "", body) {
    return worker.fetch(new Request(new URL(path, origin), { method: body === undefined ? "GET" : "POST",
      headers: { cookie: session, accept: "application/json", ...(body === undefined ? {} : {
        "content-type": "application/json", Origin: origin, "x-sql-study-user-request": "1",
      }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, ctx);
  }
  async function json(response, status = 200) {
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const member = cookie("member@example.test"), admin = cookie("admin@example.test");
  const key = crypto.createHash("sha256").update("sql-study-user:member@example.test").digest("hex");
  const original = db.prepare("SELECT * FROM questions WHERE id BETWEEN 88200001 AND 88200400 ORDER BY id").all();
  try {
    assert.equal(original.length, 400);
    const guestResponse = await request("/api/guest-learning", "", {});
    await json(guestResponse, 401);
    const guest = "";
    assert.equal((await request("/api/study?scope=questions&exam=IPEP&ids=88200001", guest)).status, 401);
    for (const session of [member, admin]) {
      for (let index = 0; index < 400; index += 100) {
        const ids = original.slice(index, index + 100).map(row => row.id).join(",");
        const data = await json(await request(`/api/study?scope=questions&exam=IPEP&ids=${ids}`, session));
        assert.deepEqual(data.questions, [], "even administrators use the admin screen, not learner delivery");
      }
    }
    for (const form of PRACTICAL_PAST_FORMS) {
      const data = await json(await request("/api/study", member, { action: "exam-start", examType: "IPEP", formId: form.id }), 404);
      assert.equal(data.code, "EXAM_FORM_UNAVAILABLE");
    }
    const start = new Date().toISOString(), end = new Date(Date.now() + 3600000).toISOString();
    const ids = PRACTICAL_PAST_FORMS[0].questionIds;
    for (const status of ["active", "submitted"]) {
      db.prepare(`INSERT INTO exam_sessions (id,user_key,exam_type,status,question_ids,started_at,ends_at,
        submitted_at,descriptive_snapshots,result) VALUES (?,?,'IPEP',?,?,?,?,?,?,?)`).run(
          `hidden-${status}`, key, status, JSON.stringify(ids), start, end, status === "submitted" ? start : null,
          JSON.stringify({ [ids[0]]: "private stored explanation" }), JSON.stringify({ totalScore: 50 }));
    }
    ids.forEach((id, position) => db.prepare("INSERT INTO exam_session_items (session_id,question_id,position) VALUES ('hidden-active',?,?)").run(id, position));
    db.prepare("INSERT INTO exam_active_sessions (user_key,exam_type,session_id) VALUES (?,'IPEP','hidden-active')").run(key);
    db.prepare("INSERT INTO attempts (user_key,exam_type,question_id,selected_answers,correct,answer_text) VALUES (?,'IPEP',?,'[]',0,'private stored answer')").run(key, ids[0]);
    db.prepare("INSERT INTO user_bookmarks (user_key,question_id) VALUES (?,?)").run(key, ids[0]);
    const savedAttempt = db.prepare("SELECT * FROM attempts WHERE user_key=?").all(key);
    const savedBookmark = db.prepare("SELECT * FROM user_bookmarks WHERE user_key=?").all(key);
    const saved = db.prepare("SELECT * FROM exam_sessions WHERE id LIKE 'hidden-%' ORDER BY id").all();
    const savedItems = db.prepare("SELECT * FROM exam_session_items WHERE session_id='hidden-active' ORDER BY position").all();
    for (const id of ["hidden-active", "hidden-submitted"]) {
      const response = await request(`/api/study?scope=mock-session&exam=IPEP&id=${id}`, member);
      await json(response, 404);
    }
    for (const action of ["exam-save", "exam-submit"]) {
      await json(await request("/api/study", member, { action, sessionId: "hidden-active", revision: 0 }), 404);
    }
    for (const scope of ["mock", "records", "records&view=incorrect", "records&view=bookmarks"]) {
      const data = await json(await request(`/api/study?scope=${scope}&exam=IPEP`, member));
      assert.deepEqual(data.examSessions, []);
      assert.doesNotMatch(JSON.stringify(data), /private stored (explanation|answer)/u);
    }
    const started = await json(await request("/api/study", member, { action: "exam-start", examType: "IPEP" }), 201);
    assert.equal(started.session.questionIds.length, 20);
    assert.ok(started.session.questionIds.every(id => !isHiddenPracticalPastQuestion(id)));
    const resumed = await json(await request(`/api/study?scope=mock-session&exam=IPEP&id=${started.session.id}`, member));
    assert.equal(resumed.questions.length, 20);
    const listed = await json(await request("/api/admin?resource=questions&contentDomain=ipe&examScope=IPEP&search=past-form%3A&pageSize=20", admin));
    assert.equal(listed.pagination.total, 400);
    assert.ok(listed.items.every(item => isHiddenPracticalPastQuestion(item.id) && item.prompt && item.explanation));
    assert.equal((await request("/api/admin?resource=questions", guest)).status, 401);
    assert.equal((await request("/api/admin?resource=questions", member)).status, 403);
    assert.deepEqual(db.prepare("SELECT * FROM attempts WHERE user_key=?").all(key), savedAttempt);
    assert.deepEqual(db.prepare("SELECT * FROM user_bookmarks WHERE user_key=?").all(key), savedBookmark);
    assert.deepEqual(db.prepare("SELECT * FROM questions WHERE id BETWEEN 88200001 AND 88200400 ORDER BY id").all(), original);
    assert.deepEqual(db.prepare("SELECT * FROM exam_sessions WHERE id LIKE 'hidden-%' ORDER BY id").all(), saved);
    assert.deepEqual(db.prepare("SELECT * FROM exam_session_items WHERE session_id='hidden-active' ORDER BY position").all(), savedItems);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM exam_active_sessions WHERE session_id='hidden-active'").get().n, 0);
  } finally { db.close(); }
});
