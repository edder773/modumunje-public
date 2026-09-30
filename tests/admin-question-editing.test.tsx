import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAdminAnswerNumbers, validateAdminAnswerIndices } from "../packages/shared/src/admin/question-answer-input";
import { AdminQuestionOptionsGate, loadAdminQuestionOptions } from "../apps/frontend/src/features/admin/components/admin-question-options-gate";
import { apiAction, invalidateAdminGetCache } from "../apps/frontend/src/features/admin/model/admin-api-client";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

test("answer entry accepts separators without discarding invalid numbers or silently choosing a single answer", () => {
  assert.deepEqual(parseAdminAnswerNumbers(" 1, \n", 4, "single"), [0]);
  assert.deepEqual(parseAdminAnswerNumbers("１， ３  \n４,", 4, "multiple"), [0, 2, 3]);
  assert.deepEqual(parseAdminAnswerNumbers("2", 2, "single"), [1]);
  for (const input of ["", " , ", "0", "5", "1, typo", "1, -2", "1.5", "1e0", "1, 1", "9007199254740993"]) {
    assert.throws(() => parseAdminAnswerNumbers(input, 4, "multiple"), /정답 번호/u, input);
  }
  assert.throws(() => parseAdminAnswerNumbers("1, 2", 4, "single"), /하나만/u);
  for (const input of [[0, "1"], [0, null], [0, -1], [0, 0], [0, 1.5], [NaN], {}, null]) {
    assert.throws(() => validateAdminAnswerIndices(input, 4, "multiple"));
  }
  assert.deepEqual(parseAdminAnswerNumbers("이전 객관식 입력", 0, "descriptive"), []);
});

test("both question save paths reject invalid answers before changing a stored question", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "admin-question-editing-test", configurable: true });
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  try {
    const { updateQuestion } = await import("../apps/backend/src/modules/admin/admin-content-commands");
    const { updateSwQuestion } = await import("../apps/backend/src/modules/admin/admin-export-use-cases");
    for (const [table, save] of [["questions", updateQuestion], ["sw_questions", updateSwQuestion]] as const) {
      const row = database.prepare(`SELECT * FROM ${table} WHERE active = 1 AND kind = 'single' AND json_array_length(choices) = 4 LIMIT 1`).get()!;
      const payload = {
        ...row, examScope: row.exam_scope, theoryId: row.theory_id,
        choices: JSON.parse(String(row.choices)), correctAnswers: JSON.parse(String(row.correct_answers)),
        requiredConcepts: JSON.parse(String(row.required_concepts)),
      };
      for (const answers of [[0, 1], [0, "invalid"], [0, -1], [4], [0, 0], [], "[0, \"invalid\"]"]) {
        await assert.rejects(save({ ...payload, correctAnswers: answers }), /정답 번호/u);
        assert.deepEqual(database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id), row);
      }
      await save({ ...payload, correctAnswers: parseAdminAnswerNumbers("2, ", 4, "single") });
      assert.equal(database.prepare(`SELECT correct_answers FROM ${table} WHERE id = ?`).get(row.id)!.correct_answers, "[1]");
      await save({ ...payload, kind: "multiple", correctAnswers: parseAdminAnswerNumbers("1, 3,", 4, "multiple") });
      assert.equal(database.prepare(`SELECT correct_answers FROM ${table} WHERE id = ?`).get(row.id)!.correct_answers, "[0,2]");
    }
  } finally { database.close(); }
});

test("editor options surface request failures, reject malformed cached data and recover on retry", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const resource of ["options", "sw-options"] as const) {
      invalidateAdminGetCache();
      globalThis.fetch = async () => Response.json({ error: "연결 오류" }, { status: 503 });
      await assert.rejects(loadAdminQuestionOptions(resource), /연결 오류/u);
      for (const invalid of [{}, { theories: [{}] }, { theories: "invalid" }, { theories: [{ id: -1 }] }]) {
        globalThis.fetch = async () => Response.json(invalid);
        await assert.rejects(loadAdminQuestionOptions(resource), /이론·분류 정보를 불러오지 못했습니다/u);
      }
      const valid = { theories: [], ...(resource === "options" ? { categories: [] } : {}) };
      globalThis.fetch = async () => Response.json(valid);
      assert.deepEqual(await loadAdminQuestionOptions(resource), valid);
    }
  } finally { globalThis.fetch = originalFetch; invalidateAdminGetCache(); }
});

test("opening an editor after an admin save reloads real theory options instead of retaining the old list", async () => {
  const originalFetch = globalThis.fetch;
  const database = openCanonicalTestDatabase(process.cwd());
  try {
    for (const resource of ["options", "sw-options"] as const) {
      invalidateAdminGetCache();
      const theories = database.prepare(resource === "options"
        ? "SELECT id, title, category, topic, exam_scope FROM theories WHERE active = 1 ORDER BY id"
        : "SELECT id, title, category, topic, subject_group_id, subject_id FROM sw_theories WHERE active = 1 ORDER BY id").all();
      const categories = database.prepare("SELECT category, topic, COUNT(*) AS questions FROM questions GROUP BY category, topic").all();
      let calls = 0;
      let title = String(theories[0].title);
      globalThis.fetch = async (input, init) => {
        if (init?.method === "POST") return Response.json({ ok: true });
        assert.equal(new URL(String(input), "https://example.test").searchParams.get("resource"), resource);
        calls += 1;
        return Response.json({ theories: [{ ...theories[0], title }, ...theories.slice(1)], ...(resource === "options" ? { categories } : {}) });
      };
      const first = await loadAdminQuestionOptions<{ theories: Array<{ title: string }> }>(resource);
      assert.equal(first.theories.length, theories.length);
      await loadAdminQuestionOptions(resource);
      assert.equal(calls, 1);
      title = "수정된 이론 제목";
      await apiAction(resource === "options" ? "theory-update" : "sw-theory-update", { id: theories[0].id, title });
      const refreshed = await loadAdminQuestionOptions<{ theories: Array<{ title: string }> }>(resource);
      assert.equal(refreshed.theories[0].title, title);
      assert.equal(calls, 2);
    }
  } finally { database.close(); globalThis.fetch = originalFetch; invalidateAdminGetCache(); }
});

test("a question form is not initialized before its theory and category options are available", () => {
  for (const resource of ["options", "sw-options"] as const) {
    let formMounted = false;
    const html = renderToStaticMarkup(<AdminQuestionOptionsGate resource={resource} onClose={() => undefined}>
      {() => { formMounted = true; return <form>저장</form>; }}
    </AdminQuestionOptionsGate>);
    assert.equal(formMounted, false);
    assert.match(html, /이론·분류 정보를 불러오는 중입니다/u);
    assert.match(html, /role="dialog"/u);
    assert.doesNotMatch(html, /<form/u);
  }
});
