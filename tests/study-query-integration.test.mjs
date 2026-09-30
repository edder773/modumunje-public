import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { PRACTICAL_PAST_EXAMS_PUBLISHED } from "../packages/shared/src/study/ipe-practical-past.mjs";
import { createPracticeFeedbackAuthorization } from "../packages/shared/src/study/exam-feedback-authorization.mjs";

const root = path.resolve(import.meta.dirname, "..");
const workerUrl = pathToFileURL(path.join(root, "dist/server/index.js"));
workerUrl.searchParams.set("study-query-integration", String(Date.now()));
const worker = (await import(workerUrl.href)).default;

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  execute() {
    try {
      const statement = this.database.prepare(this.sql);
      // StatementSync.columns() was added after the Node 22.13 runtime used by CI.
      // all() also executes statements that do not return rows, so it provides a
      // stable bridge for both the pinned CI runtime and newer local runtimes.
      const results = statement.all(...this.values);
      const result = this.database.prepare(`
        SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid
      `).get();
      return {
        success: true,
        results,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${this.sql}`);
    }
  }

  async all() {
    return this.execute();
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column && row ? row[column] : row;
  }

  async raw() {
    return this.database.prepare(this.sql).all(...this.values).map((row) => Object.values(row));
  }

  async run() {
    return this.execute();
  }
}

function sqliteD1(database) {
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function sessionCookie(email, secret) {
  const now = Math.floor(Date.now() / 1_000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    sub: "query-integration-user",
    email,
    name: "Query Integration Learner",
    iat: now,
    exp: now + 3_600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `__Host-baeumzip-google-session=${encoded}.${signature}`;
}

test("batched theory and record reads preserve learner payloads", async () => {
  const database = openCanonicalTestDatabase(root);
  const email = "query-integration@example.test";
  const secret = "study-query-integration-session-secret-value";
  const userKey = crypto.createHash("sha256")
    .update(`sql-study-user:${email}`)
    .digest("hex");
  const questions = database.prepare(`
    SELECT id, correct_answers AS correctAnswers, choices
    FROM questions
    WHERE active = 1 AND kind = 'single' AND exam_scope IN ('SQLP', 'both')
    ORDER BY id LIMIT 2
  `).all();
  assert.equal(questions.length, 2);
  const incorrectAnswers = JSON.parse(questions[0].choices)
    .map((_, index) => index)
    .filter((index) => !JSON.parse(questions[0].correctAnswers).includes(index));
  database.prepare(`
    INSERT INTO attempts (
      question_id, selected_answers, correct, mode, user_key, exam_type,
      result, score, review_status, created_at
    ) VALUES (?, ?, 0, 'practice', ?, 'SQLP', 'incorrect', 0, 'pending', ?)
  `).run(questions[0].id, JSON.stringify([incorrectAnswers[0]]), userKey, "2026-08-25T00:00:00.000Z");
  database.prepare(`
    INSERT INTO attempts (
      question_id, selected_answers, correct, mode, user_key, exam_type,
      result, score, review_status, created_at
    ) VALUES (?, ?, 1, 'practice', ?, 'SQLP', 'correct', 100, 'mastered', ?)
  `).run(questions[1].id, questions[1].correctAnswers, userKey, "2026-08-25T00:01:00.000Z");
  database.prepare(`
    INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)
  `).run(userKey, questions[0].id);
  // Preserve a historical blank mock row, even when it is newer than a solve.
  database.prepare(`
    INSERT INTO attempts (
      question_id, selected_answers, correct, mode, user_key, exam_type,
      result, score, review_status, created_at
    ) VALUES (?, '[]', 0, 'mock-exam', ?, 'SQLP', 'incorrect', 0, 'pending', ?)
  `).run(questions[1].id, userKey, "2026-08-25T00:02:00.000Z");
  const rawAttemptCount = database.prepare("SELECT COUNT(*) AS n FROM attempts").get().n;

  const environment = {
    DB: sqliteD1(database),
    GOOGLE_AUTH_SESSION_SECRET: secret,
    ADMIN_EMAIL: "admin@example.test",
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const headers = { cookie: sessionCookie(email, secret) };
  const read = async (query) => {
    const response = await worker.fetch(
      new Request(`https://modumunje.com/api/study?${query}`, { headers }),
      environment,
      context,
    );
    const latestError = database.prepare(`
      SELECT message FROM system_errors ORDER BY last_seen_at DESC LIMIT 1
    `).get()?.message;
    assert.equal(response.status, 200, `${await response.clone().text()}\n${latestError ?? ""}`);
    return response.json();
  };

  try {
    const list = await read("scope=theories&exam=SQLP");
    assert.ok(list.theories.length > 1);
    const detail = await read(`scope=theory&exam=SQLP&id=${list.theories[0].id}`);
    assert.equal(detail.theories.length, 1);
    assert.equal(detail.theoryNavigation.previous, null);
    assert.ok(detail.theoryNavigation.next?.id);

    for (const [exam, expectedTheoryCount] of [["DASP", 45], ["DAP", 61]]) {
      const theoryList = await read(`scope=theories&exam=${exam}`);
      assert.equal(theoryList.theories.length, expectedTheoryCount);
      const theory = theoryList.theories[0];
      const theoryDetail = await read(`scope=theory&exam=${exam}&id=${theory.id}`);
      assert.ok(theoryDetail.theoryNavigation.linkedCount >= 10);
      const practice = await read(
        `scope=practice&exam=${exam}&theoryId=${theory.id}&kind=objective&limit=10`,
      );
      assert.ok(practice.questions.length > 0);
      assert.ok(practice.questions.every((question) => question.theoryId === theory.id));
    }

    const stats = await read("scope=records&exam=SQLP&view=stats");
    assert.equal(stats.recordStats.totalAttempts, 2);
    assert.deepEqual(stats.recordsSummary, {
      incorrectQuestionCount: 1,
      bookmarkCount: 1,
    });
    const incorrect = await read("scope=records&exam=SQLP&view=incorrect");
    assert.equal(incorrect.attempts.length, 1);
    assert.equal(incorrect.attempts[0].questionId, questions[0].id);
    assert.deepEqual(incorrect.recordsSummary, stats.recordsSummary);
    const bookmarks = await read("scope=records&exam=SQLP&view=bookmarks");
    assert.equal(bookmarks.questions.length, 1);
    assert.equal(bookmarks.questions[0].id, questions[0].id);
    assert.deepEqual(bookmarks.recordsSummary, stats.recordsSummary);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM attempts").get().n, rawAttemptCount);
  } finally {
    database.close();
  }
});

