import { APPROVED_RELEASE } from "./helpers/approved-release.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the optimizer role-boundary theory uses role-specific wording", () => {
  const database = openCanonicalTestDatabase(projectRoot);
  const theory = database.prepare(`
    SELECT title, summary, content, review_answers AS reviewAnswers
    FROM theories
    WHERE id = 921 AND exam_scope = 'SQLP'
  `).get();

  assert.ok(theory);
  assert.equal(theory.title, "옵티마이저의 한계와 역할 분담: 좋은 판단 조건 만들기");
  assert.match(theory.content, /## 4\. SQL 작성자의 역할/u);
  assert.match(theory.content, /SQL 작성자는 최소한 다음 사항을 확인할 수 있어야 합니다\./u);
  assert.match(theory.content, /SQL 작성자·DBA·튜너의 책임 범위/u);
  assert.equal(
    [theory.title, theory.summary, theory.content, theory.reviewAnswers]
      .some((value) => String(value).includes("개발자")),
    false,
  );
  const release = database.prepare(`
    SELECT version, status, theory_checksum AS theoryChecksum
    FROM content_releases
    WHERE status = 'active'
  `).get();
  assert.deepEqual({ ...release }, {
    version: APPROVED_RELEASE.version,
    status: "active",
    theoryChecksum: APPROVED_RELEASE.theorySha256,
  });
  database.close();
});
