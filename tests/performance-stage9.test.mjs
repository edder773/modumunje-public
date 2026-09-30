import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the catalog route uses a lightweight shell and keeps reports lazy", () => {
  const learnerPage = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const shell = source("apps/frontend/src/features/study/components/catalog/catalog-page-shell.tsx");
  const reportAction = source("apps/frontend/src/features/study/components/catalog/catalog-report-action.tsx");

  assert.match(learnerPage, /initialPath === "\/"[\s\S]*<CatalogPageShell/u);
  assert.match(shell, /app-shell catalog-context/u);
  assert.match(shell, /<StudyTopbar/u);
  assert.match(reportAction, /lazy\(\(\) => import\("\.\.\/sql\/reports\/user-report-modal"\)\)/u);
  assert.doesNotMatch(shell, /StudyApp/u);
});

test("the accessible modal remains isolated and the public catalog has no login modal", () => {
  const shared = source("apps/frontend/src/features/study/components/study-screen-shared.tsx");
  const modal = source("apps/frontend/src/features/study/components/modal.tsx");
  const catalog = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");

  assert.doesNotMatch(shared, /export function Modal/u);
  assert.doesNotMatch(catalog, /const Modal = lazy\(\(\) => import\("\.\.\/modal"\)\)/u);
  assert.doesNotMatch(catalog, /Suspense fallback=\{<span className="sr-only" role="status">/u);
  assert.doesNotMatch(catalog, /import Modal from "\.\.\/modal"/u);
  assert.match(modal, /aria-modal="true"/u);
  assert.match(modal, /event\.key === "Escape"/u);
  assert.match(modal, /previousFocus\?\.focus\(\)/u);
});

test("independent study reads use concurrent or batched D1 execution", () => {
  const delivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const questionQueries = source("apps/backend/src/modules/study/study-question.repository-queries.ts");
  const theoryQueries = source("apps/backend/src/modules/study/study-theory.repository-queries.ts");
  const swRepository = source("apps/backend/src/modules/sw-study/sw-study.repository.ts");
  assert.match(questionQueries, /async function readActiveQuestionsByIds[\s\S]*database\.batch\(statements\)/u);
  assert.match(questionQueries, /async function readPracticeMetaWithSetting[\s\S]*database\.batch\(\[/u);
  assert.match(questionQueries, /async function readPracticeQuestionsWithSetting[\s\S]*database\.batch\(\[/u);
  assert.match(delivery, /readPublicContentCache\([\s\S]*repository\.findPracticeMeta\(selectedExam\)/u);
  assert.match(delivery, /repository\.readUserSetting\(key\)/u);
  assert.match(delivery, /repository\.findPracticeQuestionsWithSetting\(candidateInput, key\)/u);
  assert.doesNotMatch(delivery, /ensureUserSetting/u);
  assert.match(theoryQueries, /async function readTheoryDetailContext[\s\S]*await readTheoryDetailRow\(database/u);
  assert.match(swRepository, /async readUserState[\s\S]*database\.batch\(\[/u);
});

test("performance scripts enforce client and payload budgets", () => {
  const bundle = source("scripts/analyze-bundle.mjs");
  const payloads = source("scripts/measure-scoped-payloads.mjs");
  assert.match(bundle, /rootCatalogInitialJsBudgetBytes/u);
  assert.match(bundle, /rootCatalogInitialJsBudgetBytes: 360_000/u);
  assert.match(bundle, /studyAppInitialJsBudgetBytes: 505_000/u);
  assert.match(bundle, /manifest\.json/u);
  assert.match(payloads, /payloadBudgets/u);
  assert.match(payloads, /budgetFailures/u);
  assert.doesNotMatch(payloads, /legacyFull|fullContentStatement|fullTheoryStatement/u);
  assert.doesNotMatch(payloads, /SELECT \* FROM (?:questions|theories) WHERE active = 1/u);
});
