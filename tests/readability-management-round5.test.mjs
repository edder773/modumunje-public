import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("dense numbered explanations become separate paragraphs without changing code spacing", () => {
  const normalized = normalizeMarkdownProse([
    "## 상세 해설① 첫 번째 설명입니다. ② 두 번째 설명입니다.③ 세 번째 설명입니다.",
    "",
    "## 오답 판단 포인트",
    "",
    "    - 첫 번째 점검",
    "    - 두 번째 점검",
    "        - 하위 점검",
    "",
    "```sql",
    "  SELECT *",
    "  FROM EMP",
    "```",
  ].join("\n"));

  assert.match(normalized, /^## 상세 해설\n\n① 첫 번째 설명입니다\.\n\n② 두 번째 설명입니다\.\n\n③ 세 번째 설명입니다\./m);
  assert.match(normalized, /## 오답 판단 포인트\n\n- 첫 번째 점검\n- 두 번째 점검\n    - 하위 점검/);
  assert.match(normalized, /```sql\n  SELECT \*\n  FROM EMP\n```/);
});

test("explanation checkpoints share the prose baseline and numbered choices keep paragraph breaks", () => {
  const normalized = normalizeExplanationMarkdown([
    "## 상세 해설",
    "",
    "① 첫 번째 선택지입니다.",
    "② 두 번째 선택지입니다.",
    "③ 세 번째 선택지입니다.",
    "",
    "## 오답 판단 포인트",
    "",
    "- 첫 번째 확인 사항",
    "- 두 번째 확인 사항",
    "",
    "```plan",
    "  | Id | Operation |",
    "  |  1 | TABLE ACCESS |",
    "```",
  ].join("\n"));

  assert.match(normalized, /① 첫 번째 선택지입니다\.\n\n② 두 번째 선택지입니다\.\n\n③ 세 번째 선택지입니다\./);
  assert.match(normalized, /## 오답 판단 포인트\n\n첫 번째 확인 사항\n\n두 번째 확인 사항/);
  assert.doesNotMatch(normalized, /- 첫 번째 확인 사항/);
  assert.match(normalized, /```plan\n  \| Id \| Operation \|\n  \|  1 \| TABLE ACCESS \|\n```/);
});

test("repeated answer headers from legacy objective imports are collapsed at delivery", () => {
  const normalized = normalizeExplanationMarkdown([
    "## 정답",
    "",
    "① 잔차는 +7분이다.",
    "",
    "## 상세 해설",
    "",
    "## 정답",
    "",
    "① 잔차는 +7분이다.",
    "",
    "## 상세 해설",
    "",
    "실제값에서 예측값을 빼면 +7분이다.",
    "",
    "## 선택지별 해설",
    "",
    "- ① 정답이다.",
  ].join("\n"));

  assert.equal(normalized.match(/^## 정답$/gmu)?.length, 1);
  assert.equal(normalized.match(/^## 상세 해설$/gmu)?.length, 1);
  assert.match(normalized, /## 상세 해설\n\n실제값에서 예측값을 빼면 \+7분이다\./u);
});

test("dashboard omits ambiguous progress metrics and keeps a compact single hero", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");
  const dashboard = component.match(/function Dashboard[\s\S]*?function TopicCard/)?.[0] ?? "";

  assert.doesNotMatch(dashboard, /MetricCard|학습 진도|정답률|progress-row/);
  assert.doesNotMatch(dashboard, /code-note|questions\.length|문항 보유/);
  assert.match(styles, /\.dashboard-home \.hero-grid\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.dashboard-home \.hero-card\s*{[\s\S]*?min-height:\s*0/);
  assert.match(styles, /\.dashboard-home \.hero-copy\s*{[\s\S]*?grid-template-columns:/);
});

test("theory and explanation prose use one left edge while ordinary paragraphs reflow", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.match(styles, /\.markdown-body p\s*{\s*white-space:\s*normal/);
  assert.match(styles, /\.theory-content,\s*\.theory-modal-content\s*{[\s\S]*?margin:\s*32px 0 36px[\s\S]*?text-align:\s*left/);
  assert.match(styles, /\.question-detail-explanation \.markdown-body ol[\s\S]*?padding-left:\s*1\.15em/);
});

test("edit, delete, export, and import are unavailable at both UI and API layers", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const navigation = component.match(/export const navItems[\s\S]*?export function courseNavItems/)?.[0] ?? "";

  assert.doesNotMatch(component, /function BackupPanel|백업 · 복원|문제 수정|이론 수정/);
  assert.doesNotMatch(navigation, /SQL 콘텐츠 등록|id:\s*"manage"/);
  assert.doesNotMatch(component, /aria-label="콘텐츠 관리"/);
  assert.match(api, /function PATCH\(\)[\s\S]*status:\s*403/);
  assert.match(api, /function DELETE\(\)[\s\S]*status:\s*403/);
  assert.match(api, /url\.searchParams\.get\("export"\) === "1"[\s\S]*status:\s*410/);
  assert.match(api, /if \(action === "import"\)[\s\S]*status:\s*410/);
  assert.doesNotMatch(api, /function importBackup/);
});
