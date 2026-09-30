import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  splitQuestionPromptForDisplay,
  stripTheoryDifficultyMetadata,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("sidebar shows the learning hierarchy and only actionable save feedback", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const feedback = source("apps/frontend/src/features/study/components/learning-feedback.tsx");
  const styles = source("apps/frontend/app/globals.css");
  assert.match(study, /현재 학습 · \{selectedField\.name\} › \{selectedExamName\}/);
  assert.match(study, /<span>모두의 문제집 개인 학습 공간<\/span>/);
  assert.match(study, /<SaveStatus status=\{saveStatus\} onRetry=\{onRetrySave\} \/>/);
  assert.match(feedback, /계정에 저장 중/u);
  assert.match(feedback, /status === "account-saved"\) return null/u);
  assert.doesNotMatch(feedback, />계정에 저장됨</u);
  assert.doesNotMatch(study, /계정별 학습 기록|브라우저별 학습 기록/);
  assert.match(styles, /\.sidebar-foot > p span\s*\{[\s\S]*display:\s*block/);
});

test("theory learning-position tables and future writes contain no difficulty metadata", () => {
  const database = materializeDatabase();
  const rows = database.prepare("SELECT id, difficulty, content FROM theories WHERE active = 1").all();
  assert.ok(rows.length > 0);
  assert.deepEqual([...new Set(rows.map((row) => row.difficulty))], [""]);
  assert.deepEqual(
    rows.filter((row) => /^\|\s*난이도\s*\|[^|\n]*\|\s*$/mu.test(row.content)).map((row) => row.id),
    [],
  );
  assert.equal(
    stripTheoryDifficultyMetadata("| 항목 | 내용 |\n|---|---|\n| 난이도 | advanced |\n| 영역 | 조인 |"),
    "| 항목 | 내용 |\n|---|---|\n| 영역 | 조인 |",
  );

  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  assert.match(adminApi, /stripTheoryDifficultyMetadata/);
  assert.match(adminApi, /difficulty:\s*""/);
});

test("long question leads become concise titles without discarding their conditions", () => {
  const example = [
    "대량 주문 배치의 통계정보를 재수집한 뒤 처리 시간이 증가했고 실행계획에서 조인 순서와 병렬 분배 방식이 달라졌다.",
    "기존 인덱스는 유지해야 하며 신규 인덱스는 하나만 추가할 수 있다.",
    "실행계획을 보고 추가해야 할 튜닝 힌트로 가장 적절한 것을 고르시오.",
  ].join(" ");
  const exampleParts = splitQuestionPromptForDisplay(example);
  assert.equal(exampleParts.stem, "실행계획을 보고 추가해야 할 튜닝 힌트로 가장 적절한 것을 고르시오.");
  assert.match(exampleParts.details, /대량 주문 배치/);
  assert.match(exampleParts.details, /신규 인덱스는 하나만/);

  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT id, prompt FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
  `).all();
  const overlyLong = rows
    .map((row) => ({ id: row.id, ...splitQuestionPromptForDisplay(row.prompt) }))
    .filter((row) => row.stem.length > 140);
  assert.deepEqual(overlyLong, []);
});

test("reviewed BAE prompts hide source markers and keep stimuli below the actual question", () => {
  const prose = splitQuestionPromptForDisplay([
    "서로 다른 지점의 온도 열이 각각 섭씨와 화씨이고 장비 코드 의미도 다르다.",
    "통합 전에 가장 필요한 조치는?",
    "<!-- source-item:BAE-W-P1-01-Q0004 -->",
  ].join("\n\n"));
  assert.equal(prose.stem, "통합 전에 가장 필요한 조치는?");
  assert.equal(prose.details, "서로 다른 지점의 온도 열이 각각 섭씨와 화씨이고 장비 코드 의미도 다르다.");

  const table = splitQuestionPromptForDisplay([
    "| 원천 | 건수 | 결측률 |",
    "|---|---:|---:|",
    "| A | 5만 | 1.0% |",
    "",
    "표본 수가 커도 표집 설계부터 다시 검토해야 할 원천은?",
    "",
    "<!-- source-item:BAE-W-P1-01-Q0005 -->",
  ].join("\n"));
  assert.equal(table.stem, "표본 수가 커도 표집 설계부터 다시 검토해야 할 원천은?");
  assert.match(table.details, /^\| 원천 \| 건수 \| 결측률 \|/u);
  assert.doesNotMatch(`${table.stem}\n${table.details}`, /source-item|<!--|-->/u);

  const looseTable = splitQuestionPromptForDisplay([
    "원천 | 건수 | 결측률",
    "A | 5만 | 1.0%",
    "B | 3만 | 2.0%",
    "",
    "표집 설계부터 다시 검토해야 할 원천은?",
    "",
    "<!-- source-item:BAE-W-P1-01-Q0005 -->",
  ].join("\n"));
  assert.equal(looseTable.details, [
    "| 원천 | 건수 | 결측률 |",
    "| --- | --- | --- |",
    "| A | 5만 | 1.0% |",
    "| B | 3만 | 2.0% |",
  ].join("\n"));

  const questionOnly = splitQuestionPromptForDisplay([
    "빅데이터 여부를 판단하는 기준으로 가장 적절한 것은?",
    "",
    "<!-- source-item:BAE-W-P1-01-Q0001 -->",
  ].join("\n"));
  assert.equal(questionOnly.stem, "빅데이터 여부를 판단하는 기준으로 가장 적절한 것은?");
  assert.equal(questionOnly.details, "");
});

test("report form explains minimum lengths and no longer collects the current page path", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const reportApi = source("apps/backend/src/modules/reports/reports.service.ts");
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  assert.match(study, /minLength=\{4\}/);
  assert.match(study, /최소 4자/);
  assert.match(study, /minLength=\{10\}/);
  assert.match(study, /최소 10자/);
  assert.doesNotMatch(study, /현재 화면: \{pagePath\}/);
  assert.doesNotMatch(study, /JSON\.stringify\(\{ category, title, description, pagePath/);
  assert.doesNotMatch(reportApi, /safePagePath/);
  assert.doesNotMatch(admin, /<span>화면 \{item\.page_path\}<\/span>/);
});

test("dashboard renders the last backup as a compact relative day label", () => {
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");
  assert.match(admin, /function daysAgoLabel/);
  assert.match(admin, /label="마지막 백업" value=\{daysAgoLabel\(metrics\.lastBackupAt\)\} compactValue/);
  assert.match(styles, /\.admin-metric\.compact-value > strong/);
});