test("authenticated HTTP maintenance keeps its response open until work completes", async () => {
  const database = openCanonicalTestDatabase(root);
  database.exec("UPDATE site_settings SET value = 'false' WHERE key = 'auto_backup_enabled'");
  const d1 = sqliteD1(database);
  const prepare = d1.prepare.bind(d1);
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  d1.prepare = sql => {
    const statement = prepare(sql);
    if (sql.includes("key = 'analytics_retention_days'")) {
      // Request instrumentation uses all() for first() to retain D1 metadata.
      for (const method of ["first", "all"]) {
        const read = statement[method].bind(statement);
        statement[method] = async (...values) => {
          entered();
          await gate;
          return read(...values);
        };
      }
    }
    return statement;
  };
  const secret = "runtime-maintenance-request-secret-at-least-32-characters";
  const background = [];
  let settled = false;
  const pending = worker.fetch(new Request("https://modumunje.com/api/internal/maintenance", {
    method: "POST", headers: { Authorization: `Bearer ${secret}` },
  }), { DB: d1, MAINTENANCE_TRIGGER_SECRET: secret }, {
    waitUntil(work) { background.push(work); }, passThroughOnException() {},
  }).then(response => { settled = true; return response; });
  try {
    await Promise.race([
      started,
      pending.then(response => { throw new Error(`Maintenance returned ${response.status} before the gated work began`); }),
    ]);
    await Promise.resolve();
    assert.equal(settled, false, "the response must not abandon the backup in background work");
    assert.equal(background.length, 0);
    const concurrent = await worker.fetch(new Request("https://modumunje.com/api/internal/maintenance", {
      method: "POST", headers: { Authorization: `Bearer ${secret}` },
    }), { DB: d1, MAINTENANCE_TRIGGER_SECRET: secret }, {
      waitUntil(work) { background.push(work); }, passThroughOnException() {},
    });
    assert.equal(concurrent.status, 202);
    assert.deepEqual(await concurrent.json(), { status: "in_progress" });
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "completed" });
    assert.ok(database.prepare("SELECT last_succeeded_at FROM maintenance_runs WHERE task = 'operational_housekeeping'").get()?.last_succeeded_at);
  } finally {
    release();
    await pending;
    await Promise.allSettled(background);
    database.close();
  }
});

