import { LOCAL_PRACTICE_TYPE2_RELEASE } from "./local-practice-type2-release";

export type Type2QuestionSummary = { id: string; number: number; title: string; task: string; metric: string };
export type Type2Index = { version: string; count: number; questions: Type2QuestionSummary[]; files: Record<string, string>; officialExample: string };
export type Type2Question = Type2QuestionSummary & { key: string; level: string; statement: string; metricKey: string; metricDirection: string;
  target: string; targetMeaning: string; cautions: string[];
  submission: { filename: string; columns: string[]; rows: number; prediction: string; exampleValues: string[]; rowOrder: string; index: string; path: string; encoding: string };
  data: { role: string; file: string; rows: number; columns: number; targetIncluded: boolean }[];
  columnDescriptions: { name: string; description: string }[] };
export type Type2Reference = { id: string; code: string; metric: string; candidateScores: Record<string, number>; selectedModel: string; validationScore: number; fitRows: number; validationRows: number; environment: Record<string, string> };
export function isType2QuestionId(id: string) {
  return /^T2-\d{3}$/u.test(id) && Number(id.slice(3)) >= 1 && Number(id.slice(3)) <= LOCAL_PRACTICE_TYPE2_RELEASE.questionCount;
}
export function type2QuestionId(query: string) {
  const id = new URLSearchParams(query).get("question") ?? "T2-001";
  return isType2QuestionId(id) ? id : "T2-001";
}
