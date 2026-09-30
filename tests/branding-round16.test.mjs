import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("approved workbook artwork is delivered as compact square PNG assets", () => {
  for (const [file, size, budget] of [
    ["brand/modu-workbook.png", 192, 20000],
    ["favicon.png", 96, 10000],
  ]) {
    const png = readFileSync(new URL(`../apps/frontend/public/${file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
    assert.equal(png.readUInt32BE(16), size, file);
    assert.equal(png.readUInt32BE(20), size, file);
    assert.ok(png.length <= budget, `${file}: ${png.length} bytes exceeds ${budget}`);
  }
});

test("social previews use the versioned approved service card and retain a compatible fallback", () => {
  const manifest = JSON.parse(source("assets/brand/modu-social-preview-v2.manifest.json"));
  const social = readFileSync(new URL("../apps/frontend/public/brand/modu-social-preview-v2.jpg", import.meta.url));
  const fallback = readFileSync(new URL("../apps/frontend/public/og.jpg", import.meta.url));
  const layout = source("apps/frontend/app/layout.tsx");
  const guide = source("apps/frontend/app/guides/[course]/page.tsx");

  assert.equal(social.subarray(0, 2).toString("hex"), "ffd8");
  assert.ok(social.length <= 500 * 1024, `${social.length} bytes exceeds the social image budget`);
  assert.deepEqual(fallback, social);
  assert.equal(manifest.brand, "모두의 문제집");
  assert.deepEqual(manifest.dimensions, { width: 1730, height: 909 });
  assert.equal(manifest.publicPath, "/brand/modu-social-preview-v2.jpg");
  assert.equal(manifest.sha256, "3be25d9c22891bf625137f226646fb9de57e06663cf8e9a52b16a63291d4abae");
  assert.match(layout, /url: "\/brand\/modu-social-preview-v2\.jpg"/u);
  assert.match(layout, /alt: "모두의 문제집 문제 풀이·오답 복습·모의시험 학습 플랫폼"/u);
  assert.doesNotMatch(layout, /배움집/u);
  assert.match(guide, /images: \["\/brand\/modu-social-preview-v2\.jpg"\]/u);
  assert.match(guide, /alt: "모두의 문제집 문제 풀이·오답 복습·모의시험 학습 플랫폼"/u);
});

test("learner, login, public content and administrator branding use the approved artwork", () => {
  for (const file of [
    "apps/frontend/app/styles/global-foundation.css",
    "apps/frontend/app/styles/account-learning.css",
    "apps/frontend/src/features/public-content/public-content.module.css",
    "apps/frontend/app/admin/admin.css",
  ]) {
    const css = source(file);
    assert.match(css, /url\("\/brand\/modu-workbook\.png"\)/u, file);
    assert.doesNotMatch(css, /modu-workbook\.svg/u, file);
  }
  assert.match(source("apps/frontend/app/admin/admin.css"), /background: #fffdf8 url\("\/brand\/modu-workbook\.png"\)/u);
  assert.match(source("apps/frontend/app/layout.tsx"), /<link rel="icon" href="\/favicon\.png" type="image\/png" sizes="96x96"/u);
  assert.match(source("apps/frontend/src/features/study/components/catalog/catalog-page-shell.tsx"), /className="catalog-brand"><span className="brand-mark" aria-hidden="true"/u);
});

test("learner-facing branding uses the Korean service name while exam labels remain explicit", () => {
  const layout = source("apps/frontend/app/layout.tsx");
  const login = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const registry = source("packages/shared/src/study/course-contract.mjs");

  assert.match(layout, /title:\s*"모두의 문제집 \| 자격증·전공 학습 플랫폼"/);
  assert.match(layout, /SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT를 이론/);
  assert.match(pageSession, /displayName: "비로그인 학습"/);
  assert.match(login, /session\.status === "guest"/);
  assert.match(login, /isAuthenticated=\{false\}/);
  assert.match(study, /<strong>모두의 문제집<\/strong>/);
  assert.match(study, /학습 분야 탐색/);
  assert.match(study, /\$\{selectedField\.name\} 과정 선택/);
  assert.match(catalog, /brandSubtitleLines\?: readonly \[string, string\]/);
  assert.match(registry, /"brandSubtitleLines":\s*\[\s*"데이터 아키텍처",\s*"자격 학습"\s*\]/);
  assert.match(study, /selectedField\.brandSubtitleLines/);
  assert.match(study, /className=\{brandSubtitleLines \? "brand-subtitle-stacked"/);
  assert.match(study, /<br \/>/);
  assert.match(study, /whiteSpace: "nowrap"/);
  assert.match(registry, /"cardTitle":\s*"SQL 자격증"/);
  assert.match(study, /className="top-login-link"[\s\S]*로그인/);
  assert.doesNotMatch(study, /OpenAI 계정으로 로그인/);
});

test("administrator-facing branding uses the Korean service name", () => {
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const access = source("apps/frontend/src/features/auth/login-notice.tsx");
  const packageJson = JSON.parse(source("package.json"));

  assert.match(admin, /<strong>모두의 문제집<small>ADMIN CONSOLE<\/small><\/strong>/);
  assert.match(admin, />모두의 문제집 관리자</);
  assert.match(access, /관리자 페이지는 로그인 후 이용할 수 있습니다/);
  assert.equal(packageJson.displayName, "모두의 문제집");
});

test("obsolete service names are absent from visible application sources", () => {
  const visibleSources = [
    source("apps/frontend/app/layout.tsx"),
    source("apps/frontend/app/page.tsx"),
    source("apps/frontend/src/features/study/components/study-app.tsx"),
    source("apps/frontend/src/features/admin/components/admin-app.tsx"),
    source("apps/frontend/src/features/admin/pages/admin-page.tsx"),
  ].join("\n");

  assert.doesNotMatch(visibleSources, /SQLD·SQLP Study Lab|SQLP Study Lab|SQL STUDY LAB/);
  assert.doesNotMatch(visibleSources, />BAEUMZIP</);
});