function practicalMockHarness() {
  const database = openCanonicalTestDatabase(root);
  const email = `practical-mock-${crypto.randomUUID()}@example.test`;
  const secret = "synthetic-practical-mock-session-secret";
  const environment = { DB: sqliteD1(database), GOOGLE_AUTH_SESSION_SECRET: secret, ADMIN_EMAIL: "admin@example.test" };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const policies = new Map(["ipe-practical-answer-policies.json", "ipe-practical-past-answer-policies.json"].flatMap(file => JSON.parse(fs.readFileSync(path.join(root, "apps/backend/resources", file), "utf8"))).map(policy => [policy.id, policy]));
  async function request(query, payload, expected = 200, learner = email) {
    const response = await worker.fetch(new Request(`https://modumunje.com/api/study${query ? `?${query}` : ""}`, {
      method: payload ? "POST" : "GET",
      headers: { ...(learner ? { cookie: sessionCookie(learner, secret) } : {}), origin: "https://modumunje.com", "content-type": "application/json", "x-sql-study-user-request": "1" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }), environment, context);
    const body = await response.json();
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
  return {
    database, request,
    tokenForQuestion: questionId => createPracticeFeedbackAuthorization({ secret, userKey: crypto.createHash("sha256").update(`sql-study-user:${email}`).digest("hex"), engine: "sql", questionId, contextId: "" }),
    get: (query, expected, learner) => request(query, null, expected, learner),
    post: (payload, expected, learner) => request("", payload, expected, learner),
    answers: ids => Object.fromEntries(ids.map(id => {
      const policy = policies.get(id);
      assert.ok(policy?.active);
      // Display answers may contain explanatory prose; use accepted student parts.
      return [id, "sourceNumber" in policy && policy.parts.length ? policy.parts.map(part => part.answers[0]).join("\n") : policy.answer];
    })),
  };
}

test("practical mock grades only on submission, survives resume, and records server scores once", async () => {
  const { database, get, post, answers, tokenForQuestion } = practicalMockHarness();
  try {
    await post({ action: "exam-start", examType: "IPEP" }, 401, "");
    const { session, questions } = await post({ action: "exam-start", examType: "IPEP" }, 201);
    assert.equal(session.questionIds.length, 20);
    assert.equal(new Set(session.questionIds).size, 20);
    assert.equal(Date.parse(session.endsAt) - Date.parse(session.startedAt), 150 * 60_000);
    assert.equal(session.policyVersion, "ipep-short-answer-2026-09-v1-equal-parts-v1");
    assert.equal(session.policySnapshot.passingScore, 60);
    assert.ok(session.questionIds.every(id => ![88100044, 88100249, 88100357].includes(id)));
    assert.equal(Object.keys(answers(session.questionIds)).length, 20);
    assert.ok(questions.every(q => q.examScope === "IPEP" && q.kind === "descriptive"));
    for (const q of questions) for (const field of ["explanation", "scoringCriteria", "correctAnswers"]) assert.equal(field in q, false, field);
    const resumed = await post({ action: "exam-start", examType: "IPEP" });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.session.id, session.id);
    await get(`scope=mock-session&id=${session.id}`, 404, "another-learner@example.test");

    const [first, second] = session.questionIds;
    const practice = await get(`scope=questions&exam=IPEP&ids=${first}`);
    assert.ok(!practice.questions[0]?.feedbackAuthorization);
    // Even a correctly signed practice token cannot unlock an unfinished exam.
    const authorization = await tokenForQuestion(first);
    assert.ok(authorization);
    for (const action of ["question-feedback", "short-answer"]) {
      await post({ action, questionId: first, examType: "IPEP", mode: "practice", answerText: "검증", feedbackAuthorization: authorization, clientOperationId: crypto.randomUUID() }, 403);
    }
    const rawWrongAnswer = "  잘못된 답\r\n둘째 줄  ";
    const draft = { ...answers([first]), [second]: rawWrongAnswer };
    const fabricatedScores = Object.fromEntries(session.questionIds.map(id => [id, 100]));
    await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: { [first]: 100 } }, 400);
    await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: { [first]: "가".repeat(6000) } }, 400);
    const saved = await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: draft, descriptiveScores: fabricatedScores, descriptiveSnapshots: draft, answers: { [first]: [0] }, flagged: [second], currentIndex: 1 });
    assert.equal(saved.session.revision, 1);
    assert.deepEqual(saved.session.descriptiveScores, {});
    assert.deepEqual(saved.session.descriptiveSnapshots, {});
    assert.deepEqual(saved.session.answers, {});
    assert.deepEqual(saved.session.descriptiveAnswers, draft);
    await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: {} }, 409);
    const restored = await get(`scope=mock-session&id=${session.id}`);
    assert.deepEqual(restored.examSessions[0].descriptiveAnswers, draft);
    assert.equal(restored.examSessions[0].currentIndex, 1);
    for (const q of restored.questions) assert.equal("explanation" in q, false);

    const submitted = await post({ action: "exam-submit", sessionId: session.id, revision: 1, descriptiveAnswers: draft, descriptiveScores: fabricatedScores });
    const result = submitted.session.result;
    assert.equal(submitted.session.status, "submitted");
    assert.equal(result.totalScore, 5);
    assert.equal(result.passed, false);
    assert.deepEqual([result.correctCount, result.incorrectCount, result.unansweredCount], [1, 1, 18]);
    assert.equal(result.subjectScores["정보처리실무"].possible, 100);
    assert.equal(result.practicalEvaluations[first].provider, "exact");
    assert.equal(result.questionResults[1].answerText, rawWrongAnswer);
    assert.equal(submitted.session.descriptiveScores[first], 100);
    assert.equal(submitted.session.descriptiveScores[second], 0);
    assert.ok(submitted.questions.every(q => typeof q.explanation === "string" && q.explanation.length > 0));
    const history = await get(`scope=mock-session&id=${session.id}`);
    assert.deepEqual(history.examSessions[0].descriptiveScores, submitted.session.descriptiveScores);
    assert.deepEqual(history.examSessions[0].result, result);
    const repeated = await post({ action: "exam-submit", sessionId: session.id, revision: 1, descriptiveAnswers: answers(session.questionIds) });
    assert.equal(repeated.session.result.totalScore, 5);
    const attempts = database.prepare("SELECT mode, score, answer_text AS answerText FROM attempts WHERE exam_type = 'IPEP'").all();
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(attempt => attempt.mode === "mock-exam"));
    assert.equal(attempts.filter(attempt => attempt.score === 100).length, 1);
    assert.equal(attempts[1].answerText, rawWrongAnswer);
    // A historical unanswered row stays stored but no longer counts as a solve.
    const legacyBlankId = session.questionIds[2];
    const ownerKey = database.prepare("SELECT user_key FROM exam_sessions WHERE id = ?").get(session.id).user_key;
    database.prepare(`INSERT INTO attempts
      (question_id, selected_answers, correct, mode, user_key, exam_type, result, score, answer_text, review_status, is_admin)
      VALUES (?, '[]', 0, 'mock-exam', ?, 'IPEP', 'incorrect', 0, '', 'pending', 0)`)
      .run(legacyBlankId, ownerKey);
    const storedRowCount = database.prepare("SELECT COUNT(*) AS n FROM attempts").get().n;
    const stats = await get("scope=records&exam=IPEP&view=stats");
    assert.equal(stats.recordStats.totalAttempts, 2);
    assert.equal(stats.recordStats.incorrectAttempts, 1);
    assert.equal(stats.recordsSummary.incorrectQuestionCount, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM attempts").get().n, storedRowCount);
    const incorrect = await get("scope=records&exam=IPEP&view=incorrect");
    assert.ok(incorrect.attempts.length > 0);
    assert.equal(incorrect.attempts.length, 1);
    assert.ok(incorrect.attempts.every(attempt => attempt.result === "incorrect" && attempt.mode === "mock-exam"));
    const overview = (await get("scope=overview&exam=IPEP")).overview.byExam.IPEP;
    assert.equal(overview.objectiveAttemptCount, 2);
    assert.equal(overview.streak, 1);
    const next = (await post({ action: "exam-start", examType: "IPEP" }, 201)).session;
    assert.notEqual(next.id, session.id);
    const pass = await post({ action: "exam-submit", sessionId: next.id, revision: 0, descriptiveAnswers: answers(next.questionIds.slice(0, 12)) });
    assert.equal(pass.session.result.totalScore, 60);
    assert.equal(pass.session.result.passed, true);
  } finally { database.close(); }
});

