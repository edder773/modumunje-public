import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

test("catalog and site-wide analytics avoid importing the full registry on the client", () => {
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/analyze-bundle.mjs"], { cwd: root, encoding: "utf8" }));
  assert.ok(report.rootCatalogInitialJsBytes <= 360_000);
  assert.ok(report.studyAppInitialJsBytes <= 505_000);
  assert.ok(report.rootCatalogStaticFiles.some(file => file.includes("page-view-tracker")));
  assert.ok(report.rootCatalogStaticFiles.every(file => !/course-contract|course-registry|learning-catalog|local-practice/u.test(file)));
  assert.match(source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx"), /from "\.\/catalog-search"/u);
  assert.doesNotMatch(source("apps/frontend/src/features/study/components/catalog/catalog-search.ts"), /^import (?!type)/mu);
});

test("compact analytics scopes retain every released course and enforce path boundaries", async () => {
  const { pageViewScope } = await tsImport("../apps/frontend/src/features/study/telemetry/page-view-scope.ts", import.meta.url);
  const { LEARNING_CATALOG } = await tsImport("../packages/shared/src/study/learning-catalog.ts", import.meta.url);
  const scopes = LEARNING_CATALOG.flatMap(field => [
    ...field.courses.map(course => ({ prefix: `/learn/${field.id}/${course.id}`, examScope: course.examType })),
    ...(field.analyticsScope ? [{ prefix: `/learn/${field.id}`, examScope: field.analyticsScope }] : []),
  ]);
  for (const scope of scopes) {
    assert.equal(pageViewScope(scope.prefix, scopes), scope.examScope);
    assert.equal(pageViewScope(`${scope.prefix}/practice`, scopes), scope.examScope);
    assert.equal(pageViewScope(`${scope.prefix}-unknown/practice`, scopes), undefined);
  }
  for (const pathname of ["/", "/about", "/privacy", "/login", "/admin"]) {
    assert.equal(pageViewScope(pathname, scopes), undefined);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(scopes)) < 1_024);
});

test("generated pure annotations preserve frozen registry values and schema rows", async () => {
  const registry = await import("../packages/shared/src/study/course-contract.mjs");
  for (const [name, value] of Object.entries(registry)) {
    if (!value || typeof value !== "object") continue;
    assert.equal(Object.isFrozen(value), true, name);
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") assert.equal(Object.isFrozen(nested), true, name);
    }
  }
  assert.match(source("packages/shared/src/study/course-contract.mjs"), /COURSE_SUBJECT_ROWS = \/\* @__PURE__ \*\/ deepFreeze/u);
});
