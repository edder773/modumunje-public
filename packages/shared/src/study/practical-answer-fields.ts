export type PracticalFieldFormat = "parts" | "base-parts" | "list" | "lines" | "key-sets" | "tuple-set" | "coverage" | "crypto-groups" | "flowchart";
export type PracticalAnswerInput = {
  multiline: boolean;
  hint: string;
  fields?: Array<{ label: string; multiline?: boolean }>;
  fieldFormat?: PracticalFieldFormat;
};

import { decodePracticalFields } from "./practical-answer-presence";
export { decodePracticalFields, encodePracticalFields, hasPracticalAnswer } from "./practical-answer-presence";

export function displayPracticalAnswer(value: string): string {
  const fields = decodePracticalFields(value);
  return fields ? fields.map((item, index) => `${index + 1}. ${item.trim() ? item : "미입력"}`).join("\n") : value;
}

// Legacy drafts remain readable. New drafts use a versioned string envelope so
// an empty middle field or a comma/newline inside one answer cannot move slots.
export function splitLegacyPracticalFields(value: string, format: PracticalFieldFormat): string[] {
  const raw = value.replace(/\r\n?/gu, "\n");
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (format === "key-sets") return trimmed.includes("{")
    ? /^\{[^{}]*\}(?:\s*[,;\n]\s*\{[^{}]*\})*$/u.test(trimmed) ? trimmed.match(/\{[^{}]*\}/gu)! : [raw]
    : trimmed.split(",");
  if (format === "tuple-set") return /^\((?:참|거짓)\s*,\s*(?:참|거짓)\)(?:\s*[,;\n]\s*\((?:참|거짓)\s*,\s*(?:참|거짓)\))*$/u.test(trimmed) ? trimmed.match(/\([^()]*\)/gu)! : [raw];
  if (format === "coverage") {
    const clean = trimmed.replace(/[①②]/gu, "").trim();
    const match = clean.match(/^(\S+?)[,;\n\s]+([\s\S]*)$/u);
    return match ? [match[1], match[2]] : [clean];
  }
  const onlyLines = ["lines", "crypto-groups", "flowchart"].includes(format);
  const labels = /^[①-⑳\s,;→|]+$/u.test(trimmed) ? [] : [...trimmed.matchAll(/[①-⑳]/gu)];
  let values: string[];
  if (labels.length && !trimmed.slice(0, labels[0].index).trim()
    && labels.every((label, i) => label[0].charCodeAt(0) - "①".charCodeAt(0) === i)) {
    values = labels.map((label, i) => trimmed.slice(label.index! + 1, labels[i + 1]?.index ?? trimmed.length).replace(/^[\s:.]+|[\s,;]+$/gu, ""));
  } else if (format === "list") {
    const clean = trimmed.replace(/^\{([^{}]*)\}$/u, "$1");
    values = clean.split(/[,;·\n]/u);
    if (values.length === 1) values = clean.split(/\s+/u);
  } else {
    values = raw.split(onlyLines ? /\n/u : format === "base-parts" ? /\s*(?:,|;|\n)\s*/u : /\s*(?:,|;|\n|→|->|\|)\s*/u);
  }
  values = values.map((v, i) => v.trim().replace(new RegExp(`^(?:\\(${i + 1}\\)|${i + 1}[.)]\\s+)\\s*`, "u"), ""));
  while (values.length && !values.at(-1)) values.pop();
  if (format === "crypto-groups") {
    if (values.length !== 2) return [raw];
    const groups = values.map(group => group.split(/[,;]/u).map(item => item.trim()));
    if (groups[0].length > 4 || groups[1].length > 2) return [raw];
    return [...Array.from({ length: 4 }, (_, i) => groups[0][i] ?? ""), ...Array.from({ length: 2 }, (_, i) => groups[1][i] ?? "")];
  }
  if (format === "flowchart") {
    if (values.length !== 7) return [raw];
    const route = values[6].split(/\s*(?:,|→|->)\s*/u);
    return route.length === 7 && route[0] === "1" && route[1] === "2" ? [...values.slice(0, 6), ...route.slice(2)] : [raw];
  }
  return values;
}

export function practicalFieldValues(value: string, input: PracticalAnswerInput): string[] {
  const count = input.fields?.length ?? 0;
  const parsed = decodePracticalFields(value) ?? splitLegacyPracticalFields(value, input.fieldFormat ?? "parts");
  const values = parsed.length <= count ? parsed : [value];
  return Array.from({ length: count }, (_, i) => values[i] ?? "");
}