test("practical mock expiry ignores late edits and stale answer policies preserve drafts without partial records", async () => {
  const { database, get, post, answers } = practicalMockHarness();
  try {
    const session = (await post({ action: "exam-start", examType: "IPEP" }, 201)).session;
    const draft = answers(session.questionIds.slice(0, 1));
    await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: draft });
    database.prepare("UPDATE exam_sessions SET ends_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), session.id);
    const late = await post({ action: "exam-save", sessionId: session.id, revision: 1, descriptiveAnswers: answers(session.questionIds) }, 409);
    assert.equal(late.code, "EXAM_EXPIRED");
    const expired = await post({ action: "exam-submit", sessionId: session.id, revision: 1, descriptiveAnswers: answers(session.questionIds) });
    assert.equal(expired.session.result.totalScore, 5);
    assert.equal(expired.session.result.unansweredCount, 19);
    assert.equal(expired.session.result.autoSubmitted, true);
    assert.equal(expired.session.submittedAt, expired.session.endsAt);
    assert.equal(database.prepare("SELECT submitted_at FROM exam_sessions WHERE id = ?").get(session.id).submitted_at, expired.session.endsAt);
    const reconnected = (await get(`scope=mock-session&id=${session.id}`)).examSessions[0];
    assert.equal(reconnected.submittedAt, expired.session.endsAt);
    assert.deepEqual(reconnected.result, expired.session.result);
    assert.deepEqual(expired.session.descriptiveAnswers, draft);
    const next = (await post({ action: "exam-start", examType: "IPEP" }, 201)).session;
    const id = next.questionIds[19];
    const original = database.prepare("SELECT explanation FROM questions WHERE id = ?").get(id).explanation;
    database.prepare("UPDATE questions SET explanation = ? WHERE id = ?").run(original + "\nchanged answer policy", id);
    const stale = await post({ action: "exam-submit", sessionId: next.id, revision: 0, descriptiveAnswers: answers(next.questionIds) }, 409);
    assert.equal(stale.code, "STUDY_ANSWER_POLICY_STALE");
    assert.equal(database.prepare("SELECT status FROM exam_sessions WHERE id = ?").get(next.id).status, "active");
    assert.equal(database.prepare("SELECT COUNT(*) n FROM attempts").get().n, 1);
    const restored = (await get(`scope=mock-session&id=${next.id}`)).examSessions[0];
    assert.deepEqual(restored.descriptiveAnswers, answers(next.questionIds));
    database.prepare("UPDATE questions SET explanation = ? WHERE id = ?").run(original, id);
    const concurrent = await Promise.all(Array.from({ length: 2 }, () => post({ action: "exam-submit", sessionId: next.id, revision: restored.revision }, [200, 409])));
    const retry = concurrent.find(body => body.session?.status === "submitted");
    assert.ok(retry, "one concurrent submission must finish grading");
    assert.equal(retry.session.result.totalScore, 100, JSON.stringify(retry.session.result.questionResults.filter(item => item.result !== "correct")));
    assert.equal(retry.session.result.correctCount, 20);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM attempts").get().n, 21);
  } finally { database.close(); }
});

