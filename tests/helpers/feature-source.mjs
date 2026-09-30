import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_COMPANIONS = new Map([
  ["admin.css", ["admin-controls.css"]],
  ["globals.css", [
    "styles/design-system-base.css",
    "styles/application.css",
    "styles/global-foundation.css",
    "styles/sql-learning.css",
    "styles/ui-integrity.css",
    "styles/readability.css",
    "styles/question-privacy.css",
    "styles/account-learning.css",
    "styles/responsive-learning.css",
    "styles/service-entry.css",
    "styles/platform-navigation.css",
    "styles/sw-learning.css",
    "styles/accessibility.css",
    "styles/audit-remediation.css",
  ]],
  ["study-app.tsx", [
    "study-app-config.ts",
    "../model/use-practice-session.ts",
    "../model/use-mock-exam-session.ts",
    "../model/use-theory-learning.ts",
    "../model/use-guest-learning-sync.ts",
    "../persistence/guest-learning-store.ts",
    "../model/use-session-epoch.ts",
    "study-app-chrome.tsx",
    "study-app-view-state.ts",
    "study-header.tsx",
    "study-sidebar.tsx",
    "study-lazy-screens.ts",
    "../model/use-sql-learning-mutation-queues.ts",
    "../model/use-study-save-operations.ts",
    "../model/practice-candidates.mjs",
    "../model/study-data-utils.ts",
    "study-screen-shared.tsx",
    "learning-field-home.tsx",
    "sw-curriculum-planner.tsx",
    "sw-curriculum-content.tsx",
    "sw-question-runners.tsx",
    "catalog/catalog-home.tsx",
    "catalog/catalog-fields.ts",
    "sql/dashboard/dashboard-screen.tsx",
    "sql/practice/practice-screen.tsx",
    "sql/mock/mock-home.tsx",
    "sql/mock/exam-runner.tsx",
    "sql/theory/theory-screen.tsx",
    "sql/records/records-screen.tsx",
    "sql/reports/user-report-modal.tsx",
  ]],
  ["sw-curriculum-planner.tsx", [
    "../model/use-sw-curriculum-state.ts",
    "../model/sw-session-restore.mjs",
    "sw-curriculum-content.tsx",
    "sw-curriculum-selection.tsx",
    "sw-mock-setup.tsx",
    "sw-question-runners.tsx",
    "sw-theory-views.tsx",
  ]],
  ["catalog-home.tsx", ["catalog-fields.ts", "catalog-search.ts"]],
  ["study-screen-shared.tsx", ["../model/study-data-utils.ts"]],
  ["admin-app.tsx", [
    "admin-ui.tsx",
    "admin-content-shared.tsx",
    "admin-analytics-section.tsx",
    "admin-certification-submissions.tsx",
    "admin-core-sections.tsx",
    "admin-dashboard-section.tsx",
    "admin-question-sections.tsx",
    "admin-theory-sections.tsx",
    "admin-members-section.tsx",
    "admin-reports-section.tsx",
    "admin-restore-modal.tsx",
    "admin-section-primitives.tsx",
    "admin-settings-section.tsx",
    "admin-logs-section.tsx",
  ]],
]);

const BACKEND_COMPANIONS = new Map([
  ["study.service.ts", [
    "study.repository.ts",
    "study-guest-import.repository-query.ts",
    "study-read-use-cases.ts",
    "study-practice-authorization.ts",
    "study-exam-use-cases.ts",
    "study-owned-session.ts",
    "study-request-values.ts",
    "study-question.repository-queries.ts",
    "study-theory.repository-queries.ts",
    "study-public-content-cache.ts",
  ]],
  ["study.repository.ts", ["study-question.repository-queries.ts", "study-theory.repository-queries.ts"]],
  ["admin-request-handlers.ts", [
    "admin-use-cases.ts",
    "admin-use-case-runtime.ts",
    "admin-read-use-cases.ts",
    "admin-activity-trend-query.ts",
    "admin-submission-query.ts",
    "admin-quality-use-cases.ts",
    "admin-backup-use-cases.ts",
    "admin-external-backup-use-cases.ts",
    "backup-storage.ts",
    "admin-content-commands.ts",
    "admin-export-use-cases.ts",
    "admin.repository.ts",
    "admin-quality-rules.ts",
    "admin-query-parameters.ts",
    "admin-content-values.ts",
  ]],
  ["sw-study.service.ts", ["sw-study.repository.ts"]],
  ["events.service.ts", ["events.repository.ts"]],
  ["reports.service.ts", ["reports.repository.ts"]],
]);

function filesystemPath(file) {
  return file instanceof URL ? fileURLToPath(file) : String(file);
}

/**
 * Reads a source contract. Modular feature entry points include their lazy UI
 * sections, request handlers, or repository adapter so behavioral assertions
 * validate the complete feature instead of depending on one oversized file.
 */
export function readFeatureSource(file, options) {
  const content = readFileSync(file, options);
  if (typeof content !== "string") return content;

  const absolutePath = filesystemPath(file);
  const filename = path.basename(absolutePath);
  const companions = FRONTEND_COMPANIONS.get(filename) ?? BACKEND_COMPANIONS.get(filename) ?? [];
  if (!companions.length) return content;

  return [
    content,
    ...companions.map((companion) => readFileSync(path.join(path.dirname(absolutePath), companion), "utf8")),
  ].join("\n");
}
