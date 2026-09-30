import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { certificationSubmissionCounts, type SubjectSubmissionCount } from "../packages/shared/src/admin/submission-analytics";
import { submissionQuery, subjectSubmissionCounts, type SubmissionRow } from "../apps/backend/src/modules/admin/admin-submission-query";
import { allowSubmissionAnalytics, GUEST_SQL_MOCK_EVENTS_SQL, GUEST_SW_MOCK_EVENTS_SQL } from "../apps/backend/src/modules/events/guest-mock-submission-sql";

const start = "2026-09-13T15:00:00.000Z";
const end = "2026-09-14T14:59:59.999Z";
const at = "2026-09-14T01:00:00.000Z";

test("certification totals merge subjects and written/practical courses while keeping distinct certificates separate", () => {
  const item = (examType: string, courseName: string, subject: string, memberCount = 1, guestCount = 1): SubjectSubmissionCount =>
    ({ examType, courseName, subject, memberCount, guestCount, count: memberCount + guestCount });
  const items = [
    item("SQLD", "SQLD", "데이터 모델링의 이해"), item("SQLD", "SQLD", "SQL 기본 및 활용"),
    item("SQLP", "SQLP", "SQL 기본 및 활용"), item("DASP", "DAsP", "데이터 모델링"), item("DAP", "DAP", "데이터 모델링"),
    item("IPEW", "정보처리기사 필기", "소프트웨어 설계", 2, 3), item("IPEP", "정보처리기사 실기", "정보처리실무", 4, 5),
    item("ISEW", "정보보안기사 필기", "시스템보안"), item("ISEW", "정보보안기사 필기", "네트워크보안"),
    item("ISEP", "정보보안기사 실기", "정보보안 실무"),
    item("BAE", "빅데이터분석기사 필기", "빅데이터 탐색"),
    item("SW", "SW 전공", "자료구조"), item("SW", "SW 전공", "알고리즘"),
  ];
  const rows = certificationSubmissionCounts(items);
  assert.equal(rows.length, 8);
  const totals = Object.fromEntries(rows.map(row => [row.certificationId, row.count]));
  assert.deepEqual(totals, { IPE: 14, ISE: 6, SQLD: 4, SW: 4, BAE: 2, DASP: 2, DAP: 2, SQLP: 2 });
  assert.deepEqual(rows.find(row => row.certificationId === "IPE"), {
    certificationId: "IPE", certificationName: "정보처리기사", memberCount: 6, guestCount: 8, count: 14,
  });
  assert.equal(rows.find(row => row.certificationId === "BAE")?.certificationName, "빅데이터분석기사");
  for (const key of ["count", "memberCount", "guestCount"] as const) {
    assert.equal(rows.reduce((sum, row) => sum + row[key], 0), items.reduce((sum, row) => sum + row[key], 0));
  }
  assert.deepEqual(certificationSubmissionCounts([]), []);
});
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE analytics_events (id TEXT PRIMARY KEY, event_type TEXT, occurred_at TEXT,
      anonymous_session_id TEXT, user_key_hash TEXT, is_admin INTEGER DEFAULT 0, exam_scope TEXT,
      subject TEXT, question_id INTEGER, content_id TEXT, dedupe_key TEXT UNIQUE);
    CREATE INDEX analytics_events_type_admin_time_session_idx ON analytics_events(event_type,is_admin,occurred_at,anonymous_session_id);
    CREATE TABLE questions (id INTEGER PRIMARY KEY, category TEXT);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, created_at TEXT, exam_type TEXT, question_id INTEGER,
      is_admin INTEGER DEFAULT 0, mode TEXT DEFAULT 'practice', selected_answers TEXT DEFAULT '[0]',
      answer_text TEXT DEFAULT '', client_operation_id TEXT);
    CREATE TABLE sw_questions (id TEXT PRIMARY KEY, category TEXT);
    CREATE TABLE sw_attempts (id INTEGER PRIMARY KEY, user_key TEXT, created_at TEXT, question_id TEXT,
      selected_answers TEXT DEFAULT '[0]', mode TEXT DEFAULT 'practice', client_operation_id TEXT);
    CREATE INDEX sw_attempts_user_operation_idx ON sw_attempts(user_key,client_operation_id);
    CREATE TABLE exam_sessions (id TEXT PRIMARY KEY, user_key TEXT, status TEXT, submitted_at TEXT,
      exam_type TEXT, is_admin INTEGER DEFAULT 0, result TEXT);
    CREATE TABLE sw_learning_sessions (id TEXT PRIMARY KEY, user_key TEXT, status TEXT, mode TEXT,
      updated_at TEXT, question_ids TEXT, answers TEXT, revision INTEGER DEFAULT 1);
    CREATE TABLE study_group_exam_runs (id TEXT PRIMARY KEY,status TEXT,completed_at TEXT);
    CREATE TABLE study_group_exam_participant_progress (run_id TEXT,user_key TEXT,finished_at_utc TEXT);
    CREATE TABLE study_group_exam_question_public (run_id TEXT,position INTEGER,area_code_snapshot TEXT);
    CREATE TABLE study_group_exam_answers (run_id TEXT,user_key TEXT,position INTEGER,answer_json TEXT,
      PRIMARY KEY(run_id,user_key,position));
    INSERT INTO questions VALUES (1,'시스템보안'),(2,'네트워크보안'),(3,'시스템보안');
    INSERT INTO sw_questions VALUES ('SW-1','자료구조'),('SW-2','알고리즘');
  `);
  return db;
}
function event(db: DatabaseSync, id: string, member: string | null, question = 1, admin = 0, date = at) {
  db.prepare(`INSERT INTO analytics_events (id,event_type,occurred_at,anonymous_session_id,user_key_hash,
    is_admin,exam_scope,subject,question_id,dedupe_key) VALUES (?,'question_answer_submitted',?,'browser',?,?,'ISEW','old label',?,?)`)
    .run(id,date,member,admin,question,id);
}
const query = (db: DatabaseSync, exclude = true) => db.prepare(submissionQuery(exclude)).all(start,end,"admin") as SubmissionRow[];
function sqlExam(db: DatabaseSync, id = "exam-1", owner = "guest:test", date = at) {
  const result = { questionResults: [
    { questionId: 1, category: "시스템보안", result: "correct" },
    { questionId: 2, category: "네트워크보안", result: "incorrect" },
    { questionId: 3, category: "시스템보안", result: "unanswered" },
  ] };
  db.prepare("INSERT INTO exam_sessions (id,user_key,status,submitted_at,exam_type,result) VALUES (?,?,'submitted',?,'ISEW',?)")
    .run(id,owner,date,JSON.stringify(result));
}
function swExam(db: DatabaseSync, id: string, owner: string) {
  db.prepare("INSERT INTO sw_learning_sessions VALUES (?,?,'submitted','mock',?,'[\"SW-1\",\"SW-2\"]','{\"SW-1\":[0]}',1)")
    .run(id,owner,at);
}

test("the complete analytics query runs within real workerd D1 limits with every submission source", async () => {
  const fixture = database();
  fixture.prepare("INSERT INTO attempts (exam_type,question_id,created_at) VALUES ('ISEW',1,?)").run(at);
  fixture.prepare("INSERT INTO sw_attempts (user_key,question_id,created_at) VALUES ('member','SW-1',?)").run(at);
  event(fixture, "guest-practice", null);
  sqlExam(fixture, "journal-exam");
  fixture.prepare(GUEST_SQL_MOCK_EVENTS_SQL).run("hashed-guest", "journal-exam", "guest:test", at);
  sqlExam(fixture, "legacy-exam");
  swExam(fixture, "sw-mock", "guest:test");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('test'); } };", d1Databases: ["DB"], cf: false }));
  try {
    const d1 = await runtime.getD1Database("DB");
    const tables = fixture.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all() as { name: string; sql: string }[];
    await d1.batch(tables.map(table => d1.prepare(table.sql)));
    for (const table of tables) {
      const rows = fixture.prepare(`SELECT * FROM ${table.name}`).all();
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      await d1.batch(rows.map(row => d1.prepare(`INSERT INTO ${table.name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map(column => row[column]))));
    }
    for (const exclude of [true, false]) {
      const actual = await d1.prepare(submissionQuery(exclude)).bind(start, end, "admin").all();
      assert.deepEqual(actual.results, query(fixture, exclude).map(row => ({ ...row })));
      assert.equal((actual.results as SubmissionRow[]).reduce((sum, row) => sum + row.count, 0), 8);
    }
  } finally {
    fixture.close();
    await runtime.dispose();
  }
});

