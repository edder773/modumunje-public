import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("public certification guides cover registered subjects (not an AdSense approval check)", () => {
  const links = source("apps/frontend/src/features/public-content/public-guide-links.ts");
  const data = source("apps/frontend/src/features/public-content/public-guide-data.ts");
  const registry = JSON.parse(source("packages/shared/src/study/course-registry.source.json"));

  for (const slug of ["sqld", "sqlp", "dasp", "dap", "big-data-analysis"]) {
    assert.match(links, new RegExp(`slug: "${slug}"`, "u"));
    assert.match(data, new RegExp(`^  (?:"${slug}"|${slug}): \\{`, "mu"));
  }
  const guideSlugs = [...links.matchAll(/slug: "([^"]+)"/gu)].map((match) => match[1]);
  for (const course of registry.courses.filter((course) => guideSlugs.includes(course.courseId))) {
    for (const subjectId of course.releasedSubjectIds ?? course.subjectIds) {
      assert.match(data, new RegExp(`"${subjectId}": \\{`, "u"));
    }
  }
  assert.match(data, /오답 원인을 규칙으로 남기기/u);
  assert.match(data, /실기형 답안을 구조화하기/u);
});

test("guide routes provide canonical metadata, static paths, and official-source boundaries", () => {
  const index = source("apps/frontend/app/guides/page.tsx");
  const detail = source("apps/frontend/app/guides/[course]/page.tsx");
  const about = source("apps/frontend/app/about/page.tsx");

  assert.match(index, /alternates: \{ canonical: "\/guides" \}/u);
  assert.match(detail, /generateStaticParams/u);
  assert.match(detail, /alternates: \{ canonical: `\/guides\/\$\{slug\}` \}/u);
  assert.match(index + detail, /https:\/\/www\.dataq\.or\.kr\/www\/main\.do/u);
  assert.match(about, /모두의 문제집은 시험 시행기관이 아닙니다/u);
  assert.match(about, /현재 모두의 문제집에는 Google AdSense 광고가 활성화되어 있지 않습니다/u);
});

test("the public catalog links to every guide without placing them behind the login handler", () => {
  const catalog = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");

  assert.match(catalog, /PUBLIC_GUIDE_LINKS\.map/u);
  assert.match(catalog, /href=\{`\/guides\/\$\{guide\.slug\}`\}/u);
  assert.match(catalog, /className="catalog-guide-link"/u);
  assert.doesNotMatch(catalog, /정보처리기사와 리눅스마스터 학습 과정을 준비하고 있습니다/u);
});

test("the sitemap indexes all public trust and guide pages while learning stays private", () => {
  const sitemap = source("apps/frontend/app/sitemap.ts");
  const robots = source("apps/frontend/app/robots.ts");

  assert.match(sitemap, /PUBLIC_GUIDE_LINKS\.map/u);
  for (const route of ["/guides", "/about", "/privacy"]) {
    assert.match(sitemap, new RegExp(route.replace("/", "\\/"), "u"));
  }
  assert.doesNotMatch(robots, /"\/learn\/"/u);
  assert.doesNotMatch(robots, /"\/guides\/"|"\/about"|"\/privacy"/u);
});

test("privacy disclosure covers future advertising without claiming that ads are active", () => {
  const privacy = source("apps/frontend/app/privacy/page.tsx");

  assert.match(privacy, /현재 모두의 문제집에는 Google AdSense 광고가 활성화되어 있지 않습니다/u);
  assert.match(privacy, /제3자 광고 사업자/u);
  assert.match(privacy, /쿠키, 웹 비콘, IP 주소/u);
  assert.match(privacy, /policies\.google\.com\/technologies\/partner-sites/u);
  assert.match(privacy, /adssettings\.google\.com/u);
});

test("AdSense ownership verification keeps content and disclosures free of ad delivery code", () => {
  const files = [
    "apps/frontend/app/guides/page.tsx",
    "apps/frontend/app/guides/[course]/page.tsx",
    "apps/frontend/app/about/page.tsx",
    "apps/frontend/app/privacy/page.tsx",
    "apps/frontend/app/layout.tsx",
  ];
  const combined = files.map(source).join("\n");
  const ownershipMeta = '<meta name="google-adsense-account" content="ca-pub-4499860671643104" />';
  const layout = source("apps/frontend/app/layout.tsx");
  assert.ok(layout.includes(ownershipMeta), "the approved account must be verified in the root head");
  assert.match(layout, /<head>[\s\S]*<meta name="google-adsense-account"[\s\S]*<\/head>/u);
  assert.equal((combined.match(/google-adsense-account/gu) ?? []).length, 1);
  assert.doesNotMatch(combined.replace(ownershipMeta, ""), /adsbygoogle|pagead2|googlesyndication|ca-pub-/iu);
});