test('practical course grades 397 active short answers without leaking answers or trusting client scores',async()=>{
 const database=openCanonicalTestDatabase(root),email='practical-review@example.test',secret='synthetic-ipep-review-session-secret';
 const environment={DB:sqliteD1(database),GOOGLE_AUTH_SESSION_SECRET:secret,ADMIN_EMAIL:'admin@example.test'};
 const context={waitUntil(){},passThroughOnException(){}};
 async function get(query){const response=await worker.fetch(new Request('https://modumunje.com/api/study?'+query,{headers:{cookie:sessionCookie(email,secret)}}),environment,context);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
 async function post(payload, expected=200){
  const response=await worker.fetch(new Request('https://modumunje.com/api/study',{method:'POST',headers:{cookie:sessionCookie(email,secret),origin:'https://modumunje.com','content-type':'application/json','x-sql-study-user-request':'1'},body:JSON.stringify(payload)}),environment,context);
  const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
 }
 try{
 const practical=await get('scope=practice&exam=IPEP&kind=descriptive&limit=12');

 assert.ok(practical.questions.length>0);assert.ok(practical.questions.every(q=>q.examScope==='IPEP'&&q.kind==='descriptive'));
 for(const q of practical.questions)for(const key of ['explanation','correctAnswers','scoringCriteria'])assert.equal(key in q,false,`leaked ${key}`);
 const q=practical.questions[0];
 const base={questionId:q.id,examType:'IPEP',answerText:'검증용 답안',feedbackAuthorization:q.feedbackAuthorization};
 const feedback=await post({...base,action:'question-feedback'});
 assert.ok(feedback.feedback.explanation.includes('정답'));
 await post({...base,examType:'IPEW',action:'question-feedback'},404);
 await post({...base,action:'self-assessment',mode:'self-assessment',score:100,clientOperationId:'ipep-review-'+crypto.randomUUID()},400);
 const operation='ipep-review-'+crypto.randomUUID();
 const wrong={...base,action:'short-answer',mode:'practice',score:100,result:'correct',clientOperationId:operation};
 const saved=await post(wrong,201);
 assert.equal(saved.attempt.examType,'IPEP');assert.equal(saved.attempt.score,0);assert.equal(saved.attempt.correct,false);
 assert.equal((await post(wrong,200)).duplicate,true);
 await post({...wrong,answerText:'different'},409);
 await post({...wrong,feedbackAuthorization:'invalid',clientOperationId:'ipep-review-'+crypto.randomUUID()},403);
 const policies=JSON.parse(fs.readFileSync(path.join(root,'apps/backend/resources/ipe-practical-answer-policies.json'),'utf8'));
 const policy=policies.find(p=>p.id===q.id);
 const answerText=policy.parts.length?policy.parts.map(p=>p.answers[0]).join('\n'):policy.answer;
 const correct=await post({...base,action:'short-answer',mode:'practice',score:0,result:'incorrect',answerText,clientOperationId:'ipep-review-'+crypto.randomUUID()},201);
 assert.equal(correct.attempt.score,100);assert.equal(correct.attempt.correct,true);
 const overview=(await get('scope=overview&exam=IPEP')).overview.byExam.IPEP;
 assert.equal(overview.objectiveAttemptCount,2);assert.equal(overview.streak,1);assert.equal(overview.lastActivityKind,'practice');
 const hints=q.shortAnswerInput;assert.deepEqual(Object.keys(hints).sort(),hints.fields?['fieldFormat','fields','hint','multiline']:['hint','multiline']);
 const inactive=await get('scope=questions&exam=IPEP&ids=88100044,88100249,88100357');assert.equal(inactive.questions.length,0);
 const wrongScope=await get('scope=questions&exam=IPEW&ids='+q.id);assert.equal(wrongScope.questions.length,0);
 const meta=await get('scope=practice-meta&exam=IPEP');assert.equal(meta.practiceMeta.summary.questionCount,397);
 const theories=await get('scope=theories&exam=IPEP');assert.equal(theories.theories.length,59);
 const written=await get('scope=practice&exam=IPEW&kind=objective&limit=12');assert.ok(written.questions.every(q=>q.examScope==='IPEW'&&q.kind==='single'));
 assert.equal(database.prepare("SELECT COUNT(*) n FROM questions WHERE exam_scope='IPEP' AND id BETWEEN 88100001 AND 88100400").get().n,400);
 assert.equal(database.prepare("SELECT COUNT(*) n FROM questions WHERE exam_scope='IPEP' AND id BETWEEN 88200001 AND 88200400").get().n,400);
 assert.equal(database.prepare("SELECT COUNT(*) n FROM theories WHERE exam_scope='IPEP'").get().n,59);
 }finally{database.close();}
});


test("past-form publication controls all 20 rounds while ordinary practical mocks remain available", async () => {
  const { PRACTICAL_PAST_FORMS } = await import("../packages/shared/src/study/ipe-practical-past.mjs");
  const { database, get, post, answers } = practicalMockHarness();
  try {
    for (const form of PRACTICAL_PAST_FORMS) {
      if (!PRACTICAL_PAST_EXAMS_PUBLISHED) {
        const denied = await post({ action: "exam-start", examType: "IPEP", formId: form.id }, 404);
        assert.equal(denied.code, "EXAM_FORM_UNAVAILABLE");
        assert.deepEqual((await get(`scope=questions&exam=IPEP&ids=${form.questionIds.join(",")}`)).questions, []);
        continue;
      }
      const started = await post({ action: "exam-start", examType: "IPEP", formId: form.id }, 201);
      const session = started.session;
      assert.deepEqual([...session.questionIds].sort(), [...form.questionIds].sort());
      assert.equal(session.examForm.id, form.id);
      for (const q of started.questions) {
        assert.equal(q.historicalExam.title, form.title);
        assert.equal(q.historicalExam.number, form.questionIds.indexOf(q.id) + 1);
        for (const field of ["explanation", "correctAnswers", "contentSha256", "answer", "scoringCriteria"]) assert.equal(field in q, false);
      }
      const draft = answers(session.questionIds.slice(0, 3));
      const saved = await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: draft, currentIndex: 2 });
      const resumed = await post({ action: "exam-start", examType: "IPEP", formId: form.id });
      assert.equal(resumed.session.id, session.id);
      assert.deepEqual(resumed.session.questionIds, session.questionIds);
      assert.deepEqual(resumed.session.descriptiveAnswers, draft);
      const result = await post({ action: "exam-submit", sessionId: session.id, revision: saved.session.revision, descriptiveAnswers: answers(session.questionIds) });
      assert.equal(result.session.result.totalScore, 100, form.id);
      assert.equal(result.session.result.examForm.title, form.title);
      assert.equal(result.session.result.correctCount, 20);
      assert.deepEqual(result.session.questionIds, session.questionIds);
      assert.ok(result.questions.every(q => q.explanation && q.historicalExam));
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM attempts WHERE exam_type='IPEP'").get().n, PRACTICAL_PAST_EXAMS_PUBLISHED ? 400 : 0);
    const records = await get("scope=records&exam=IPEP&view=stats");
    if (!PRACTICAL_PAST_EXAMS_PUBLISHED) assert.deepEqual(records.examSessions, []);
    else assert.ok(records.examSessions.every(s => s.examForm?.title && s.result.examForm?.id));
    const meta = await get("scope=practice-meta&exam=IPEP");
    assert.equal(meta.practiceMeta.summary.questionCount, 397);
    const ordinary = await get("scope=practice&exam=IPEP&kind=descriptive&limit=12");
    assert.ok(ordinary.questions.every(q => q.id >= 88100001 && q.id <= 88100400));
    const random = (await post({ action: "exam-start", examType: "IPEP" }, 201)).session;
    assert.ok(random.questionIds.every(id => id >= 88100001 && id <= 88100400));
    assert.equal(random.examForm, undefined);
  } finally { database.close(); }
});

