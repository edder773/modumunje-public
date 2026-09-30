export const SELF_LEARNING_RESET_CONFIRMATION = "내 학습 기록 초기화";
export const SELF_LEARNING_RESET_LABELS = {
  attempts: "자격증 풀이·자가채점",
  ai_evaluations: "서술형 채점 결과",
  sw_attempts: "SW 풀이·채점",
  exam_session_items: "모의고사 저장 답안",
  exam_active_sessions: "진행 중 모의고사 연결",
  exam_sessions: "자격증 모의고사",
  sw_learning_sessions: "SW 연습·모의고사 세션",
} as const;
export type SelfLearningResetCounts = Record<keyof typeof SELF_LEARNING_RESET_LABELS, number>;
export type SelfLearningResetPreview = {
  email: string;
  resetId: string;
  counts: SelfLearningResetCounts;
};
export type SelfLearningResetResult = {
  email: string;
  resetId: string;
  deleted: SelfLearningResetCounts;
  completedAt: string;
  replayed: boolean;
};
