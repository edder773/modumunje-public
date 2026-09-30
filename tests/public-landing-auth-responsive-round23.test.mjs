import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("public root opens guest learning and keeps a compact sign-in path", () => {
  const page = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(pageSession, /displayName: "비로그인 학습"/u);
  assert.match(pageSession, /userKey: "guest-browser"/u);
  assert.match(pageSession, /signInPath: siteSignInPath\(initialPath\)/u);
  assert.match(page, /session\.status === "guest"/u);
  assert.match(study, /className="top-login-link"[\s\S]*로그인/u);
  assert.doesNotMatch(study, /지금은 로그인 없이 바로 학습할 수 있습니다/u);
  assert.doesNotMatch(study, /북마크와 객관식 풀이 기록은 이 브라우저에 저장/u);
  assert.doesNotMatch(page, /Google 계정을 선택해 주세요|Google 계정으로 로그인|구글 로그인 전용/u);
});

test("canonical metadata uses the representative domain and Korean search metadata", () => {
  const layout = source("apps/frontend/app/layout.tsx");
  const home = source("apps/frontend/app/page.tsx");
  const adminLayout = source("apps/frontend/app/admin/layout.tsx");

  assert.match(layout, /metadataBase:\s*new URL\("https:\/\/modumunje\.com"\)/u);
  assert.match(layout, /모두의 문제집 \| 자격증·전공 학습 플랫폼/u);
  assert.match(home, /canonical:\s*"\/"/u);
  assert.doesNotMatch(layout, /canonical:/u);
  assert.match(layout, /locale:\s*"ko_KR"/u);
  assert.match(layout, /<html lang="ko">/u);
  assert.match(home, /type="application\/ld\+json"/u);
  assert.match(home, /"@type": "WebSite"/u);
  assert.match(home, /url: "https:\/\/modumunje\.com\/"/u);
  assert.match(home, /name: "모두의 문제집"/u);
  assert.match(home, /alternateName: \["모두의문제집", "모두의 문제집 자격증 학습"\]/u);
  assert.match(adminLayout, /index:\s*false/u);
  assert.match(adminLayout, /follow:\s*false/u);
});

test("canonical host proxy preserves paths and applies safe response headers", () => {
  const proxy = source("proxy.ts");

  assert.match(proxy, /const CANONICAL_HOST = "modumunje\.com"/u);
  assert.match(proxy, /"www\.modumunje\.com"/u);
  assert.match(proxy, /"www\.baeumzip\.site"/u);
  assert.match(proxy, /"baeumzip\.site"/u);
  assert.match(proxy, /"sqlp-study-lab\.edder773\.chatgpt\.site"/u);
  assert.match(proxy, /const destination = request\.nextUrl\.clone\(\)/u);
  assert.match(proxy, /NextResponse\.redirect\(destination, 308\)/u);
  assert.match(proxy, /X-Content-Type-Options/u);
  assert.match(proxy, /Referrer-Policy/u);
  assert.match(proxy, /Strict-Transport-Security/u);
});

test("compact login and learning controls avoid fixed-width overflow", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.doesNotMatch(styles, /\.guest-login-card\s*\{/u);
  assert.match(styles, /\.quiz-map > strong\s*\{[\s\S]*word-break:\s*keep-all/u);
  assert.match(styles, /\.top-login-link\s*\{/u);
});

test("learner and admin dialogs trap focus, close with Escape, and restore focus", () => {
  for (const file of ["apps/frontend/src/features/study/components/modal.tsx", "apps/frontend/src/features/admin/components/admin-ui.tsx"]) {
    const component = source(file);
    assert.match(component, /event\.key === "Escape"/u);
    assert.match(component, /event\.key !== "Tab"/u);
    assert.match(component, /previousFocus\?\.focus\(\)/u);
    assert.match(component, /aria-labelledby=\{titleId\}/u);
    assert.match(component, /tabIndex=\{-1\}/u);
  }
});
