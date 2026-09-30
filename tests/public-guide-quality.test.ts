import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { GUIDE_EXAMPLES } from "../apps/frontend/src/features/public-content/public-guide-examples";
import { PUBLIC_COURSE_GUIDES, guideTheoryPath } from "../apps/frontend/src/features/public-content/public-guide-data";
import { parseLearningPath } from "../packages/shared/src/study/learning-catalog";

test("published SQL example executes with preserved members and zero counts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const example = GUIDE_EXAMPLES.sqld!;
    const rows = db.prepare(example.code).all().map(row => [row.id, row.paid_count]);
    assert.deepEqual(rows, [[1, 1], [2, 0], [3, 0]]);
    assert.equal(example.result, "id | paid_count\n1  | 1\n2  | 0\n3  | 0");
    assert.deepEqual(db.prepare(example.code.replace("COUNT(o.id)", "COUNT(*)")).all().map(row => row.paid_count), [1, 1, 1]);
    const misplaced = example.code.replace("AND o.status = 'paid'", "WHERE o.status = 'paid'");
    assert.deepEqual(db.prepare(misplaced).all().map(row => row.id), [1]);
    const cancelledOnly = example.code.replace("(102, 1, 'cancelled')", "(102, 1, 'cancelled'), (103, 2, 'cancelled')");
    assert.deepEqual(db.prepare(cancelledOnly).all().map(row => row.paid_count), [1, 0, 0]);
  } finally { db.close(); }
});

for (const slug of ["big-data-analysis", "software-major"] as const) {
  test(`published ${slug} Python output matches executed example`, () => {
    const example = GUIDE_EXAMPLES[slug]!;
    const result = spawnSync("python3", ["-c", example.code], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), example.result);
  });
}

test("all supported guide theory links resolve to public theory routes", () => {
  for (const guide of Object.values(PUBLIC_COURSE_GUIDES)) {
    const href = guideTheoryPath(guide);
    if (["big-data-practical", "skct-personal"].includes(guide.slug)) { assert.equal(href, null); continue; }
    assert.ok(href);
    const route = parseLearningPath(href);
    assert.ok(route);
    assert.ok(route.page === "theories" || (route.page === "field" && route.section === "theories"), href);
  }
});

test("guides do not promise retired past papers or anonymous practical access", () => {
  assert.doesNotMatch(JSON.stringify(PUBLIC_COURSE_GUIDES["big-data-practical"]), /로그인이 필요하지 않/);
  assert.doesNotMatch(JSON.stringify(PUBLIC_COURSE_GUIDES["ipe-practical"]), /회차별 기출 연습|연도와 회차를 선택/);
});

test("public examples have provenance, reproducible output and limitations; no approval claims", () => {
  for (const example of Object.values(GUIDE_EXAMPLES)) {
    assert.equal(new URL(example.source.href).protocol, "https:");
    for (const value of [example.title, example.context, example.code, example.result, example.pitfall, example.next]) assert.ok(value.trim());
    assert.equal(example.steps.length, 4);
  }
  const about = readFileSync("apps/frontend/app/about/page.tsx", "utf8");
  assert.match(about, /ChatGPT/);
  assert.match(about, /전문가 검수나 시험 시행기관의 인증을 의미하지 않습니다/);
  const page = readFileSync("apps/frontend/app/guides/[course]/page.tsx", "utf8");
  assert.match(page, /id="worked-example"/);
  assert.match(page, /guideTheoryPath/);
  const home = readFileSync("apps/frontend/src/features/study/components/catalog/catalog-home.tsx", "utf8");
  for (const slug of Object.keys(GUIDE_EXAMPLES)) assert.ok(home.includes(`/guides/${slug}#worked-example`));
});
