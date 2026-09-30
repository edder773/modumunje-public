import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("dashboard uses a dedicated mobile layout without fixed-width cards", () => {
  const component = readFeatureSource(path.join(projectRoot, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8");
  const styles = readFeatureSource(path.join(projectRoot, "apps/frontend/app/globals.css"), "utf8");
  const dashboard = component.match(/function Dashboard[\s\S]*?function contentScale/)?.[0] ?? "";

  assert.match(component, /className="page-stack dashboard-home learning-entry-page"/);
  assert.match(styles, /\.entry-hero\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.course-choice\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.learning-action-grid \.topic-card\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.dashboard-home \.dashboard-primary-action\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/);
  assert.doesNotMatch(dashboard, /code-note|study_mode\.sql/);
  assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*?\.entry-hero\s*\{[\s\S]*?padding:\s*22px 18px/);
  assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*?\.course-choice-grid,[\s\S]*?\.learning-action-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
