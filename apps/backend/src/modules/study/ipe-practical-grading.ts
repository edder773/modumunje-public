import { pastAnswerInput, gradePastAnswer } from "./ipe-practical-past-grading";
import policiesJson from "../../../../../fixtures/public/ipe-practical-answer-policies.json";
import { gradePracticalFields, multipartPracticalInput } from "./ipe-practical-answer-fields";

export type PracticalAnswerPolicy = typeof policiesJson[number];
const policies = new Map(policiesJson.map((policy) => [policy.id, policy]));

// This module and its answer registry are backend-only. Delivery exposes hints,
// never accepted answers, hashes, or the number/value of successful matches.
export function practicalAnswerInput(id: number, examScope: string) {
  const policy = examScope === "IPEP" ? policies.get(id) : undefined;
  if (!policy?.active) return pastAnswerInput(id, examScope);
  return {
    multiline: policy.mode !== "text",
    hint: policy.hint,
    ...multipartPracticalInput(id),
  };
}

function lines(value: string) { return value.replace(/\r\n?/gu, "\n"); }
function text(value: string, sensitive: boolean) {
  const result = value.normalize("NFKC").trim().replace(/\s/gu, "");
  return sensitive ? result : result.toLocaleLowerCase("en-US");
}
function sortedEqual(first: string[], second: string[]) {
  return first.length === second.length && [...first].sort().every((value, i) => value === [...second].sort()[i]);
}
function splitList(value: string) {
  const stripped = value.trim().replace(/^\{([^{}]*)\}$/u, "$1").replace(/^\(([^()]*)\)$/u, "$1");
  return stripped.split(/\s*[,;·\n]\s*|\s+/u).map(v => v.trim());
}
function splitParts(value: string): string[] | null {
  const raw = lines(value).trim();
  const labels = [...raw.matchAll(/[①-⑨]/gu)];
  if (labels.length) {
    if (raw.slice(0, labels[0].index).trim()) return null;
    if (labels.some((m, i) => m[0].charCodeAt(0) - "①".charCodeAt(0) !== i)) return null;
    return labels.map((m, i) => raw.slice(m.index! + 1, labels[i + 1]?.index ?? raw.length).replace(/^[\s:.]+|[\s,;]+$/gu, ""));
  }
  const parts = raw.split(/\s*[,;\n]\s*/u);
  return parts.map((part, i) => part.replace(new RegExp(`^\\s*(?:\\(${i + 1}\\)|${i + 1}\\)|${i + 1}\\.\\s+)\\s*`, "u"), ""));
}
function numericCell(value: string) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
}
function rowValues(value: string) {
  return lines(value).trim().split("\n").map(row => row.split("|").map(cell => cell.trim()));
}
function keySets(value: string): string[] | null {
  const normalized = value.normalize("NFKC").replace(/\s/gu, "");
  const groups = normalized.includes("{")
    ? (/^\{[A-D](?:,[A-D])*\}(?:,\{[A-D](?:,[A-D])*\})*$/u.test(normalized) ? normalized.match(/\{[^{}]+\}/gu)!.map(v => v.slice(1, -1).replaceAll(",", "")) : null)
    : (/^[A-D]+(?:,[A-D]+)*$/u.test(normalized) ? normalized.split(",") : null);
  return groups?.map(v => [...v].sort().join("")) ?? null;
}

