import {
  DEFAULT_EXAM_TYPE,
  examDisplayName,
  isReleasedExamType,
  parseJson,
  RELEASED_EXAM_TYPES,
  type ExamType
} from "./domain/study.domain";
import {
  StudyRequestError
} from "./study-attempt.service";

export type JsonRecord = Record<string, unknown>;
export const PUBLIC_CACHE_CONTROL = "public, max-age=0, must-revalidate";
export const PRIVATE_CACHE_CONTROL = "private, no-store";
export const EXAM_GRADING_LEASE_MS = 5 * 60_000;
export const STUDY_BODY_MAX_BYTES = 2 * 1024 * 1024;

export function list(value: unknown) {
  if (Array.isArray(value)) return value;
  return parseJson<unknown[]>(value, []);
}

export function numberList(value: unknown) {
  return list(value).map(Number).filter(Number.isInteger);
}

export function requiredString(value: unknown, field: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    throw new StudyRequestError(
      400,
      "요청 식별자가 필요합니다.",
      `${field} is required`,
      "STUDY_IDENTIFIER_REQUIRED",
    );
  }
  return result;
}

export function examType(value: unknown): ExamType {
  if (value === undefined || value === null || value === "") return DEFAULT_EXAM_TYPE;
  if (isReleasedExamType(value)) return value;
  throw new StudyRequestError(
    400,
    `지원하지 않는 시험 유형입니다. ${RELEASED_EXAM_TYPES.map(examDisplayName).join(" 또는 ")}를 선택해 주세요.`,
    `unsupported exam type: ${String(value)}`,
  );
}

export function now() {
  return new Date().toISOString();
}
