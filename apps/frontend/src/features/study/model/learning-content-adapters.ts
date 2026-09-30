import { learningEngine, type LearningEngineId } from "@shared/study/learning-engine";

export type MutationValidation =
  | { ok: true; action: string; payload: unknown }
  | { ok: false; code: string; message: string };

type EngineAdapterIdentity = {
  engineId: LearningEngineId;
  contentAdapterId: string;
  apiPath: `/api/${string}`;
};

export type LearningReadContentAdapter<TReadOperation extends string> = EngineAdapterIdentity & {
  validateRead: (operation: TReadOperation, payload: unknown) => boolean;
  normalizeRead: (payload: unknown) => unknown;
};

export type LearningMutationContentAdapter<TMutationAction extends string> = EngineAdapterIdentity & {
  validateMutationRequest: (payload: unknown) => MutationValidation;
  validateMutationResponse: (action: TMutationAction, payload: unknown) => boolean;
};

function adapterIdentity(engineId: LearningEngineId): EngineAdapterIdentity {
  const engine = learningEngine(engineId);
  return {
    engineId,
    contentAdapterId: engine.contentAdapterId,
    apiPath: engine.apiPath,
  };
}

export function defineLearningReadContentAdapter<TReadOperation extends string>(
  definition: Omit<LearningReadContentAdapter<TReadOperation>, keyof EngineAdapterIdentity> & {
    engineId: LearningEngineId;
  },
): LearningReadContentAdapter<TReadOperation> {
  return Object.freeze({
    ...definition,
    ...adapterIdentity(definition.engineId),
  });
}

export function defineLearningMutationContentAdapter<TMutationAction extends string>(
  definition: Omit<LearningMutationContentAdapter<TMutationAction>, keyof EngineAdapterIdentity> & {
    engineId: LearningEngineId;
  },
): LearningMutationContentAdapter<TMutationAction> {
  return Object.freeze({
    ...definition,
    ...adapterIdentity(definition.engineId),
  });
}
