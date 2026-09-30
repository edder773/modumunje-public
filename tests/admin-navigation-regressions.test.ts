import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SW_CURRICULUM_SUBJECT_GROUPS } from "../packages/shared/src/study/sw-curriculum-contract.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

test("every registered SW subject remains filterable beyond the first theory page", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "admin-navigation-test", configurable: true });
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  try {
    const { readSwTheoryAdminList, readSwQuestionList } = await import("../apps/backend/src/modules/admin/admin-read-use-cases");
    const subjects = SW_CURRICULUM_SUBJECT_GROUPS.flatMap(group => group.subjects);
    const firstPage = await readSwTheoryAdminList(new URL("https://example.test/api/admin?view=summary&pageSize=20&active=active"));
    assert.ok(new Set(firstPage.items.map(row => row.subjectId)).size < subjects.length);
    for (const group of SW_CURRICULUM_SUBJECT_GROUPS) {
      for (const subject of group.subjects) {
        const url = new URL(`https://example.test/api/admin?subjectGroupId=${group.id}&subjectId=${subject.id}&active=active&view=summary`);
        for (const read of [readSwTheoryAdminList, readSwQuestionList]) {
          const data = await read(url);
          assert.ok(data.pagination.total > 0, subject.name);
          assert.ok(data.items.every(row => row.subjectId === subject.id && row.subjectGroupId === group.id));
        }
      }
    }
    for (const name of ["question", "theory"]) {
      const source = readFileSync(`apps/frontend/src/features/admin/components/admin-${name}-sections.tsx`, "utf8");
      assert.match(source, /const groups = SW_CURRICULUM_SUBJECT_GROUPS[.]map/u);
      assert.match(source, /const subjects = SW_CURRICULUM_SUBJECT_GROUPS[.]filter/u);
    }
  } finally { database.close(); }
});

test("SW issue links select the exact question even when another prompt mentions its ID", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  try {
    const { readSwQuestionList } = await import("../apps/backend/src/modules/admin/admin-read-use-cases");
    const rows = database.prepare("SELECT id FROM sw_questions WHERE active = 1 ORDER BY display_order LIMIT 2").all();
    const id = String(rows[0].id);
    database.prepare("UPDATE sw_questions SET prompt = prompt || ? WHERE id = ?").run(`\n관련 문제: ${id}`, rows[1].id);
    const search = await readSwQuestionList(new URL(`https://example.test/api/admin?search=${encodeURIComponent(id)}`));
    assert.ok(search.pagination.total >= 2);
    const exact = await readSwQuestionList(new URL(`https://example.test/api/admin?id=${encodeURIComponent(id)}`));
    assert.equal(exact.pagination.total, 1);
    assert.deepEqual(exact.items.map(row => (row as Record<string, unknown>).id), [id]);
    for (const missing of [id.slice(0, -1), `${id}-missing`, "' OR 1=1 --"]) {
      const result = await readSwQuestionList(new URL(`https://example.test/api/admin?id=${encodeURIComponent(missing)}`));
      assert.equal(result.pagination.total, 0);
      assert.deepEqual(result.items, []);
    }
  } finally { database.close(); }
});
