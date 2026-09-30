export const STUDY_READ_SCOPES = [
  "shell",
  "overview",
  "bootstrap",
  "theories",
  "theory",
  "practice-meta",
  "practice",
  "questions",
  "records",
  "mock",
  "mock-session",
] as const;

export type StudyReadScope = typeof STUDY_READ_SCOPES[number];

const STUDY_READ_SCOPE_SET = new Set<string>(STUDY_READ_SCOPES);

export function parseStudyReadScope(value: string | null): StudyReadScope | null {
  return value && STUDY_READ_SCOPE_SET.has(value) ? value as StudyReadScope : null;
}

export function privateStudyReadScope(scope: StudyReadScope) {
  return scope === "practice"
    || scope === "questions"
    || scope === "records"
    || scope === "mock"
    || scope === "mock-session";
}
