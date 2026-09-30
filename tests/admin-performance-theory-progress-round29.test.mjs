import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("admin navigation stays inside the authorized shell and recent reads are deduplicated", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const client = source("apps/frontend/src/features/admin/model/admin-api-client.ts");

  assert.match(ui, /const \[activeSection, setActiveSection\] = useState\(initialSection\)/u);
  assert.match(ui, /window\.history\.pushState\(\{\}, "", href\)/u);
  assert.match(ui, /window\.addEventListener\("popstate", handlePopState\)/u);
  assert.match(client, /ADMIN_GET_CACHE_TTL_MS = 15_000/u);
  assert.match(client, /adminGetCache\.get\(key\)/u);
  assert.match(client, /adminGetCache\.clear\(\)/u);
});

test("the compact schema baseline retains admin query indexes", () => {
  const baseline = source("apps/backend/drizzle/0554_schema_baseline.sql");

  for (const indexName of [
    "attempts_question_result_time_idx",
    "attempts_time_admin_question_idx",
    "user_bookmarks_question_idx",
    "ai_evaluations_question_idx",
    "analytics_events_theory_lookup_idx",
    "system_errors_question_type_idx",
    "system_errors_status_time_idx",
    "backup_snapshots_type_status_time_idx",
  ]) {
    assert.match(baseline, new RegExp(indexName, "u"));
  }
});

test("only unreferenced inactive questions can be permanently deleted", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");

  assert.match(api, /async function deleteInactiveQuestion/u);
  assert.match(api, /활성 문제는 영구 삭제할 수 없습니다/u);
  assert.match(api, /FROM attempts WHERE question_id = \?/u);
  assert.match(api, /FROM user_bookmarks WHERE question_id = \?/u);
  assert.match(api, /FROM ai_evaluations WHERE question_id = \?/u);
  assert.match(api, /json_each\(CASE WHEN json_valid\(es\.question_ids\)/u);
  assert.match(api, /DELETE FROM questions WHERE id = \? AND active = 0/u);
  assert.match(api, /action === "question-delete-inactive"/u);
  assert.match(ui, /문제 \$\{question\.id\} 삭제/u);
  assert.match(ui, />영구 삭제<\/button>/u);
});

test("theory reading has no completion state, controls or save queue", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  assert.doesNotMatch(study, /TheoryCompletionControl|saveTheoryProgress|theoryProgressSaveQueue|setSwTheoryCompletion/u);
  assert.doesNotMatch(source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx"), /이론 학습 상태 선택|학습 완료|미학습/u);
  assert.match(api, /THEORY_PROGRESS_RETIRED/u);
});
