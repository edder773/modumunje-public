import { LOCAL_PRACTICE_TYPE3_RELEASE } from "./local-practice-type3-release";

export type Type3Summary = { id: string; number: number; title: string; method: string; subquestionCount: number };
export type Type3Index = { version: string; count: number; subquestionCount: number; questions: Type3Summary[]; files: Record<string, string>; officialExample: string };
export type Type3Question = Type3Summary & {
  statement: string; conditions: string[];
  subquestions: { id: string; number: number; prompt: string; format: string; formatSpec: string }[];
  data: { file: string; rows: number; columnCount: number; columns: { name: string; description: string }[] };
};
export type Type3Reference = {
  id: string; answers: { id: string; display: string }[]; code: string; stdout: string; explanation: string[]; interpretation: string;
  diagnosticCode: string; diagnosticStdout: string; environment: Record<string, string>;
};
export function isType3QuestionId(id: string) {
  return /^T3-\d{3}$/u.test(id) && Number(id.slice(3)) >= 1 && Number(id.slice(3)) <= LOCAL_PRACTICE_TYPE3_RELEASE.questionCount;
}
export function type3QuestionId(query: string) {
  const id = new URLSearchParams(query).get("question") ?? "T3-001";
  return isType3QuestionId(id) ? id : "T3-001";
}
