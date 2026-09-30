import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { openCanonicalTestDatabase } from './helpers/canonical-database.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { GET, POST } from '../apps/backend/src/modules/study/study.service';
import { guestAttemptOperationId } from '../packages/shared/src/study/study-concurrency-contract.mjs';

const origin = 'https://modumunje.com';
const email = 'guest-import-guard@example.test';
const userKey = crypto.createHash('sha256').update(`sql-study-user:${email}`).digest('hex');
function request(body: Record<string, unknown>) {
  return new Request(`${origin}/api/study`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin,
      'x-baeumzip-authenticated-user-email': email, 'x-sql-study-user-request': '1' },
    body: JSON.stringify(body),
  });
}

test('guest-import cannot turn an active mock item into a record correctness oracle', async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const started = await POST(request({ action: 'exam-start', examType: 'SQLD' }));
    assert.equal(started.status, 201);
    const start = await started.json() as { session: { id: string; questionIds: number[] } };
    const questionId = start.session.questionIds[0];
    const body = { action: 'guest-import', importId: 'guest_import_block_001', selectedExam: 'SQLD',
      bookmarks: [], attempts: [{ questionId, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' }] };
    const blocked = await POST(request(body));
    assert.equal(blocked.status, 200);
    assert.deepEqual(await blocked.json(), { ok: true, imported: false, deferred: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey,questionId)?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, body.importId)?.n, 0);
    const deferredAgain = await POST(request(body));
    assert.equal((await deferredAgain.json() as { deferred: boolean }).deferred, true);
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(start.session.id);
    const allowed = await POST(request(body));
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json() as { attempts: number }).attempts, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey,questionId)?.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, body.importId)?.n, 1);
    const duplicate = await POST(request(body));
    assert.deepEqual(await duplicate.json(), { ok: true, imported: true, duplicate: true,
      verified: true, bookmarks: 0, attempts: 1, theoryProgress: 0 });
    const changed = await POST(request({ ...body, attempts: [{ ...body.attempts[0], selectedAnswers: [1] }] }));
    assert.equal(changed.status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey,questionId)?.n, 1);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test('mixed guest import defers all items until a protected exam finishes', async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const started = await POST(request({ action: 'exam-start', examType: 'SQLD' }));
    const start = await started.json() as { session: { id: string; questionIds: number[] } };
    const protectedId = start.session.questionIds[0];
    const safeId = db.prepare("SELECT id FROM questions WHERE active=1 AND exam_scope='both' AND id NOT IN (SELECT question_id FROM exam_session_items WHERE session_id=?) LIMIT 1")
      .get(start.session.id)?.id as number;
    assert.ok(safeId);
    const body = { action: 'guest-import', importId: 'guest_import_mixed_001', selectedExam: 'SQLD', bookmarks: [],
      attempts: [protectedId, safeId].map((questionId) => ({ questionId, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' })) };
    const deferred = await POST(request(body));
    assert.deepEqual(await deferred.json(), { ok: true, imported: false, deferred: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, body.importId)?.n, 0);
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(start.session.id);
    const imported = await POST(request(body));
    assert.deepEqual(await imported.json(), { ok: true, imported: true, verified: true, bookmarks: 0, attempts: 2, theoryProgress: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 2);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test('exam activation between import precheck and batch does not seal the import ID', async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const adapter = sqliteD1(db);
  let injectBeforeBatch = false;
  let protectedId = 0;
  const raceSessionId = 'guest-import-race-session';
  globalThis.__BAEUMZIP_ENV__ = { DB: {
    ...adapter,
    batch: async (statements: Parameters<typeof adapter.batch>[0]) => {
      if (injectBeforeBatch) {
        injectBeforeBatch = false;
        db.prepare("INSERT INTO exam_sessions (id,user_key,exam_type,question_ids,started_at,ends_at) VALUES (?,?, 'SQLD', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
          .run(raceSessionId, userKey, JSON.stringify([protectedId]));
        db.prepare("INSERT INTO exam_session_items (session_id,question_id,position) VALUES (?,?,0)")
          .run(raceSessionId, protectedId);
      }
      return adapter.batch(statements);
    },
  } as unknown as D1Database };
  try {
    const started = await POST(request({ action: 'exam-start', examType: 'SQLD' }));
    const start = await started.json() as { session: { id: string; questionIds: number[] } };
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(start.session.id);
    protectedId = start.session.questionIds[0];
    const safeId = db.prepare("SELECT id FROM questions WHERE active=1 AND exam_scope IN ('both','SQLD') AND id NOT IN (SELECT question_id FROM exam_session_items WHERE session_id=?) LIMIT 1")
      .get(start.session.id)?.id as number;
    assert.ok(safeId);
    const body = { action: 'guest-import', importId: 'guest_import_race_001', selectedExam: 'SQLD',
      bookmarks: [], attempts: [protectedId, safeId].map((questionId) => ({ questionId, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' })) };
    injectBeforeBatch = true;
    const deferred = await POST(request(body));
    assert.deepEqual(await deferred.json(), { ok: true, imported: false, deferred: true },
      String(db.prepare("SELECT message FROM system_errors ORDER BY id DESC LIMIT 1").get()?.message));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, body.importId)?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 0,
      'a newly active exam must prevent all rows in this batch from being written');
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(raceSessionId);
    const correctAnswers = JSON.parse(String(db.prepare("SELECT correct_answers FROM questions WHERE id=?").get(safeId)?.correct_answers)) as number[];
    const correct = correctAnswers.length === 1 && correctAnswers[0] === 0;
    db.prepare(`INSERT INTO attempts
      (question_id,selected_answers,correct,mode,user_key,exam_type,result,score,answer_text,review_status,is_admin,client_operation_id,created_at)
      VALUES (?, '[0]', ?, 'guest-import:practice', ?, 'SQLD', ?, ?, '', ?, 0, ?, ?)`)
      .run(safeId, correct ? 1 : 0, userKey, correct ? 'correct' : 'incorrect', correct ? 100 : 0,
        correct ? 'mastered' : 'pending', guestAttemptOperationId(body.importId, 1), '2026-09-29T00:00:00.000Z');
    const otherSafeId = db.prepare("SELECT id FROM questions WHERE active=1 AND exam_scope='both' AND id NOT IN (?,?) LIMIT 1")
      .get(protectedId, safeId)?.id as number;
    const variations = [
      { ...body.attempts[1], selectedAnswers: [1] },
      { ...body.attempts[1], questionId: otherSafeId },
      { ...body.attempts[1], mode: 'bookmark-practice' },
      { ...body.attempts[1], examType: 'SQLP' },
    ];
    for (const variation of variations) {
      const changed = await POST(request({ ...body, attempts: [body.attempts[0], variation] }));
      assert.equal(changed.status, 409);
      assert.equal((await changed.json() as { code: string }).code, 'GUEST_IMPORT_CONFLICT',
        'an existing operation ID must not certify a changed mutation');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 1,
        'conflicting request must not partially write a new attempt');
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, body.importId)?.n, 0);
    assert.equal(db.prepare("SELECT selected_answers FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey, safeId)?.selected_answers, '[0]');
    const accepted = await POST(request(body));
    assert.equal((await accepted.json() as { attempts: number }).attempts, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 2);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test('unresolved guest items reject without consuming the import ID', async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const importId = 'guest_import_invalid_001';
    const rejected = await POST(request({ action: 'guest-import', importId, selectedExam: 'SQLD', bookmarks: [],
      attempts: [{ questionId: 999999999, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' }] }));
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json() as { code: string }).code, 'GUEST_IMPORT_UNRESOLVED_ITEMS');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?").get(userKey, importId)?.n, 0);
    const questionId = db.prepare("SELECT id FROM questions WHERE active=1 AND exam_scope IN ('both','SQLD') LIMIT 1").get()?.id as number;
    const accepted = await POST(request({ action: 'guest-import', importId, selectedExam: 'SQLD', bookmarks: [],
      attempts: [{ questionId, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' }] }));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as { attempts: number }).attempts, 1);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});


test('legacy receipt without a digest never clears or replays guest data', async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const importId = 'guest_import_legacy_001';
    db.prepare('INSERT INTO guest_import_batches (user_key,import_id) VALUES (?,?)').run(userKey,importId);
    const response = await POST(request({ action: 'guest-import', importId, selectedExam: 'SQLD', bookmarks: [], attempts: [] }));
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_import_receipts WHERE user_key=? AND import_id=?').get(userKey,importId)?.n, 0);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

const auth = { 'x-baeumzip-authenticated-user-email': email, 'x-sql-study-user-request': '1' };
const post = (body: Record<string, unknown>) => POST(new Request(`${origin}/api/study`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json', origin }, body: JSON.stringify(body),
}));
const get = (view: string) => GET(new Request(`${origin}/api/study?scope=records&exam=SQLD&view=${view}`, { headers: auth }));

test('MM051 actual record GETs cannot reveal deferred guest result; real submit allows one import', async () => {
  Object.assign(globalThis, { __BAEUMZIP_BUILD_SHA__: "mm051-local-test" });
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const started = await post({ action: 'exam-start', examType: 'SQLD' });
    assert.equal(started.status, 201);
    const start = await started.json() as { session: { id: string; revision: number; questionIds: number[] } };
    const questionId = start.session.questionIds[0];
    const bookmarked = await post({ action: 'bookmark', questionId, bookmarked: true });
    assert.equal(bookmarked.status, 200);
    const body = { action: 'guest-import', importId: 'guest_import_records_001', selectedExam: 'SQLD', bookmarks: [],
      attempts: [{ questionId, selectedAnswers: [0], examType: 'SQLD', mode: 'practice' }] };
    const altered = { ...body, attempts: [{ ...body.attempts[0], selectedAnswers: [1] }] };
    for (const candidate of [body, altered]) {
      const deferred = await post(candidate);
      assert.equal(deferred.status, 200);
      assert.deepEqual(await deferred.json(), { ok: true, imported: false, deferred: true });
      for (const view of ['stats', 'incorrect', 'bookmarks']) {
        const response = await get(view);
        assert.equal(response.status, 200);
        const records = await response.json() as { attempts: unknown[]; questions: Array<Record<string, unknown>>;
          recordStats?: { totalAttempts: number }; recordsSummary: { incorrectQuestionCount: number; bookmarkCount: number } };
        assert.equal(records.attempts.length, 0);
        if (view === 'stats') assert.equal(records.recordStats?.totalAttempts, 0);
        assert.equal(records.recordsSummary.incorrectQuestionCount, 0);
        assert.equal(records.recordsSummary.bookmarkCount, 1);
        assert.equal(records.questions.length, view === 'bookmarks' ? 1 : 0);
        for (const question of records.questions) {
          assert.equal(question.id, questionId);
          for (const secret of ['correct', 'correctAnswers', 'score', 'result', 'feedback', 'feedbackAuthorization',
            'selectedAnswers', 'answerText', 'explanation', 'scoringCriteria', 'requiredConcepts',
            'acceptableAlternatives', 'deductionConditions', 'errorConditions']) {
            assert.equal(Object.hasOwn(question, secret), false, `${view} exposed ${secret}`);
          }
        }
      }
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND mode LIKE 'guest-import:%'").get(userKey)?.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_import_batches WHERE user_key=? AND import_id=?').get(userKey, body.importId)?.n, 0);

    const correctAnswers = JSON.parse(String(db.prepare('SELECT correct_answers FROM questions WHERE id=?').get(questionId)?.correct_answers)) as number[];
    const submitted = await post({ action: 'exam-submit', sessionId: start.session.id,
      revision: start.session.revision, answers: { [questionId]: correctAnswers } });
    assert.equal(submitted.status, 200);
    const graded = await submitted.json() as { session: { status: string; result: { totalScore: number;
      questionResults: Array<{ questionId: number; result: string }> } }; questions: Array<Record<string, unknown>> };
    assert.equal(graded.session.status, 'submitted');
    assert.equal(typeof graded.session.result.totalScore, 'number');
    assert.equal(graded.session.result.questionResults.find(item => item.questionId === questionId)?.result, 'correct');
    assert.ok(graded.questions.some(question => question.id === questionId && Array.isArray(question.correctAnswers)));

    const first = await post(body);
    assert.equal(first.status, 200);
    assert.equal((await first.json() as { attempts: number }).attempts, 1);
    const duplicate = await post(body);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey, questionId)?.n, 1);
    const conflict = await post(altered);
    assert.equal(conflict.status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=? AND question_id=? AND mode LIKE 'guest-import:%'").get(userKey, questionId)?.n, 1);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
