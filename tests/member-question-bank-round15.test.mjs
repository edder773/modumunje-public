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

test("signed-in learners are registered and blocked accounts are rejected server-side", () => {
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const page = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const studyApi = source("apps/backend/src/modules/study/study.service.ts");
  const reportApi = source("apps/backend/src/modules/reports/reports.service.ts");

  assert.match(auth, /INSERT INTO user_accounts/);
  assert.match(auth, /status === "blocked"/);
  assert.match(auth, /ACCOUNT_BLOCKED/);
  assert.match(pageSession, /readLearnerAccount/);
  assert.match(pageSession, /account\?\.status === "blocked"/);
  assert.match(page, /session\.status === "blocked"/);
  assert.match(studyApi, /action === "account-touch"/);
  assert.match(reportApi, /authorizeLearnerRequest\(request, \{ createIfMissing: true \}\)/);
});

test("admin member management supports search, pagination, block, unblock, and self-protection", () => {
  const sections = source("apps/frontend/src/features/admin/model/admin-sections.ts");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");

  assert.match(sections, /"members"/);
  assert.match(pageSession, /requireSiteUser\(returnTo\)/);
  assert.match(pageSession, /isAdminEmail\(user\.email\)/);
  assert.doesNotMatch(pageSession, /ensureLearnerAccount/u);
  assert.match(pageSession, /if \(!isAdminEmail\(user\.email\)\) forbidden\(\)/);
  assert.match(ui, /회원 관리/);
  assert.match(ui, /user-block/);
  assert.match(ui, /user-unblock/);
  assert.match(api, /resource === "members"/);
  assert.match(api, /action === "user-block" \|\| action === "user-unblock"/);
  assert.match(api, /현재 관리자 계정은 차단할 수 없습니다/);
  assert.match(api, /blocked_reason/);
  assert.match(api, /targetType = "user-account"/);
});

test("account data is migrated safely and included in protected backups", () => {
  const database = materializeDatabase();
  const columns = new Set(
    database.prepare("PRAGMA table_info(user_accounts)").all().map((row) => row.name),
  );
  for (const column of [
    "user_key",
    "email",
    "display_name",
    "status",
    "blocked_reason",
    "blocked_at",
    "blocked_by_hash",
    "last_login_at",
  ]) {
    assert.ok(columns.has(column), column);
  }
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts")
    + source("packages/shared/src/admin/backup-contract.mjs");
  assert.match(api, /"user_accounts"/);
});

test("learner branding uses a solid mark and learning history reports correct and incorrect counts", () => {
  const page = source("apps/frontend/app/page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.doesNotMatch(page, /login-brand-mark">배/);
  assert.doesNotMatch(study, /brand-mark">배/);
  assert.match(styles, /\.brand-mark\s*\{[\s\S]*?background:\s*var\(--ink\)/);
  const stats = source("apps/frontend/src/features/study/components/sql/records/records-screen.tsx").split("export function StatsView")[1];
  assert.doesNotMatch(stats, /복습/);
  assert.match(stats, /정답 수/);
  assert.match(stats, /오답 수/);
  assert.match(stats, /정답 \{item\.correct\}회 · 오답 \{item\.incorrect\}회/);
});

test("replacement question bank passes scope, answer, rubric, title, and theory-link validation", () => {
  const database = materializeDatabase();
  const totals = database.prepare(`
    SELECT COUNT(*) AS physical, SUM(active) AS active,
           SUM(active = 1 AND kind != 'descriptive') AS objective,
           SUM(active = 1 AND kind = 'descriptive') AS descriptive
    FROM questions
    WHERE exam_scope IN ('SQLD', 'SQLP', 'both')
  `).get();
  assert.deepEqual(
    { ...totals },
    { physical: 5225, active: 5223, objective: 5160, descriptive: 63 },
  );

  const invalid = database.prepare(`
    SELECT q.id
    FROM questions q
    LEFT JOIN theories t ON t.id = q.theory_id
    WHERE q.active = 1 AND q.exam_scope IN ('SQLD', 'SQLP', 'both') AND (
      q.prompt = ''
      OR q.explanation = ''
      OR instr(q.explanation, '문제 풀이 적용') > 0
      OR instr(q.explanation, '�') > 0
      OR t.id IS NULL
      OR t.active != 1
      OR (
        t.category != q.category
        AND lower(trim(t.topic)) != lower(trim(q.topic))
      )
      OR (
        q.kind = 'descriptive'
        AND (
          q.exam_scope != 'SQLP'
          OR q.category != 'SQL 고급 활용 및 튜닝'
          OR json_array_length(q.scoring_criteria) < 3
          OR json_array_length(q.required_concepts) < 2
        )
      )
      OR (
        q.kind != 'descriptive'
        AND (
          json_array_length(q.choices) < 2
          OR json_array_length(q.correct_answers) < 1
        )
      )
    )
  `).all();
  assert.deepEqual(invalid, []);

  const badAnswers = database.prepare(`
    SELECT q.id
    FROM questions q, json_each(q.correct_answers) answer
    WHERE q.active = 1 AND q.exam_scope IN ('SQLD', 'SQLP', 'both')
      AND q.kind != 'descriptive'
      AND (
        json_type(answer.value) NOT IN ('integer', 'real')
        OR CAST(answer.value AS INTEGER) < 0
        OR CAST(answer.value AS INTEGER) >= json_array_length(q.choices)
      )
  `).all();
  assert.deepEqual(badAnswers, []);

  const longStems = database.prepare(`
    SELECT id, prompt FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
  `).all().map((row) => ({
    id: row.id,
    stemLength: splitQuestionPromptForDisplay(row.prompt).stem.length,
  })).filter((row) => row.stemLength > 180);
  assert.deepEqual(longStems, []);
});
