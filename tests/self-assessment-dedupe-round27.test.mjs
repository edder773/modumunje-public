import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

const removedDuplicateIds = [
  1957, 1964, 1971, 1978, 1985, 1992,
  1960, 1967, 1974, 1981, 1988,
  1961, 1968, 1975, 1982, 1989,
  1962, 1969, 1976, 1983, 1990,
  2012, 2017, 2022, 2027,
  2121, 2127, 2133, 2139,
  2122, 2128, 2134, 2140,
  2123, 2129, 2135,
  2126, 2132, 2138,
];

test("numeric-variant duplicates are removed while approved retirements remain traceable", () => {
  const database = materializeDatabase();
  const totals = database.prepare(`
    SELECT COUNT(*) AS total,
           SUM(kind != 'descriptive') AS objective,
           SUM(kind = 'descriptive') AS descriptive,
           SUM(active = 0) AS inactive
    FROM questions
    WHERE exam_scope IN ('SQLD', 'SQLP', 'both')
  `).get();

  assert.equal(totals.total, 5225);
  assert.equal(totals.objective, 5161);
  assert.equal(totals.descriptive, 64);
  assert.equal(totals.inactive, 2);
  const placeholders = removedDuplicateIds.map(() => "?").join(",");
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count FROM questions WHERE id IN (${placeholders})`)
      .get(...removedDuplicateIds).count,
    0,
  );
  for (const canonicalId of [1950, 1953, 1954, 1955, 2007, 2114, 2115, 2116, 2117]) {
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM questions WHERE id = ?").get(canonicalId).count,
      1,
    );
  }

  const normalized = (value) => String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\d+(?:[.,]\d+)*/gu, "#")
    .replace(/\s+/gu, " ")
    .trim();
  const signatures = new Map();
  for (const row of database.prepare(`
    SELECT id, kind, category, prompt, choices, explanation
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
  `).all()) {
    const signature = [
      row.kind,
      row.category,
      normalized(row.prompt),
      normalized(row.choices),
      normalized(row.explanation),
    ].join("|");
    const owners = signatures.get(signature) ?? [];
    owners.push(row.id);
    signatures.set(signature, owners);
  }
  assert.deepEqual(
    [...signatures.values()].filter((owners) => owners.length > 1),
    [],
  );
});

test("SQL and DA theory content has no external links and subject 3 has the requested continuous order", () => {
  const database = materializeDatabase();
  const externalLinks = database.prepare(`
    SELECT id
    FROM theories
    WHERE active = 1
      AND exam_scope IN ('SQLD', 'SQLP', 'both', 'DASP', 'DAP', 'DA')
      AND (
        lower(content) LIKE '%http://%'
        OR lower(content) LIKE '%https://%'
        OR lower(content) LIKE '%www.%'
      )
  `).all();
  assert.deepEqual(externalLinks, []);

  const subject3 = database.prepare(`
    SELECT sort_order, title
    FROM theories
    WHERE active = 1 AND category = 'SQL 고급 활용 및 튜닝'
    ORDER BY sort_order, id
  `).all();
  assert.equal(subject3.length, 122);
  assert.deepEqual(
    subject3.map((row) => row.sort_order),
    Array.from({ length: 122 }, (_, index) => index + 1),
  );
  assert.equal(subject3[0].title, "Oracle 아키텍처 입문: Database·Instance·Startup 단계");
  assert.equal(subject3[1].title, "Oracle 메모리 구조: SGA·PGA·UGA와 Workarea");
  assert.equal(subject3.at(-1).title, "Oracle RAC 구조: 다중 Instance·Cache Fusion·GCS·GES");
});

test("descriptive practice and mock exams use self assessment instead of AI grading", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const route = source("apps/backend/src/modules/study/study.service.ts");
  const schema = source("apps/backend/src/infrastructure/database/schema.ts");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(study, /function DescriptiveGuidance[\s\S]*평가 기준[\s\S]*모범답안[\s\S]*해설/u);
  const records = source("apps/frontend/src/features/study/components/sql/records/records-screen.tsx");
  assert.match(records, /<DescriptiveGuidance question=\{question\}/u);
  assert.match(study, /내 답안 직접 채점하기/u);
  assert.match(study, /onDescriptiveScores/u);
  assert.match(study, /문항당 \{config\.descriptivePoint\}점 기준으로 환산/u);
  assert.match(study, /const objectiveCount = queue\.reduce/u);
  assert.match(study, /서술형 답안과 직접 채점 점수를 저장했습니다/u);
  assert.doesNotMatch(study, /답안 평가 중|AI 평가|자동 평가/u);
  assert.doesNotMatch(study, /className="guest-login-card"/u);
  assert.match(study, /className="top-login-link"[\s\S]*로그인/u);
  assert.doesNotMatch(route, /evaluateDescriptive|evaluationReferenceHash|answerHash/u);
  assert.match(route, /if \(action === "evaluate"\)[\s\S]*status: 410/u);
  assert.match(route, /selfScore \* \(config\.descriptivePoint \/ 100\)/u);
  assert.match(schema, /descriptiveScores: text\("descriptive_scores"\)/u);
  assert.match(styles, /\.descriptive-guidance\s*\{/u);
  assert.match(styles, /\.self-score-control,/u);
  assert.doesNotMatch(styles, /\.guest-login-card\s*\{/u);
});