test("past form validation and availability preserve an existing active attempt", async () => {
  const { database, post, answers } = practicalMockHarness();
  try {
    for (const formId of ["", "ipep-past-2099-1", 88200001, { id: "ipep-past-2020-1" }, null]) {
      await post({ action: "exam-start", examType: "IPEP", formId }, 400);
    }
    await post({ action: "exam-start", examType: "IPEW", formId: "ipep-past-2020-1" }, 400);
    if (!PRACTICAL_PAST_EXAMS_PUBLISHED) {
      const normal = (await post({ action: "exam-start", examType: "IPEP" }, 201)).session;
      const saved = database.prepare("SELECT * FROM exam_sessions WHERE id=?").get(normal.id);
      const denied = await Promise.all(["ipep-past-2020-1", "ipep-past-2021-1"].map(formId =>
        post({ action: "exam-start", examType: "IPEP", formId }, 404)));
      assert.ok(denied.every(item => item.code === "EXAM_FORM_UNAVAILABLE"));
      assert.deepEqual(database.prepare("SELECT * FROM exam_sessions WHERE id=?").get(normal.id), saved);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM exam_sessions").get().n, 1);
      return;
    }
    const session = (await post({ action: "exam-start", examType: "IPEP", formId: "ipep-past-2020-1" }, 201)).session;
    const conflict = await post({ action: "exam-start", examType: "IPEP", formId: "ipep-past-2021-1" }, 409);
    assert.equal(conflict.code, "EXAM_FORM_CONFLICT");
    await post({ action: "exam-start", examType: "IPEP" }, 409);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM exam_sessions").get().n, 1);
    await post({ action: "exam-submit", sessionId: session.id, revision: 0, descriptiveAnswers: answers(session.questionIds) });
    database.prepare("UPDATE questions SET prompt = prompt || ' changed' WHERE id=88200381").run();
    const stale = await post({ action: "exam-start", examType: "IPEP", formId: "ipep-past-2026-1" }, 409);
    assert.equal(stale.code, "STUDY_ANSWER_POLICY_STALE");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM exam_sessions WHERE status='active'").get().n, 0);
  } finally { database.close(); }
});


