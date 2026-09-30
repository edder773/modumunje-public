import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = "apps/frontend";
const backendRoot = "apps/backend/src";
const sharedRoot = "packages/shared/src";

function filesUnder(directory) {
  const absolute = path.join(root, directory);
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => /\.(?:mjs|ts|tsx)$/u.test(file));
}

function source(file) {
  return readFileSync(file, "utf8");
}

test("frontend features cannot import backend modules", () => {
  for (const file of filesUnder(`${frontendRoot}/src/features`)) {
    assert.doesNotMatch(source(file), /from\s+["']@backend\//u, file);
  }
});

test("backend modules cannot import frontend or Next modules", () => {
  for (const file of filesUnder(backendRoot)) {
    const code = source(file);
    assert.doesNotMatch(code, /from\s+["']@frontend\//u, file);
    assert.doesNotMatch(code, /from\s+["']next(?:\/|["'])/u, file);
  }
});

test("admin quality rules remain isolated from service orchestration", () => {
  const handlers = source(path.join(root, backendRoot, "modules/admin/admin-request-handlers.ts"));
  const runtime = source(path.join(root, backendRoot, "modules/admin/admin-use-case-runtime.ts"));
  const qualityRules = source(path.join(root, backendRoot, "modules/admin/admin-quality-rules.ts"));

  assert.match(handlers, /from "\.\/admin-use-cases"/u);
  assert.doesNotMatch(handlers, /adminRepository/u);
  assert.match(runtime, /from "\.\/admin-quality-rules"/u);
  assert.doesNotMatch(handlers, /function markdownFenceBalanced/u);
  assert.match(qualityRules, /export function markdownFenceBalanced/u);
  assert.match(qualityRules, /export function modelAnswerForQuality/u);
  assert.doesNotMatch(qualityRules, /adminRepository|@nestjs/u);
});

test("admin query parameters remain isolated from persistence", () => {
  const handlers = source(path.join(root, backendRoot, "modules/admin/admin-request-handlers.ts"));
  const runtime = source(path.join(root, backendRoot, "modules/admin/admin-use-case-runtime.ts"));
  const queryParameters = source(path.join(
    root,
    backendRoot,
    "modules/admin/admin-query-parameters.ts",
  ));
  const contentValues = source(path.join(
    root,
    backendRoot,
    "modules/admin/admin-content-values.ts",
  ));

  assert.match(runtime, /from "\.\/admin-query-parameters"/u);
  assert.match(runtime, /from "\.\/admin-content-values"/u);
  assert.doesNotMatch(handlers, /function searchTokens/u);
  assert.doesNotMatch(handlers, /function questionValues/u);
  assert.match(queryParameters, /export function searchTokens/u);
  assert.match(queryParameters, /export function readRange/u);
  assert.doesNotMatch(queryParameters, /adminRepository|@nestjs|prepare\(/u);
  assert.match(contentValues, /export function questionValues/u);
  assert.match(contentValues, /export function theoryValues/u);
  assert.match(contentValues, /export function swTheoryValues/u);
  assert.doesNotMatch(contentValues, /adminRepository|@nestjs|prepare\(/u);
});

test("admin use cases stay below the automatic source limit and outside Nest transport", () => {
  const files = [
    "admin-use-case-runtime.ts",
    "admin-read-use-cases.ts",
    "admin-quality-use-cases.ts",
    "admin-backup-use-cases.ts",
    "admin-content-commands.ts",
    "admin-export-use-cases.ts",
  ];
  for (const file of files) {
    const code = source(path.join(root, backendRoot, "modules/admin", file));
    assert.ok(Buffer.byteLength(code) <= 50_000, `${file} exceeds the use-case boundary`);
    assert.doesNotMatch(code, /@nestjs|authorizeAdminReadRequest|readBoundedJsonBody/u, file);
  }
});

test("shared modules stay framework and application independent", () => {
  for (const file of filesUnder(sharedRoot)) {
    const code = source(file);
    assert.doesNotMatch(code, /from\s+["'](?:next|react|@nestjs)(?:\/|["'])/u, file);
    assert.doesNotMatch(code, /from\s+["']@(?:frontend|backend)\//u, file);
  }
});

test("all API features stay on direct request handlers without a Nest runtime", () => {
  const directHandlerFeatures = [
    "admin",
    "auth",
    "events",
    "health",
    "reports",
    "study",
    "sw-study",
  ];
  for (const feature of directHandlerFeatures) {
    const directory = path.join(root, backendRoot, "modules", feature);
    for (const suffix of ["controller.ts", "module.ts"]) {
      assert.equal(
        existsSync(path.join(directory, `${feature}.${suffix}`)),
        false,
        `${feature} ${suffix} should stay removed after direct-route migration`,
      );
    }
  }

  for (const file of [
    "app.module.ts",
    "main.ts",
    "common/http/nest-http.adapter.ts",
    "platform/sites/sites-backend.bridge.ts",
  ]) {
    assert.equal(existsSync(path.join(root, backendRoot, file)), false, `${file} must stay removed`);
  }

  for (const file of [
    "infrastructure/database/database.repository.ts",
    "modules/admin/admin.repository.ts",
    "modules/health/health.repository.ts",
    "modules/health/health.service.ts",
    "modules/operations/operations.repository.ts",
    "modules/auth/auth.repository.ts",
    "modules/auth/auth.service.ts",
    "modules/events/events.repository.ts",
    "modules/events/events.service.ts",
    "modules/reports/reports.repository.ts",
    "modules/reports/reports.service.ts",
    "modules/study/study.repository.ts",
    "modules/study/study.service.ts",
    "modules/sw-study/sw-study.repository.ts",
    "modules/sw-study/sw-study.service.ts",
  ]) {
    assert.doesNotMatch(source(path.join(root, backendRoot, file)), /@nestjs|@Injectable/u, file);
  }

  for (const file of filesUnder(backendRoot)) {
    assert.doesNotMatch(source(file), /@nestjs|NestFactory|reflect-metadata/u, file);
  }

  const packageJson = JSON.parse(source(path.join(root, "package.json")));
  for (const dependency of ["@nestjs/common", "@nestjs/core", "reflect-metadata", "rxjs"]) {
    assert.equal(packageJson.dependencies[dependency], undefined, dependency);
  }

  const typeConfig = source(path.join(root, "tsconfig.json"));
  assert.doesNotMatch(typeConfig, /experimentalDecorators|emitDecoratorMetadata/u);
});

test("API route files remain thin framework-to-backend adapters", () => {
  for (const file of filesUnder(`${frontendRoot}/app/api`)) {
    const code = source(file);
    const lines = code.split("\n").filter((line) => line.trim()).length;
    assert.ok(lines <= 36, `${file} contains ${lines} non-empty lines`);
    assert.match(code, /@backend\/modules\//u, file);
    const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const backendHandlers = new Set();
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.startsWith("@backend/modules/")) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const binding of bindings.elements) backendHandlers.add(binding.name.text);
    }
    assert.ok(backendHandlers.size > 0, `${file} does not import a backend handler`);
    let exportedMethods = 0;
    for (const statement of parsed.statements) {
      if (!ts.isVariableStatement(statement) ||
          !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !/^(?:GET|POST|PATCH|PUT|DELETE)$/u.test(declaration.name.text)) continue;
        exportedMethods += 1;
        let delegates = false;
        const visit = (node) => {
          if (ts.isIdentifier(node) && backendHandlers.has(node.text)) delegates = true;
          ts.forEachChild(node, visit);
        };
        if (declaration.initializer) visit(declaration.initializer);
        assert.ok(delegates, `${file} ${declaration.name.text} does not delegate to an imported backend handler`);
      }
    }
    assert.ok(exportedMethods > 0, `${file} exports no HTTP method`);
    assert.doesNotMatch(code, /invokeBackend|Controller|AppModule/u, file);
    assert.doesNotMatch(code, /getD1|prepare\(|request\.json\(/u, file);
  }
});

test("Next app directory contains framework entry points only", () => {
  const appRoot = path.join(root, frontendRoot, "app");
  const allowed = new Set([
    "error.tsx",
    "global-error.tsx",
    "globals.css",
    "layout.tsx",
    "not-found.tsx",
    "page.tsx",
    "robots.ts",
    "sitemap.ts",
  ]);
  const files = readdirSync(appRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.deepEqual(files.sort(), [...allowed].sort());

  for (const file of filesUnder(`${frontendRoot}/app`)) {
    if (!/\.(?:ts|tsx)$/u.test(file)) continue;
    const normalizedFile = file.replaceAll("\\", "/");
    assert.ok(
      /\/(?:error|forbidden|global-error|layout|loading|not-found|page|robots|route|sitemap)\.(?:ts|tsx)$/u.test(normalizedFile),
      `${file} is not a framework entry point`,
    );
  }
});

test("global CSS preserves cascade order through bounded style layers", () => {
  const globalStyles = readFileSync(path.join(root, frontendRoot, "app/globals.css"), "utf8");
  assert.match(globalStyles, /application.css/u);
  const application = readFileSync(path.join(root, frontendRoot, "app/styles/application.css"), "utf8");
  const imports = ["design-system-base.css", ...[...application.matchAll(/@import "[.]\/([^"]+)";/gu)].map((match) => match[1])];
  assert.deepEqual(imports, [
    "design-system-base.css",
    "global-foundation.css",
    "sql-learning.css",
    "exam-past.css",
    "exam-practical.css",
    "exam-answer-map.css",
    "ui-integrity.css",
    "readability.css",
    "question-privacy.css",
    "account-learning.css",
    "responsive-learning.css",
    "service-entry.css",
    "platform-navigation.css",
    "sw-learning.css",
    "accessibility.css",
    "audit-remediation.css",
    "catalog-directory.css",
    "content-diagrams.css",
  ]);
  for (const file of imports) {
    const code = source(path.join(root, frontendRoot, "app/styles", file));
    assert.ok(code.split("\n").length <= 4_000, `${file} exceeds the CSS layer boundary`);
  }
});

test("services never access D1, Drizzle, or database schema directly", () => {
  for (const file of filesUnder(`${backendRoot}/modules`).filter((item) => item.endsWith(".service.ts"))) {
    const code = source(file);
    assert.doesNotMatch(code, /\bgetD1\s*\(|\bgetDb\s*\(/u, file);
    assert.doesNotMatch(code, /@backend\/infrastructure\/database(?:\/schema)?/u, file);
    assert.doesNotMatch(code, /from\s+["']drizzle-orm["']/u, file);
  }
});

test("study candidate selection and input validation stay behind repository boundaries", () => {
  const service = readFeatureSource(path.join(root, backendRoot, "modules/study/study.service.ts"), "utf8");
  const delivery = source(path.join(root, backendRoot, "modules/study/study-question-delivery.ts"));
  const repository = source(path.join(root, backendRoot, "modules/study/study.repository.ts"));
  const questionQueries = source(path.join(
    root,
    backendRoot,
    "modules/study/study-question.repository-queries.ts",
  ));
  const practiceQuery = source(path.join(root, backendRoot, "modules/study/study-practice-query.mjs"));
  const d1ListBindings = source(path.join(
    root,
    backendRoot,
    "common/database/d1-query-bindings.mjs",
  ));

  assert.doesNotMatch(
    service,
    /select\(\)\.from\(questions\)\.where\(eq\(questions\.active, true\)\)/u,
    "study service must not load the full active question catalog",
  );
  assert.match(delivery, /findPracticeQuestions/u);
  assert.match(service, /findExamCandidateMetadata/u);
  assert.match(service, /findFeedbackQuestionsByIds\(candidateQuestionIds\)/u);
  assert.match(practiceQuery, /LIMIT \?/u);
  assert.match(repository, /encodeD1IntegerList/u);
  assert.match(questionQueries, /json_each\(\?\)/u);
  assert.match(practiceQuery, /json_each\(\?\)/u);
  assert.match(d1ListBindings, /Number\.isSafeInteger/u);
  assert.doesNotMatch(repository, /index \+= 400/u);
  assert.doesNotMatch(questionQueries, /index \+= 400/u);
});

test("frontend request policy and heavy feature chunks have explicit shared boundaries", () => {
  const transport = source(path.join(root, frontendRoot, "src/shared/api/request-json.ts"));
  const studyClient = source(path.join(root, frontendRoot, "src/features/study/model/study-api-client.ts"));
  const swClient = source(path.join(root, frontendRoot, "src/features/study/model/sw-study-api-client.ts"));
  const adminClient = source(path.join(root, frontendRoot, "src/features/admin/model/admin-api-client.ts"));
  const studyApp = source(path.join(root, frontendRoot, "src/features/study/components/study-app.tsx"));
  const studyLazyScreens = source(path.join(root, frontendRoot, "src/features/study/components/study-lazy-screens.ts"));
  const adminApp = source(path.join(root, frontendRoot, "src/features/admin/components/admin-app.tsx"));
  const adminCore = source(path.join(root, frontendRoot, "src/features/admin/components/admin-core-sections.tsx"));
  const swPlanner = source(path.join(root, frontendRoot, "src/features/study/components/sw-curriculum-planner.tsx"));
  const swContent = source(path.join(root, frontendRoot, "src/features/study/components/sw-curriculum-content.tsx"));
  const swSelection = source(path.join(root, frontendRoot, "src/features/study/components/sw-curriculum-selection.tsx"));
  const navigationState = source(path.join(root, frontendRoot, "src/features/study/model/use-study-navigation-state.ts"));
  const readingProgress = source(path.join(root, frontendRoot, "src/features/study/model/use-sw-reading-progress.ts"));

  assert.match(transport, /AbortSignal\.any/u);
  assert.match(transport, /content-type/u);
  assert.doesNotMatch(studyClient, /\bfetch\(/u);
  assert.doesNotMatch(swClient, /\bfetch\(/u);
  assert.match(studyClient, /requestJson/u);
  assert.match(swClient, /requestJson/u);
  assert.match(adminClient, /requestJson/u);
  assert.match(studyApp, /study-lazy-screens/u);
  assert.match(studyApp, /useStudyNavigationState/u);
  assert.match(swPlanner, /useSwReadingProgress/u);
  assert.match(navigationState, /parseLearningPath/u);
  assert.match(readingProgress, /requestAnimationFrame/u);
  assert.match(studyLazyScreens, /lazy\(\(\) => import\("\.\/sql\/practice\/practice-screen"\)\)/u);
  assert.match(swPlanner, /SwCurriculumContent/u);
  assert.match(swContent, /lazy\(\(\) => import\("\.\/sw-curriculum-selection"\)\)/u);
  assert.match(adminApp, /lazy\(\(\) => import\("\.\/admin-settings-section"\)\)/u);
  assert.match(adminApp, /lazy\(\(\) => import\("\.\/admin-logs-section"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-dashboard-section"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-question-sections"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-theory-sections"\)\)/u);
  assert.match(swSelection, /import "\.\/sw-curriculum\.css"/u);
});
