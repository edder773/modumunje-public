import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  extractModelAnswer,
  normalizeComparableContent,
  splitQuestionPromptForDisplay,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("guest learning, report modal, and admin trends use the repaired responsive controls", () => {
  const login = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(pageSession, /displayName: "비로그인 학습"/);
  assert.match(login, /session\.status === "guest"/);
  assert.doesNotMatch(study, /지금은 로그인 없이 바로 학습할 수 있습니다/);
  assert.doesNotMatch(styles, /\.guest-login-card\s*\{/);
  assert.match(study, /className="top-login-link"[\s\S]*로그인/);
  assert.match(study, /modal-actions user-report-actions/);
  assert.match(styles, /\.user-report-actions\s*\{[\s\S]*border-top:\s*0/);
  assert.match(admin, /"combined" \| "single"/);
  assert.match(admin, /setTrendMetric\("dau"|setTrendMetric\(key\)/);
  assert.match(admin, /단일 그래프 지표 선택/);
});

test("theories have no difficulty semantics and every linked question keeps a compatible lesson", () => {
  const database = materializeDatabase();
  const difficultyValues = database.prepare(
    "SELECT DISTINCT difficulty FROM theories",
  ).all().map((row) => row.difficulty);
  assert.deepEqual(difficultyValues, [""]);

  const invalidLinks = database.prepare(`
    SELECT q.id
    FROM questions q
    LEFT JOIN theories t ON t.id = q.theory_id
    WHERE q.active = 1 AND q.theory_id IS NOT NULL
      AND (
        t.id IS NULL
        OR t.active != 1
        OR (
          t.category != q.category
          AND lower(trim(t.topic)) != lower(trim(q.topic))
        )
        OR NOT (
          q.exam_scope = 'both'
          OR t.exam_scope = 'both'
          OR t.exam_scope = q.exam_scope
          OR (q.exam_scope = 'DAP' AND t.exam_scope = 'DA')
          OR (q.exam_scope IN ('IPEW', 'IPEP') AND t.exam_scope = 'IPE')
        )
      )
  `).all();
  assert.deepEqual(invalidLinks, []);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM questions
    WHERE active = 1 AND theory_id IS NULL
      AND exam_scope IN ('DA', 'DAP')
  `).get().count, 0);

  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  assert.doesNotMatch(study, /학습 단계 \{selected\.difficulty\}/);
  assert.doesNotMatch(admin, />학습 단계</);
});

test("descriptive answers contain real references and imported source artifacts are absent", () => {
  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT id, exam_scope, explanation
    FROM questions
    WHERE active = 1 AND kind = 'descriptive'
    ORDER BY id
  `).all();
  const placeholder = [];
  const artifact = [];
  for (const row of rows) {
    const modelAnswer = extractModelAnswer(row.explanation);
    if (
      normalizeComparableContent(modelAnswer).length < (row.exam_scope === "IPEP" ? 1 : 12)
      || /^(?:모범답안|정답|해설)\s*(?:참조|확인)/u.test(modelAnswer.trim())
    ) {
      placeholder.push(row.id);
    }
    if (/out\(\d+\)\.pdf|수록\s*문항/u.test(row.explanation)) artifact.push(row.id);
  }
  assert.deepEqual(placeholder, []);
  assert.deepEqual(artifact, []);

  for (const id of [661, 702, 703]) {
    const row = database.prepare(
      "SELECT prompt, explanation FROM questions WHERE id = ?",
    ).get(id);
    assert.doesNotMatch(row.explanation, /모범답안 참조/);
    assert.doesNotMatch(row.prompt, /\[(?:모범 SQL|튜닝 방안)/);
  }
});

test("generic imported headings are presentation metadata, not the visible question title", () => {
  const parts = splitQuestionPromptForDisplay(
    "### SQLP 확장 문제 123\n\n아래 SQL을 튜닝하시오.\n\n## 조건\n\n인덱스는 하나만 추가할 수 있다.",
  );
  assert.equal(parts.stem, "아래 SQL을 튜닝하시오.");
  assert.match(parts.details, /## 조건/);
  assert.doesNotMatch(parts.stem, /SQLP 확장 문제/);
});