test("practical practice persists server-calculated partial credit and per-field feedback", async () => {
  const { database, get, post, tokenForQuestion } = practicalMockHarness();
  try {
    const q = (await get("scope=questions&exam=IPEP&ids=88100144")).questions[0];
    assert.equal(q.shortAnswerInput.fields.length, 3);
    assert.equal("answerParts" in q, false);
    const answerText = '@ipep-fields-v1:["구문","","타이밍"]';
    const payload = { action: "short-answer", examType: "IPEP", questionId: q.id, mode: "practice", answerText,
      feedbackAuthorization: await tokenForQuestion(q.id), clientOperationId: crypto.randomUUID(), score: 100, result: "correct" };
    const response = await post(payload, 201);
    assert.equal(response.attempt.result, "partial");
    assert.equal(response.attempt.correct, false);
    assert.equal(response.attempt.score, 200 / 3);
    assert.deepEqual(response.grading.answerParts.map(part => part.correct), [true, false, true]);
    const retry = await post(payload);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.attempt.score, response.attempt.score);
    const stored = database.prepare("SELECT result, score, answer_text FROM attempts WHERE question_id = ?").get(q.id);
    assert.equal(stored.result, "partial"); assert.equal(stored.score, 200 / 3); assert.equal(stored.answer_text, answerText);
    await post({ ...payload, clientOperationId: crypto.randomUUID(), answerText: '@ipep-fields-v1:["","",""]' }, 400);
  } finally { database.close(); }
});

