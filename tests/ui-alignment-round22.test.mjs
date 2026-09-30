import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("continuous practice heading stays on one line without enlarging the side card", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.match(
    styles,
    /\.continuous-quiz-map > strong\s*\{[\s\S]*font-size:\s*18px;[\s\S]*white-space:\s*nowrap;/u,
  );
});

test("admin log and report filters use explicit horizontal control groups", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx")
    + source("apps/frontend/src/features/admin/components/admin-logs-section.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(ui, /className="admin-log-search"[\s\S]*htmlFor="admin-log-query"[\s\S]*type="submit">검색/u);
  assert.match(ui, /className="report-status-field"[\s\S]*className="report-search-field"/u);
  assert.match(
    styles,
    /\.admin-log-search > div\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u,
  );
  assert.match(
    styles,
    /\.report-filter-bar form\s*\{[\s\S]*grid-template-columns:\s*minmax\(140px,\s*180px\)\s+minmax\(260px,\s*1fr\)\s+auto/u,
  );
});

test("subject exports use one responsive selector and equal full-width actions", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(ui, /학습 분야<select/u);
  assert.match(ui, /<label>과목<select value=\{exportSubject\}/u);
  assert.equal((ui.match(/<ExportLink parameters=\{\{ scope:/gu) ?? []).length >= 4, true);
  assert.match(styles, /\.admin-export-list a,[\s\S]*\.admin-export-list button\s*\{[\s\S]*width:\s*100%;/u);
});
