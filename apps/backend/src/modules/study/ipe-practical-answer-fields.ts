import basePolicies from "../../../../../fixtures/public/ipe-practical-answer-policies.json";
import pastPolicies from "../../../../../fixtures/public/ipe-practical-past-answer-policies.json";
import type { PastAnswerPolicy } from "./ipe-practical-past-grading";
import { decodePracticalFields, splitLegacyPracticalFields, type PracticalAnswerInput, type PracticalFieldFormat } from "@shared/study/practical-answer-fields";

type Slot = { label: string; accepts: (value: string) => boolean };
type Layout = { slots: Slot[]; format: PracticalFieldFormat; unorderedGroups: number[][] };
const layouts = new Map<number, Layout>();
const normal = (value: string, sensitive: boolean) => {
  const text = value.normalize("NFKC").replace(/\s/gu, "").replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
  return sensitive ? text : text.toLowerCase();
};
const list = (value: string) => value.trim().replace(/^\{([^{}]*)\}$/u, "$1").split(/[,;·\n]/u).map(item => item.trim().replace(/^(['"])(.*)\1$/u, "$2"));
const indexes = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => i + offset);
function aliasSlot(aliases: string[], index: number, sensitive: boolean, label?: string): Slot {
  return { label: label ?? `답안 ${index + 1}`, accepts: value => Boolean(value.trim()) && aliases.some(alias => normal(alias, sensitive) === normal(value, sensitive)) };
}

for (const p of basePolicies) {
  if (!p.active) continue;
  let slots: Slot[] = [], format: PracticalFieldFormat = "parts";
  let unordered = false;
  if (["parts", "unordered-parts"].includes(p.mode)) {
    slots = p.parts.map((part, i) => aliasSlot(part.answers, i, p.caseSensitive));
    unordered = p.mode === "unordered-parts";
    format = unordered ? "list" : "base-parts";
  } else if (["list", "set"].includes(p.mode)) {
    format = "list"; unordered = p.mode === "set";
    slots = list(p.answer).map((answer, i) => aliasSlot([answer], i, p.caseSensitive));
  } else if (p.mode === "key-sets") {
    format = "key-sets"; unordered = true;
    const key = (value: string) => {
      const raw = value.normalize("NFKC").replace(/\s/gu, "");
      if (!/^(?:\{[A-D](?:,[A-D])*\}|[A-D](?:,?[A-D])*)$/u.test(raw)) return null;
      const stripped = raw.replace(/[{},]/gu, "");
      return /^[A-D]+$/u.test(stripped) && new Set(stripped).size === stripped.length ? [...stripped].sort().join("") : null;
    };
    slots = splitLegacyPracticalFields(p.answer, format).map((answer, i) => ({ label: `후보키 ${i + 1}`, accepts: value => key(value) !== null && key(value) === key(answer) }));
  } else if (p.mode === "tuple-set") {
    format = "tuple-set"; unordered = true;
    slots = splitLegacyPracticalFields(p.answer, format).map((answer, i) => aliasSlot([answer], i, true, `조합 ${i + 1}`));
  } else if (p.mode === "coverage") {
    format = "coverage";
    slots = [aliasSlot(["3"], 0, false, "최소 경로 개수"), {
      label: "경로 조합", accepts: value => {
        const paths = value.trim().split(/[,;·\s]+/u);
        return paths.length === 3 && new Set(paths).size === 3 && paths.every(path => /^P[1-4]$/iu.test(path)) && new Set(paths.map(path => path.toUpperCase())).size === 3;
      },
    }];
  }
  if (slots.length > 1) layouts.set(p.id, { slots, format, unorderedGroups: unordered ? [indexes(slots.length)] : [] });
}

const typedPastPolicies: PastAnswerPolicy[] = pastPolicies;
for (const p of typedPastPolicies) {
  if (!p.active) continue;
  let slots: Slot[] = [], format: PracticalFieldFormat = "parts";
  let groups: number[][] = [];
  // A → ( ) asks for one complete route, including a reviewed alternative
  // omitting the supplied start node. Route nodes are not separate blanks.
  if (p.id === 88200291) continue;
  if (["parts", "unordered-parts", "header-set"].includes(p.mode)) {
    slots = p.parts.map((aliases, i) => aliasSlot(aliases, i, p.caseSensitive));
    if (p.mode === "unordered-parts") groups = [indexes(slots.length)];
    if (p.mode === "header-set") groups = [indexes(slots.length - 1, 1)];
  } else if (p.mode === "lines") {
    format = "flowchart";
    slots = p.parts.slice(0, 6).map((aliases, i) => aliasSlot(aliases, i, p.caseSensitive, `(1) 빈칸 ${i + 1}`));
    slots.push(...p.parts[6][0].split(",").slice(2).map((answer, i) => aliasSlot([answer], i, true, `(2) 경로 빈칸 ${i + 1}`)));
  } else if (["set", "python-set"].includes(p.mode)) {
    format = "list";
    slots = list(p.answer).map((answer, i) => aliasSlot([answer, `'${answer}'`, `"${answer}"`], i, p.caseSensitive));
    groups = [indexes(slots.length)];
  } else if (p.mode === "group-sets" && "sets" in p && p.sets) {
    format = "crypto-groups";
    for (const [groupIndex, values] of p.sets.entries()) {
      groups.push(indexes(values.length, slots.length));
      slots.push(...values.map((answer, i) => aliasSlot([answer], i, p.caseSensitive, `${groupIndex === 0 ? "①" : "②"} 답안 ${i + 1}`)));
    }
  }
  if (slots.length > 1) layouts.set(p.id, { slots, format, unorderedGroups: groups });
}

export function multipartPracticalInput(id: number): Pick<PracticalAnswerInput, "fields" | "fieldFormat" | "hint"> | undefined {
  const layout = layouts.get(id);
  if (!layout) return undefined;
  const unordered = layout.unorderedGroups.length ? " 순서가 없는 항목은 순서와 무관하게 채점하며, 같은 답은 한 번만 인정합니다." : " 지문의 항목 순서에 맞춰 입력하세요.";
  const specific = layout.format === "coverage" ? "경로 조합 칸에는 P1,P2,P3처럼 조합 전체를 입력하세요. " : layout.format === "flowchart" ? "(2)는 지문에 주어진 ①→② 다음의 빈칸만 입력하세요. " : layout.format === "key-sets" ? "후보키 하나의 속성을 {A,C}처럼 한 칸에 묶어 입력하세요. " : layout.format === "tuple-set" ? "조합 하나를 (참, 거짓)처럼 한 칸에 입력하세요. " : "";
  return { fields: layout.slots.map(slot => ({ label: slot.label })), fieldFormat: layout.format,
    hint: `${specific}각 칸에 답을 하나씩 입력하세요.${unordered} 맞힌 항목 수에 따라 5점을 균등 배분합니다.` };
}

export function gradePracticalFields(id: number, input: string, wholeAnswerCorrect: boolean) {
  const layout = layouts.get(id);
  if (!layout) return null;
  const { slots } = layout;
  const decoded = decodePracticalFields(input);
  const actual = decoded ?? splitLegacyPracticalFields(input, layout.format);
  const valid = actual.length <= slots.length && (!input.startsWith("@ipep-fields-v1:") || decoded?.length === slots.length);
  const matches = slots.map((slot, i) => valid && slot.accepts(actual[i] ?? ""));
  if (wholeAnswerCorrect) matches.fill(true);
  else if (valid) {
    for (const group of layout.unorderedGroups) {
      const assigned = new Map<number, number>();
      const assign = (actualIndex: number, visited: Set<number>): boolean => group.some(slotIndex => {
        if (visited.has(slotIndex) || !slots[slotIndex].accepts(actual[actualIndex] ?? "")) return false;
        visited.add(slotIndex);
        const earlier = assigned.get(slotIndex);
        if (earlier !== undefined && !assign(earlier, visited)) return false;
        assigned.set(slotIndex, actualIndex);
        return true;
      });
      group.forEach(i => { matches[i] = false; assign(i, new Set()); });
      for (const i of assigned.values()) matches[i] = true;
    }
  }
  const matched = matches.filter(Boolean).length;
  const correct = matched === slots.length;
  return { correct, result: correct ? "correct" as const : matched ? "partial" as const : "incorrect" as const,
    score: 100 * matched / slots.length,
    answerParts: slots.map((slot, i) => ({ label: slot.label, correct: matches[i] })),
    feedback: `${slots.length}개 항목 중 ${matched}개 정답입니다. 문항 배점 5점을 항목 수로 균등하게 나누어 채점했습니다.` };
}