export function matchPracticalAnswer(policy: PracticalAnswerPolicy, input: string): boolean {
  if (!input.trim()) return false;
  if (policy.mode === "output") {
    // Do not trim: leading/trailing spaces, case and empty output lines can be meaningful.
    return lines(input).replace(/\n$/u, "") === lines(policy.answer).replace(/\n$/u, "");
  }
  if (policy.mode === "rows") {
    if (policy.answer === "결과 행 없음") return [policy.answer, "행 없음", "없음", "0행", "공집합", "∅"].some(v => text(v, true) === text(input, true));
    const actual = rowValues(input), expected = rowValues(policy.answer);
    return actual.length === expected.length && expected.every((row, i) => row.length === actual[i].length && row.every((cell, j) => {
      const value = actual[i][j];
      if (cell === "NULL") return value.toUpperCase() === "NULL";
      const number = numericCell(cell);
      return number === null ? cell === value : number === numericCell(value);
    }));
  }
  if (policy.mode === "key-sets") {
    const actual = keySets(input), expected = keySets(policy.answer);
    return Boolean(actual && expected && sortedEqual(actual, expected));
  }
  if (policy.mode === "tuple-set") {
    const tuples = (value: string) => {
      const normalized = value.replace(/\s/gu, "");
      if (!/^\((?:참|거짓),(?:참|거짓)\)(?:,\((?:참|거짓),(?:참|거짓)\))*$/u.test(normalized)) return null;
      return normalized.match(/\([^()]+\)/gu)!;
    };
    const actual = tuples(input), expected = tuples(policy.answer);
    return Boolean(actual && expected && sortedEqual(actual, expected));
  }
  if (policy.mode === "coverage") {
    const normalized = input.replace(/[①②]/gu, "").replace(/\s/gu, "");
    const match = normalized.match(/^3[,;]?((?:P[1-4][,·;]?){3})$/u);
    if (!match) return false;
    const routes = match[1].match(/P[1-4]/gu)!;
    return new Set(routes).size === 3;
  }
  const normalize = (value: string) => text(value, policy.caseSensitive);
  if (policy.mode === "parts" || policy.mode === "unordered-parts") {
    const actual = policy.mode === "unordered-parts" ? splitList(input) : splitParts(input);
    if (!actual || actual.length !== policy.parts.length || actual.some(v => !v)) return false;
    if (policy.mode === "parts") return policy.parts.every((part, i) => part.answers.some(answer => normalize(answer) === normalize(actual[i])));
    // Assign each submitted value to a distinct required part; no duplicate credit.
    const match = (index: number, used: Set<number>): boolean => index === actual.length || policy.parts.some((part, j) => !used.has(j) && part.answers.some(answer => normalize(answer) === normalize(actual[index])) && match(index + 1, new Set([...used, j])));
    return match(0, new Set());
  }
  if (policy.mode === "set" || policy.mode === "list") {
    const actual = splitList(input).map(normalize), expected = splitList(policy.answer).map(normalize);
    if (actual.some(v => !v)) return false;
    return policy.mode === "set" ? sortedEqual(actual, expected) : actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  }
  const accepted = [policy.answer, ...policy.alternatives];
  if (accepted.some(answer => normalize(answer) === normalize(input))) return true;
  if (["number", "integer"].includes(policy.type)) {
    const value = normalize(input);
    const candidates = [value, ...policy.units.filter(unit => value.endsWith(normalize(unit))).map(unit => value.slice(0, -normalize(unit).length))];
    const expected = numericCell(policy.answer.replace(/%$/u, ""));
    return expected !== null && candidates.some(candidate => numericCell(candidate) === expected);
  }
  return false;
}

export async function gradePracticalAnswer(question: { id: number; examScope: string; kind: string; prompt: string; explanation: string }, answer: string) {
  const policy = question.examScope === "IPEP" && question.kind === "descriptive" ? policies.get(question.id) : undefined;
  if (!policy?.active) return gradePastAnswer(question, answer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(question.prompt + "\n" + question.explanation));
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
  // Admin edits cannot silently continue using an answer key for an older stem.
  if (hash !== policy.contentSha256) return null;
  const correct = matchPracticalAnswer(policy, answer);
  const multipart = gradePracticalFields(question.id, answer, correct);
  if (multipart) return multipart;
  return {
    correct,
    result: correct ? "correct" as const : "incorrect" as const,
    score: correct ? 100 : 0,
    feedback: correct ? "입력한 답이 허용 정답과 일치합니다." : "입력한 답이 등록된 허용 정답과 일치하지 않습니다. 아래 정답과 입력 형식을 확인하세요.",
  };
}
