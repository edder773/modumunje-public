import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function assertStableVersionWithin(value, minimum, nextMajor) {
  const parse = (version) => {
    const match = /^(\d+)[.](\d+)[.](\d+)/u.exec(version);
    assert.ok(match, `유효한 고정 버전이 필요합니다: ${version}`);
    return match.slice(1).map(Number);
  };
  const compare = (left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };
  const current = parse(value);
  assert.ok(compare(current, parse(minimum)) >= 0, `${value}은 보안 기준 ${minimum} 이상이어야 합니다.`);
  assert.ok(compare(current, parse(nextMajor)) < 0, `${value}은 검토되지 않은 메이저 범위를 벗어났습니다.`);
}

test("study reads require an explicit allow-listed scope and no longer expose a full payload", async () => {
  const [service, scopes] = await Promise.all([
    read("apps/backend/src/modules/study/study.service.ts"),
    read("apps/backend/src/modules/study/study-read-scope.ts"),
  ]);
  assert.match(service, /parseStudyReadScope\(requestedScope\)/u);
  assert.match(service, /학습 데이터 범위\(scope\)가 필요합니다/u);
  assert.doesNotMatch(service, /readPublicLearningData|readAll\(/u);
  assert.doesNotMatch(scopes, /["']full["']/u);
});

test("scoped frontend responses replace legitimate empty arrays and cancel stale requests", async () => {
  const [app, client, transport] = await Promise.all([
    read("apps/frontend/src/features/study/components/study-app.tsx"),
    read("apps/frontend/src/features/study/model/study-api-client.ts"),
    read("apps/frontend/src/shared/api/request-json.ts"),
  ]);
  assert.match(app, /payload\.attempts !== undefined \? payload\.attempts : previous\.attempts/u);
  assert.match(app, /studyRequestCoordinator\.begin\(scope\)/u);
  assert.match(app, /if \(!request\.isCurrent\(\)\)/u);
  assert.match(transport, /AbortSignal\.any/u);
  assert.match(transport, /DEFAULT_TOTAL_BUDGET_MS = 5_000/u);
  assert.match(transport, /DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000/u);
  assert.match(transport, /SLOW_REQUEST_NOTICE_MS = 2_000/u);
  assert.match(client, /requestJson/u);
  assert.doesNotMatch(client, /["']full["']/u);
});

test("SW curriculum is componentized with collapse controls limited to mobile", async () => {
  const [app, planner, content, component, css] = await Promise.all([
    read("apps/frontend/src/features/study/components/study-app.tsx"),
    read("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx"),
    read("apps/frontend/src/features/study/components/sw-curriculum-content.tsx"),
    read("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx"),
    read("apps/frontend/src/features/study/components/sw-curriculum.css"),
  ]);
  assert.match(app, /<LearningFieldHome/u);
  const mobileBreakpoint = css.indexOf("@media (max-width: 680px)");
  assert.match(await read("apps/frontend/src/features/study/components/study-lazy-screens.ts"), /LearningFieldHome = lazy\(\(\) => import\("\.\/learning-field-home"\)\)/u);
  assert.match(planner, /<SwCurriculumContent/u);
  assert.match(content, /<LazySwCurriculumSelection/u);
  assert.match(component, /className="outline-button sw-mobile-group-toggle"/u);
  assert.match(component, /aria-expanded=\{!mobileCollapsed\}/u);
  assert.match(component, /aria-label=\{`\$\{recommendation\.name\} \$\{action\}`\}/u);
  assert.ok(mobileBreakpoint > 0);
  assert.match(css.slice(0, mobileBreakpoint), /\.sw-mobile-group-toggle\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(css.slice(0, mobileBreakpoint), /data-mobile-collapsed/u);
  assert.match(css.slice(mobileBreakpoint), /data-mobile-collapsed="true"[\s\S]*display:\s*none/u);
});

test("security, caching, event limits, and patched runtime dependencies stay enabled", async () => {
  const [proxy, responseCache, events, packageJson] = await Promise.all([
    read("proxy.ts"),
    read("apps/backend/src/modules/study/study-response-cache.ts"),
    read("apps/backend/src/modules/events/events.service.ts"),
    read("package.json").then(JSON.parse),
  ]);
  assert.match(proxy, /default-src 'self'/u);
  assert.match(responseCache, /candidate\.trim\(\)\.replace\(\/\^W\\\//u);
  assert.match(responseCache, /status: 304/u);
  assert.match(events, /EVENT_BODY_MAX_BYTES = 16 \* 1024/u);
  assert.match(events, /EVENT_RATE_LIMIT = 120/u);
  assertStableVersionWithin(packageJson.dependencies.next, "16.2.11", "17.0.0");
  assertStableVersionWithin(packageJson.dependencies.react, "19.2.8", "20.0.0");
  assert.equal(packageJson.devDependencies["@vitejs/plugin-rsc"], "0.5.34");
  assert.equal(packageJson.devDependencies.vinext, "1.0.0-beta.9");
  assertStableVersionWithin(packageJson.devDependencies.vite, "8.0.16", "9.0.0");
});