test("past multi-field answers obey publication controls and retain their grading behavior when published", async () => {
  const { database, get, post, answers, tokenForQuestion } = practicalMockHarness();
  try {
    const forms = (await import("../packages/shared/src/study/ipe-practical-past.mjs")).PRACTICAL_PAST_FORMS;
    const form = forms.find(form => form.year === 2020 && form.round === 1);
    assert.ok(form);
    if (!PRACTICAL_PAST_EXAMS_PUBLISHED) {
      const denied = await post({ action: "exam-start", examType: "IPEP", formId: form.id }, 404);
      assert.equal(denied.code, "EXAM_FORM_UNAVAILABLE");
      for (const action of ["question-feedback", "short-answer"]) {
        await post({ action, examType: "IPEP", questionId: 88200003, mode: "practice",
          feedbackAuthorization: await tokenForQuestion(88200003), answerText: "Timing\nSyntax\nSemantics",
          clientOperationId: crypto.randomUUID() }, 404);
      }
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM exam_sessions").get().n, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM attempts").get().n, 0);
      return;
    }
    const { session } = await post({ action: "exam-start", examType: "IPEP", formId: form.id }, 201);
    const draft = { 88200003: '@ipep-fields-v1:["Timing","","Syntax"]', 88200006: '@ipep-fields-v1:["200","","1"]' };
    const saved = await post({ action: "exam-save", sessionId: session.id, revision: 0, descriptiveAnswers: draft, descriptiveScores: { 88200003: 100, 88200006: 100 } });
    assert.deepEqual(saved.session.descriptiveScores, {});
    const resumed = await post({ action: "exam-start", examType: "IPEP", formId: form.id });
    assert.deepEqual(resumed.session.descriptiveAnswers, draft);
    assert.deepEqual(resumed.session.questionIds, session.questionIds);
    const submitted = await post({ action: "exam-submit", sessionId: session.id, revision: saved.session.revision });
    const result = submitted.session.result;
    assert.equal(result.totalScore, 6.67); assert.equal(result.descriptiveScore, 6.67);
    assert.equal(result.partialCount, 2); assert.equal(result.correctCount, 0); assert.equal(result.incorrectCount, 0); assert.equal(result.unansweredCount, 18);
    assert.equal(result.passed, false);
    for (const id of [88200003, 88200006]) {
      const item = result.questionResults.find(item => item.questionId === id);
      assert.ok(Math.abs(item.convertedScore - 10 / 3) < 1e-10);
      assert.equal(item.result, "partial");
      assert.equal(result.practicalEvaluations[id].answerParts.filter(part => part.correct).length, 2);
    }
    const again = await post({ action: "exam-submit", sessionId: session.id, revision: 0, descriptiveAnswers: answers(session.questionIds) });
    assert.deepEqual(again.session.result, result);
    const records = await get("scope=records&exam=IPEP&view=stats");
    assert.equal(records.examSessions[0].result.totalScore, 6.67);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM attempts WHERE result = 'partial'").get().n, 2);
  } finally { database.close(); }
});
