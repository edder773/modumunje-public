import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  SUBJECT_ONE_ORDER,
  SUBJECT_TWO_ORDER,
} from "../scripts/theory-curriculum-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("theory curriculum follows the requested subject order", () => {
  const database = materializeDatabase();
  const rows = database.prepare(
    "SELECT id, category, topic, sort_order, title FROM theories ORDER BY category, sort_order, id",
  ).all();

  const subjectOne = rows
    .filter((row) => row.category === "데이터 모델링의 이해")
    .map((row) => row.id);
  const subjectTwo = rows
    .filter((row) => row.category === "SQL 기본 및 활용")
    .map((row) => row.id);
  const subjectThree = rows
    .filter((row) => row.category === "SQL 고급 활용 및 튜닝");
  const subjectThreeTopics = [...new Set(subjectThree.map((row) => row.topic))];

  assert.deepEqual(subjectOne, SUBJECT_ONE_ORDER);
  assert.deepEqual(subjectTwo, SUBJECT_TWO_ORDER);
  assert.deepEqual(subjectThreeTopics, [
    "데이터베이스 아키텍처",
    "SQL 처리 과정",
    "SQL 파싱과 최적화",
    "옵티마이저",
    "실행계획",
    "통계정보",
    "SQL 성능 문제 진단",
    "데이터베이스 Call 최소화",
    "인덱스 기본 원리",
    "인덱스 스캔 방식",
    "테이블 액세스 최소화",
    "조인 순서와 조인 방식",
    "NL 조인",
    "소트 머지 조인",
    "해시 조인",
    "소트 튜닝",
    "스칼라 서브쿼리",
    "서브쿼리와 조인 변환",
    "옵티마이저 쿼리 변환",
    "고급 SQL 활용",
    "파티셔닝",
    "병렬 처리",
    "트랜잭션",
    "동시성 제어",
    "Lock",
    "DML 튜닝",
  ]);
  assert.equal(subjectThree[0].topic, "데이터베이스 아키텍처");
});

test("subject two contains no optimizer, index, or execution-plan curriculum", () => {
  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT id, title, topic, summary, keywords, content
    FROM theories
    WHERE category = 'SQL 기본 및 활용'
  `).all();
  const forbidden = /인덱스|index|옵티마이저|optimizer|실행계획|execution\s+plan/iu;

  assert.equal(rows.length, 24);
  assert.deepEqual(
    rows.filter((row) => forbidden.test(
      `${row.title}\n${row.topic}\n${row.summary}\n${row.keywords}\n${row.content}`,
    )),
    [],
  );
  const movedQuestion = database.prepare(
    "SELECT category, topic, theory_id FROM questions WHERE id = 1437",
  ).get();
  assert.deepEqual({ ...movedQuestion }, {
    category: "SQL 기본 및 활용",
    topic: "SELECT",
    theory_id: 802,
  });
});

test("theory cards reflow and bookmark review exposes explicit answers", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(styles, /\.theory-card\s*\{[\s\S]*?display:\s*flex[\s\S]*?height:\s*100%/u);
  assert.match(styles, /\.theory-card h3\s*\{[\s\S]*?overflow-wrap:\s*anywhere/u);
  assert.match(styles, /\.theory-card > strong\s*\{[\s\S]*?margin-top:\s*auto/u);
  assert.match(component, /className="bookmark-correct-answer"/u);
  assert.match(component, /answerLetters\(question\.correctAnswers\)/u);
  assert.match(component, /question\.correctAnswers\.map/u);
  assert.match(component, /gradeModalAnswer/u);
});
