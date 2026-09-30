export const LEARNING_ENGINE_CAPABILITIES = [
  "theory",
  "practice",
  "mock-exam",
  "records",
  "bookmarks",
  "local-practice",
] as const;

export type LearningEngineCapability = typeof LEARNING_ENGINE_CAPABILITIES[number];
export type LearningEngineRouteModel = "course" | "field-sections";
export type LearningEngineHomeView = "course-selector" | "curriculum-planner";

export type LearningEngineDefinition = {
  id: string;
  contentAdapterId: string;
  apiPath: `/api/${string}`;
  routeModel: LearningEngineRouteModel;
  homeView: LearningEngineHomeView;
  capabilities: readonly LearningEngineCapability[];
  catalog: {
    mode: "courses" | "capabilities";
    actionLabelSuffix: string;
    offerings: readonly string[];
  };
};

type LearningEngineRegistry<
  TDefinitions extends readonly LearningEngineDefinition[],
> = {
  readonly [TDefinition in TDefinitions[number] as TDefinition["id"]]: TDefinition;
};

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} 값은 중복될 수 없습니다.`);
  }
}

function freezeDefinition<TDefinition extends LearningEngineDefinition>(
  definition: TDefinition,
) {
  return Object.freeze({
    ...definition,
    capabilities: Object.freeze([...definition.capabilities]),
    catalog: Object.freeze({
      ...definition.catalog,
      offerings: Object.freeze([...definition.catalog.offerings]),
    }),
  });
}

export function defineLearningEngineRegistry<
  const TDefinitions extends readonly LearningEngineDefinition[],
>(definitions: TDefinitions): LearningEngineRegistry<TDefinitions> {
  if (!definitions.length) throw new Error("학습 엔진을 하나 이상 등록해야 합니다.");

  unique(definitions.map((definition) => definition.id), "학습 엔진 ID");
  unique(definitions.map((definition) => definition.contentAdapterId), "콘텐츠 어댑터 ID");
  unique(definitions.map((definition) => definition.apiPath), "학습 API 경로");

  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9-]*$/u.test(definition.id)) {
      throw new Error(`학습 엔진 ID 형식이 올바르지 않습니다: ${definition.id}`);
    }
    if (!/^[a-z][a-z0-9-]*$/u.test(definition.contentAdapterId)) {
      throw new Error(`콘텐츠 어댑터 ID 형식이 올바르지 않습니다: ${definition.contentAdapterId}`);
    }
    if (!/^\/api\/[a-z][a-z0-9-]*$/u.test(definition.apiPath)) {
      throw new Error(`학습 API 경로 형식이 올바르지 않습니다: ${definition.apiPath}`);
    }
    if (!definition.capabilities.length) {
      throw new Error(`${definition.id} 학습 엔진의 기능이 비어 있습니다.`);
    }
    unique(definition.capabilities, `${definition.id} 학습 엔진 기능`);
    if (
      definition.routeModel === "course"
      && definition.homeView !== "course-selector"
    ) {
      throw new Error(`${definition.id} 과정 라우팅은 과정 선택 화면을 사용해야 합니다.`);
    }
    if (
      definition.routeModel === "field-sections"
      && definition.homeView !== "curriculum-planner"
    ) {
      throw new Error(`${definition.id} 분야 라우팅은 학습 범위 화면을 사용해야 합니다.`);
    }
    if (definition.catalog.mode === "capabilities" && !definition.catalog.offerings.length) {
      throw new Error(`${definition.id} 카탈로그 제공 항목이 비어 있습니다.`);
    }
  }

  return Object.freeze(Object.fromEntries(
    definitions.map((definition) => [definition.id, freezeDefinition(definition)]),
  )) as LearningEngineRegistry<TDefinitions>;
}

export const LEARNING_ENGINE_DEFINITIONS = [
  {
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
  },
  {
    id: "curriculum",
    contentAdapterId: "subject-content",
    apiPath: "/api/sw-study",
    routeModel: "field-sections",
    homeView: "curriculum-planner",
    capabilities: ["theory", "practice", "mock-exam"],
    catalog: {
      mode: "capabilities",
      actionLabelSuffix: "학습 범위 선택 →",
      offerings: ["과목별 이론 학습", "연속 문제 풀이", "선택 범위 모의고사"],
    },
  },
] as const satisfies readonly LearningEngineDefinition[];

export const LEARNING_ENGINE_REGISTRY = defineLearningEngineRegistry(
  LEARNING_ENGINE_DEFINITIONS,
);

export type LearningEngineId = keyof typeof LEARNING_ENGINE_REGISTRY;
export type RegisteredLearningEngine = typeof LEARNING_ENGINE_REGISTRY[LearningEngineId];

export function learningEngine<TId extends LearningEngineId>(engineId: TId) {
  return LEARNING_ENGINE_REGISTRY[engineId];
}

export function learningEngineForField(field: { engineId: LearningEngineId }) {
  return learningEngine(field.engineId);
}