test("subject counts combine saved member attempts and guest events without member telemetry or import duplication", () => {
  const db=database();
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at) VALUES ('ISEW',1,?)").run(at);
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at,mode) VALUES ('ISEW',1,?,'guest-import:practice')").run(at);
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at) VALUES ('IPEW',3,?)").run(at);
  event(db,"member-event","member"); event(db,"guest-event",null);
  const rows=subjectSubmissionCounts(query(db));
  assert.deepEqual(rows.map(r=>[r.examType,r.memberCount,r.guestCount,r.count]),[["ISEW",1,1,2],["IPEW",1,0,1]]);
  assert.equal(rows[0].subject,"시스템보안");
  assert.equal(rows[0].courseName,"정보보안기사 필기");
  db.close();
});

test("completed Group SKCT counts durable answered rows only, without replay or polling duplication",()=>{
  const db=database();
  db.prepare("INSERT INTO study_group_exam_runs VALUES ('group-run','completed',?)").run(at);
  db.prepare("INSERT INTO study_group_exam_participant_progress VALUES ('group-run','member',?)").run(at);
  ["언어이해","자료해석","창의수리","언어추리","수열추리"].forEach((area,position)=>db.prepare("INSERT INTO study_group_exam_question_public VALUES ('group-run',?,?)").run(position,area));
  db.prepare("INSERT INTO study_group_exam_answers VALUES ('group-run','member',0,'[0]')").run();
  db.prepare("INSERT INTO study_group_exam_answers VALUES ('group-run','member',1,'[1]')").run();
  db.prepare("INSERT INTO study_group_exam_answers VALUES ('group-run','member',2,'[]')").run();
  const rows=subjectSubmissionCounts(query(db));
  assert.deepEqual(rows.map(row=>[row.examType,row.courseName,row.subject,row.memberCount]),[
    ["GROUP_SKCT","그룹 SKCT","언어이해",1],["GROUP_SKCT","그룹 SKCT","자료해석",1],
  ]);
  assert.ok(rows.every(row=>row.count===1));
  db.close();
});

