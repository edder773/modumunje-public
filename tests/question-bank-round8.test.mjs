import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { splitQuestionPromptForDisplay } from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("the reviewed replacement bank preserves only the two approved inactive questions", () => {
  const database = materializeDatabase();
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS physical,
      SUM(active) AS active,
      SUM(active = 1 AND kind != 'descriptive') AS objective,
      SUM(active = 1 AND kind = 'descriptive') AS descriptive
    FROM questions
    WHERE exam_scope IN ('SQLD', 'SQLP', 'both')
  `).get();
  const subjectCounts = database.prepare(`
    SELECT category, COUNT(*) AS count
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
    GROUP BY category
  `).all();
  const bySubject = Object.fromEntries(
    subjectCounts.map((row) => [row.category, row.count]),
  );

  assert.equal(totals.physical, 5225);
  assert.equal(totals.active, 5223);
  assert.equal(totals.objective, 5160);
  assert.equal(totals.descriptive, 63);
  assert.equal(bySubject["데이터 모델링의 이해"], 123);
  assert.equal(bySubject["SQL 기본 및 활용"], 381);
  assert.equal(bySubject["SQL 고급 활용 및 튜닝"], 4719);
  assert.equal(totals.physical - totals.active, 2);
  assert.deepEqual(
    database.prepare(`
      SELECT id FROM questions
      WHERE active = 0 AND exam_scope IN ('SQLD', 'SQLP', 'both')
      ORDER BY id
    `).all().map((row) => row.id),
    [891, 1700],
  );
});

test("every active replacement problem has a valid answer, explanation, and reviewed theory link", () => {
  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT q.*, t.id AS linked_theory_id, t.active AS theory_active,
           t.category AS theory_category, t.topic AS theory_topic
    FROM questions q
    LEFT JOIN theories t ON t.id = q.theory_id
    WHERE q.active = 1 AND q.exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY q.id
  `).all();

  assert.equal(rows.length, 5223);
  for (const row of rows) {
    assert.equal(row.active, 1);
    assert.ok(row.linked_theory_id, `문제 ${row.id} 이론 연결`);
    assert.equal(row.theory_active, 1, `문제 ${row.id} 활성 이론`);
    assert.ok(
      row.theory_category === row.category
        || row.theory_topic.trim().toLocaleLowerCase("ko-KR")
          === row.topic.trim().toLocaleLowerCase("ko-KR"),
      `문제 ${row.id} 이론 호환`,
    );
    assert.ok(row.prompt.trim().length >= 10, `문제 ${row.id} 본문`);
    assert.ok(row.explanation.trim().length >= 20, `문제 ${row.id} 상세 해설`);
    assert.doesNotMatch(row.explanation, /문제 풀이 적용/);
    assert.doesNotMatch(row.explanation, /�|모범답안\s*참조/);
    assert.equal((row.prompt.match(/```/g) ?? []).length % 2, 0, `문제 ${row.id} 본문 코드 펜스`);
    assert.equal((row.explanation.match(/```/g) ?? []).length % 2, 0, `문제 ${row.id} 해설 코드 펜스`);
    assert.equal(
      row.explanation.split(/\r?\n/u).filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line)).length % 2,
      0,
      `문제 ${row.id} 렌더링 코드 펜스`,
    );
    assert.doesNotMatch(
      row.explanation,
      /[①②③④⑤⑥⑦⑧⑨⑩][ \t]+(?:```|~~~)/u,
      `문제 ${row.id} 정답 번호와 코드 펜스 분리`,
    );

    if (row.kind === "descriptive") {
      assert.equal(row.exam_scope, "SQLP");
      assert.equal(row.category, "SQL 고급 활용 및 튜닝");
      assert.equal(JSON.parse(row.choices).length, 0);
      assert.ok(JSON.parse(row.scoring_criteria).length >= 3, `문제 ${row.id} 채점 기준`);
      assert.ok(JSON.parse(row.required_concepts).length >= 2, `문제 ${row.id} 필수 개념`);
      assert.ok(row.explanation.includes("## 모범답안"));
    } else {
      const choices = JSON.parse(row.choices);
      const answers = JSON.parse(row.correct_answers);
      assert.ok(choices.length >= 2, `문제 ${row.id} 선택지`);
      assert.ok(answers.length >= 1, `문제 ${row.id} 정답`);
      assert.ok(answers.every((answer) => Number.isInteger(answer) && answer >= 0 && answer < choices.length));
      assert.ok(row.explanation.includes("## 정답"));
    }
  }

  const invalidDescriptive = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
      AND kind = 'descriptive'
      AND (exam_scope <> 'SQLP' OR category <> 'SQL 고급 활용 및 튜닝')
  `).get().count;
  assert.equal(invalidDescriptive, 0);
});

test("replacement prompts stay concise and approved SQL retirements keep collision-free order", () => {
  const database = materializeDatabase();
  const longStems = database.prepare(`
    SELECT id, prompt FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
  `).all().map((row) => ({
    id: row.id,
    stemLength: splitQuestionPromptForDisplay(row.prompt).stem.length,
  })).filter((row) => row.stemLength > 180);
  assert.deepEqual(longStems, []);

  const sqlOrders = database.prepare(`
    SELECT display_order
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY display_order
  `).all().map((row) => row.display_order);
  assert.deepEqual(
    sqlOrders,
    Array.from({ length: sqlOrders.length }, (_, index) => index + 1),
  );
  const allOrders = database.prepare(`
    SELECT display_order FROM questions WHERE active = 1 ORDER BY display_order
  `).all().map((row) => row.display_order);
  assert.equal(new Set(allOrders).size, allOrders.length);
});

test("mock exam selection is left aligned while admin grids remain responsive", () => {
  const app = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sql/mock/mock-home.tsx")
    + source("apps/frontend/src/features/study/persistence/guest-learning-store.ts")
    + source("apps/frontend/src/features/study/persistence/client-event-id.ts");
  const styles = source("apps/frontend/app/globals.css");
  const adminStyles = source("apps/frontend/app/admin/admin.css");

  assert.match(app, /function MockExamHome[\s\S]*className="page-stack mock-home"/);
  assert.match(app, /function clientEventId\(\)[\s\S]*crypto\?\.randomUUID[\s\S]*crypto\?\.getRandomValues/);
  assert.doesNotMatch(app, /eventId:\s*crypto\.randomUUID/);
  assert.doesNotMatch(app, /useState\("오늘"\)|setTodayLabel\(dateLabel\(\)\)/);
  assert.match(styles, /\.exam-card-grid\s*\{[\s\S]*width:\s*min\(1060px,\s*100%\)[\s\S]*margin-inline:\s*0[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.mock-home \.mock-intro,\s*\.mock-home \.exam-shortage\s*\{[\s\S]*margin-inline:\s*0/);
  assert.match(adminStyles, /\.admin-section-head\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(adminStyles, /@media \(max-width:\s*1280px\)\s*\{[\s\S]*\.admin-metric-grid,\s*\.admin-metric-grid\.compact\s*\{[\s\S]*repeat\(3/);
  assert.match(adminStyles, /@media \(max-width:\s*1024px\)\s*\{[\s\S]*\.admin-metric-grid,\s*\.admin-metric-grid\.compact\s*\{[\s\S]*repeat\(2/);
});
