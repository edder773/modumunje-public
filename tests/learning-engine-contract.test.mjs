import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readFeatureSource } from "./helpers/feature-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(root, file), "utf8");
}

async function loadLearningEngineContract() {
  const file = path.join(root, "packages/shared/src/study/learning-engine.ts");
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  assert.deepEqual(output.diagnostics ?? [], []);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

test("certification and curriculum learning engines share one validated registry", async () => {
  const contract = await loadLearningEngineContract();

  assert.deepEqual(Object.keys(contract.LEARNING_ENGINE_REGISTRY), [
    "certification",
    "curriculum",
  ]);
  assert.deepEqual(contract.learningEngine("certification"), {
    id: "certification",
    contentAdapterId: "course-content",
    apiPath: "/api/study",
    routeModel: "course",
    homeView: "course-selector",
    capabilities: ["theory", "practice", "mock-exam", "records", "bookmarks", "local-practice"],
    catalog: {
      mode: "courses",
      actionLabelSuffix: "과정 선택 →",
      offerings: [],
    },
  });
  assert.equal(contract.learningEngine("curriculum").apiPath, "/api/sw-study");
  assert.equal(contract.learningEngine("curriculum").routeModel, "field-sections");
  assert.equal(Object.isFrozen(contract.LEARNING_ENGINE_REGISTRY), true);
  assert.equal(Object.isFrozen(contract.learningEngine("curriculum").capabilities), true);
});

test("a future specialized engine can implement the same contract without changing existing engines", async () => {
  const contract = await loadLearningEngineContract();
  const future = contract.defineLearningEngineRegistry([
    ...contract.LEARNING_ENGINE_DEFINITIONS,
    {
      id: "interactive-lab",
      contentAdapterId: "sandbox-content",
      apiPath: "/api/interactive-lab",
      routeModel: "field-sections",
      homeView: "curriculum-planner",
      capabilities: ["theory", "practice"],
      catalog: {
        mode: "capabilities",
        actionLabelSuffix: "실습 범위 선택 →",
        offerings: ["격리 실습", "결과 검증"],
      },
    },
  ]);

  assert.equal(future["interactive-lab"].contentAdapterId, "sandbox-content");
  assert.equal(future.certification.apiPath, "/api/study");
  assert.equal(future.curriculum.apiPath, "/api/sw-study");
});

test("invalid or ambiguous engine registrations fail before application startup", async () => {
  const contract = await loadLearningEngineContract();
  const base = contract.LEARNING_ENGINE_DEFINITIONS[0];

  assert.throws(
    () => contract.defineLearningEngineRegistry([base, { ...base }]),
    /학습 엔진 ID 값은 중복될 수 없습니다/u,
  );
  assert.throws(
    () => contract.defineLearningEngineRegistry([{
      ...base,
      id: "invalid-route-pair",
      contentAdapterId: "invalid-route-content",
      apiPath: "/api/invalid-route-pair",
      routeModel: "field-sections",
    }]),
    /분야 라우팅은 학습 범위 화면을 사용해야 합니다/u,
  );
});

test("catalog, routing, frontend requests, and backend controllers consume engine contracts", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const courseContract = source("packages/shared/src/study/course-contract.mjs");
  const fieldHome = source("apps/frontend/src/features/study/components/learning-field-home.tsx");
  const catalogFields = source("apps/frontend/src/features/study/components/catalog/catalog-fields.ts");
  const studyApp = source("apps/frontend/src/features/study/components/study-app.tsx");
  const adapters = source("apps/frontend/src/features/study/model/learning-content-adapters.ts");
  const studyClient = source("apps/frontend/src/features/study/model/study-api-client.ts");
  const swClient = source("apps/frontend/src/features/study/model/sw-study-api-client.ts");
  const mutationClient = source("apps/frontend/src/features/study/model/study-mutation-api-client.ts");
  const engines = source("packages/shared/src/study/learning-engine.ts");

  assert.match(catalog, /engineId:\s*LearningEngineId/u);
  assert.match(courseContract, /"id": "sql"[\s\S]*"engineId": "certification"/u);
  assert.match(catalog, /COURSE_FIELD_DEFINITIONS\.flatMap[\s\S]*engineId: "certification"/u);
  assert.match(catalog, /id:\s*"software-major"[\s\S]*engineId:\s*"curriculum"/u);
  assert.match(catalog, /learningFieldUsesSectionRoutes/u);
  assert.match(fieldHome, /engine\.homeView === "curriculum-planner"/u);
  assert.match(catalogFields, /engine\.catalog\.mode === "courses"/u);
  assert.match(studyApp, /learningFieldEngine\(selectedField\)\.routeModel === "field-sections"/u);

  const inferenceSources = [catalog, fieldHome, catalogFields, studyApp].join("\n");
  assert.doesNotMatch(inferenceSources, /subjectGroups\?\.length/u);

  assert.match(adapters, /defineLearningReadContentAdapter/u);
  assert.match(adapters, /defineLearningMutationContentAdapter/u);
  assert.match(studyClient, /engineId:\s*"certification"/u);
  assert.match(swClient, /engineId:\s*"curriculum"/u);
  assert.match(studyClient, /STUDY_CONTENT_ADAPTER\.apiPath/u);
  assert.match(swClient, /SW_STUDY_CONTENT_ADAPTER\.apiPath/u);
  assert.match(mutationClient, /requestMutation\(STUDY_MUTATION_ADAPTER/u);
  assert.match(mutationClient, /requestMutation\(SW_STUDY_MUTATION_ADAPTER/u);
  assert.doesNotMatch([studyClient, swClient, mutationClient].join("\n"), /"\/api\/(?:study|sw-study)"/u);
  assert.match(engines, /id: "certification"[\s\S]*apiPath: "\/api\/study"/u);
  assert.match(engines, /id: "curriculum"[\s\S]*apiPath: "\/api\/sw-study"/u);
  assert.doesNotMatch(engines, /learningEngineControllerPath/u);
});