test("date range is inclusive in KST; administrator submissions and blank answers are excluded consistently",()=>{
  const db=database();
  event(db,"first",null,1,0,start); event(db,"last",null,1,0,end);
  event(db,"before",null,1,0,"2026-09-13T14:59:59.999Z"); event(db,"after",null,1,0,"2026-09-14T15:00:00.000Z");
  event(db,"admin-event",null,1,1);
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at,is_admin) VALUES ('ISEW',1,?,1)").run(at);
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at,selected_answers,mode) VALUES ('ISEW',1,?,'[]','mock-exam')").run(at);
  db.prepare("INSERT INTO sw_attempts (user_key,question_id,created_at) VALUES ('admin','SW-1',?)").run(at);
  swExam(db,'admin-mock','admin');
  assert.equal(query(db).reduce((n,r)=>n+r.count,0),2);
  assert.equal(query(db,false).reduce((n,r)=>n+r.count,0),6);
  assert.ok(query(db).every(r=>r.day==='2026-09-14'));
  db.close();
});

test("SQL guest mock events persist answered questions, dedupe retries, and survive guest-session cleanup",()=>{
  const db=database(); sqlExam(db);
  assert.equal(query(db).reduce((n,r)=>n+r.guest_count,0),2,'legacy retained result fallback');
  for(let i=0;i<2;i++) db.prepare(GUEST_SQL_MOCK_EVENTS_SQL).run('hashed-guest','exam-1','guest:test',at);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analytics_events").get()!.n,2);
  assert.equal(query(db).reduce((n,r)=>n+r.count,0),2,'journal and retained result count once');
  db.prepare("INSERT INTO attempts (exam_type,question_id,created_at,client_operation_id) VALUES ('ISEW',1,?,'guest-exam:exam-1:0')").run(at);
  db.exec("UPDATE exam_sessions SET user_key='member'");
  assert.equal(query(db).reduce((n,r)=>n+r.count,0),2,'claim does not add a member submission');
  db.exec("DELETE FROM exam_sessions");
  assert.equal(query(db).reduce((n,r)=>n+r.guest_count,0),2,'temporary session expiration preserves aggregates');
  db.close();
});

