import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const { AD_PLACEMENTS, AD_PRACTICE_COURSE_PATHS, isAdPlacementAllowed, isLocalAdPreview } = await tsImport(
  "../apps/frontend/src/features/advertising/ad-placement-policy.ts", import.meta.url,
);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function componentSources(relativeDirectory) {
  const directory = path.join(projectRoot, relativeDirectory);
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("AdSense preparation stays manual and bounds home, guide and practice placements", () => {
  const policy = source("apps/frontend/src/features/advertising/ad-placement-policy.ts");

  assert.match(policy, /mode: "manual-only"/u);
  assert.match(policy, /implementationStatus: "reserved-only"/u);
  assert.match(policy, /catalogFooter:[\s\S]*route: "\/"[\s\S]*format: "responsive-horizontal"/u);
  assert.match(policy, /minHeightPx: 100/u);
  assert.match(policy, /minInteractiveSeparationPx: 64/u);
  assert.match(policy, /AD_FREE_ROUTE_PREFIXES[\s\S]*"\/admin"[\s\S]*"\/api"/u);
  assert.match(policy, /AD_FREE_INTERACTION_SURFACES[\s\S]*"mock-exam-question"[\s\S]*"question-and-answer-controls"/u);
  assert.deepEqual(Object.keys(AD_PLACEMENTS), ["catalogFooter", "guideFooter", "guideSidebar", "practiceFooter"]);
  assert.equal(AD_PLACEMENTS.practiceFooter.minInteractiveSeparationPx, 96);
  assert.equal(AD_PLACEMENTS.guideSidebar.minViewportWidthPx, 1280);
  assert.equal(AD_PLACEMENTS.guideSidebar.minHeightPx, 250);
  for (const slot of Object.values(AD_PLACEMENTS)) assert.ok(slot.minInteractiveSeparationPx >= 64);
});

test("the reserved slot is non-rendering until publisher, consent, and delivery are implemented", () => {
  const component = source("apps/frontend/src/features/advertising/reserved-ad-slot.tsx");
  const rootLayout = source("apps/frontend/app/layout.tsx");

  assert.match(component, /data-ad-status=\{suppressed \? "suppressed" : AD_DELIVERY_POLICY\.implementationStatus\}/u);
  assert.match(component, /\shidden\s/u);
  assert.doesNotMatch(component + rootLayout, /adsbygoogle|pagead2|googlesyndication|<script/iu);
});

test("the home slot separates finished content from footer navigation and suppresses search states", () => {
  const catalog = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");
  const footerIndex = catalog.indexOf('className="catalog-footer-note"');
  const slotIndex = catalog.indexOf('<ReservedAdSlot placement="catalogFooter"');

  assert.ok(footerIndex >= 0);
  assert.ok(slotIndex > catalog.indexOf('className="catalog-guide-grid"'));
  assert.ok(slotIndex < footerIndex);
  assert.match(catalog, /suppressed=\{Boolean\(query\.trim\(\) \|\| fieldId \|\| authError\)\}/u);
  assert.doesNotMatch(catalog, /suppressed=\{requestedPath !== null\}/u);
});

test("placement allowlist excludes interactive, legal, index, unknown and nested routes", () => {
  assert.equal(isAdPlacementAllowed("catalogFooter", "/"), true);
  for (const placement of ["guideFooter", "guideSidebar"]) {
    for (const slug of ["sqld", "sqlp", "dap", "ipe-practical", "software-major"]) {
      assert.equal(isAdPlacementAllowed(placement, `/guides/${slug}`), true);
    }
  }
  for (const placement of Object.keys(AD_PLACEMENTS)) {
    for (const route of ["/privacy", "/about", "/guides", "/guides/not-a-course", "/guides/sqld/extra", "/learn/sql/sqlp/mock", "/admin", "/admin/questions", "/admin/analytics", "/api/study"]) {
      assert.equal(isAdPlacementAllowed(placement, route), false, `${placement}: ${route}`);
    }
  }
  assert.equal(isAdPlacementAllowed("catalogFooter", "/guides/sqld"), false);
  assert.equal(isAdPlacementAllowed("guideSidebar", "/"), false);
});

test("only registered ordinary practice routes allow a single footer, never mock exams", () => {
  for (const base of AD_PRACTICE_COURSE_PATHS) {
    for (const route of [`${base}/practice`, `${base}/questions/1`, `${base}/questions/88000001`]) {
      assert.equal(isAdPlacementAllowed("practiceFooter", route), true, route);
      for (const placement of ["catalogFooter", "guideFooter", "guideSidebar"]) {
        assert.equal(isAdPlacementAllowed(placement, route), false);
      }
    }
    for (const section of ["home", "theories", "records", "mock-exams", "mock-exams/active", "questions/0", "questions/01", "questions/1/extra"]) {
      assert.equal(isAdPlacementAllowed("practiceFooter", `${base}/${section}`), false);
    }
  }
  for (const section of ["type-1", "type-2", "type-3"]) {
    assert.equal(isAdPlacementAllowed("practiceFooter", `/learn/big-data-analysis/bae-practical/${section}`), true);
  }
  assert.equal(isAdPlacementAllowed("practiceFooter", "/learn/software-major/practice"), true);
  for (const route of ["/learn/software-major/mock-exams", "/learn/software-major/mock-exams/active", "/learn/software-major/home", "/learn/big-data-analysis/bae-practical/home", "/learn/sql/new-course/practice"]) {
    assert.equal(isAdPlacementAllowed("practiceFooter", route), false, route);
  }
});

test("preview opt-in is strictly local-development-only", () => {
  const local = { environment: "development", hostname: "127.0.0.1", search: "?ad_preview=1" };
  assert.equal(isLocalAdPreview(local), true);
  assert.equal(isLocalAdPreview({ ...local, hostname: "localhost" }), true);
  for (const environment of ["production", "test", undefined]) assert.equal(isLocalAdPreview({ ...local, environment }), false);
  for (const hostname of ["modumunje.com", "baeumzip.site", "localhost.example.com"]) assert.equal(isLocalAdPreview({ ...local, hostname }), false);
  for (const search of ["", "?ad_preview=0", "?preview=1"]) assert.equal(isLocalAdPreview({ ...local, search }), false);
});

test("guides reserve a non-sticky PC rail and a footer after the article, before actions", () => {
  const guide = source("apps/frontend/app/guides/[course]/page.tsx");
  const css = source("apps/frontend/src/features/advertising/ad-placement.css");
  assert.equal((guide.match(/<ReservedAdSlot /gu) ?? []).length, 2);
  assert.ok(guide.indexOf('placement="guideFooter"') > guide.indexOf('id="guide-closing-title"'));
  assert.ok(guide.indexOf('placement="guideFooter"') < guide.indexOf('className={styles.actions}'));
  assert.match(css, /@media \(min-width: 1280px\)/u);
  assert.match(css, /column-gap: 64px/u);
  assert.doesNotMatch(css, /position:\s*(?:sticky|fixed)|z-index/iu);
  const component = source("apps/frontend/src/features/advertising/reserved-ad-slot.tsx");
  assert.doesNotMatch(component, /adsbygoogle|pagead2|googlesyndication|<script|<iframe|fetch\(/iu);
  for (const route of ["guides/page.tsx", "about/page.tsx", "privacy/page.tsx"]) {
    assert.doesNotMatch(source(`apps/frontend/app/${route}`), /ReservedAdSlot/u);
  }
});

test("practice footers have explicit consumers; mock exams, setup and admin remain ad-free", () => {
  const componentRoot = "apps/frontend/src/features/study/components";
  const consumers = componentSources(componentRoot)
    .filter((file) => /ReservedAdSlot/u.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(path.join(projectRoot, componentRoot), file));

  assert.deepEqual(consumers.sort(), [
    "catalog/catalog-home.tsx", "local-practice/type2-workbook.tsx", "local-practice/type3-workbook.tsx",
    "local-practice/workbook.tsx", "sql/practice/practice-screen.tsx", "sw-question-runners.tsx",
  ].map(file => path.normalize(file)).sort());
  const practice = source(`${componentRoot}/sql/practice/practice-screen.tsx`);
  assert.match(practice, /!bookmarkMode && <ReservedAdSlot placement="practiceFooter" suppressed=\{props.adSuppressed\}/u);
  assert.ok(practice.indexOf('placement="practiceFooter"') > practice.lastIndexOf('className="quiz-side"'));
  const runners = source(`${componentRoot}/sw-question-runners.tsx`);
  assert.doesNotMatch(runners.slice(runners.indexOf("export function SwMockRunner"), runners.indexOf("export function SwPracticeRunner")), /ReservedAdSlot/u);
  assert.equal((runners.match(/<ReservedAdSlot /gu) ?? []).length, 1);
  const css = source("apps/frontend/src/features/advertising/ad-placement.css");
  assert.match(css, /\.quiz-layout > \.ad-placement-preview\[data-ad-placement="practice-footer"\]\s*\{\s*grid-column: 1 \/ -1;/u);
  for (const file of componentSources("apps/frontend/src/features/admin")) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /ReservedAdSlot/u, file);
  }
});