test("SW member and guest mock sessions count submitted answers and remain stable when claimed",()=>{
  const db=database(); swExam(db,'sw-guest','guest:test'); swExam(db,'sw-member','member');
  let rows=query(db); assert.equal(rows[0].member_count,1); assert.equal(rows[0].guest_count,1);
  db.prepare(GUEST_SW_MOCK_EVENTS_SQL).run('hashed-guest','sw-guest','guest:test',at,1,'{"SW-1":[0]}');
  db.prepare("INSERT INTO sw_attempts (user_key,created_at,question_id,mode,client_operation_id) VALUES ('member',?,'SW-1','mock','guest-session:sw-guest:0')").run(at);
  db.exec("UPDATE sw_learning_sessions SET user_key='member' WHERE id='sw-guest'");
  rows=query(db); assert.equal(rows[0].member_count,1); assert.equal(rows[0].guest_count,1);
  db.exec("DELETE FROM sw_learning_sessions WHERE id='sw-guest'");
  assert.equal(query(db)[0].count,2);
  db.close();
});

test("legacy claimed SW mocks remain guest submissions without relying on new telemetry",()=>{
  const db=database(); swExam(db,'old-sw','member');
  db.prepare("INSERT INTO sw_attempts (user_key,created_at,question_id,mode,client_operation_id) VALUES ('member',?,'SW-1','mock','guest-session:old-sw:0')").run(at);
  assert.equal(query(db)[0].guest_count,1); assert.equal(query(db)[0].member_count,0);
  db.close();
});

test("disabled collection, unfinished sessions, wrong owner and revision cannot create guest mock telemetry",()=>{
  const db=database(); sqlExam(db); swExam(db,'sw-guest','guest:test');
  db.prepare(GUEST_SQL_MOCK_EVENTS_SQL).run('hash','exam-1','different-owner',at);
  db.prepare(GUEST_SW_MOCK_EVENTS_SQL).run('hash','sw-guest','guest:test',at,2,'{"SW-1":[0]}');
  db.exec("UPDATE exam_sessions SET status='active'");
  db.prepare(GUEST_SQL_MOCK_EVENTS_SQL).run('hash','exam-1','guest:test',at);
  db.exec("UPDATE exam_sessions SET status='submitted'; INSERT INTO site_settings VALUES ('analytics_enabled','false')");
  db.prepare(GUEST_SQL_MOCK_EVENTS_SQL).run('hash','exam-1','guest:test',at);
  db.prepare(GUEST_SW_MOCK_EVENTS_SQL).run('hash','sw-guest','guest:test',at,1,'{"SW-1":[0]}');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analytics_events').get()!.n,0);
  assert.equal(allowSubmissionAnalytics(new Request('https://example.test',{headers:{dnt:'1'}})),false);
  assert.equal(allowSubmissionAnalytics(new Request('https://example.test',{headers:{'sec-gpc':'1'}})),false);
  db.close();
});

test("missing historical question metadata stays visible, and the query retains indexed event access",()=>{
  const db=database(); event(db,'historical',null,999);
  const rows=query(db); assert.equal(rows[0].subject,'old label');
  const plan=db.prepare('EXPLAIN QUERY PLAN '+submissionQuery(true)).all(start,end,'admin').map(r=>r.detail).join('\n');
  assert.match(plan,/analytics_events_type_admin_time_session_idx/);
  assert.deepEqual(subjectSubmissionCounts([]),[]);
  db.close();
});
