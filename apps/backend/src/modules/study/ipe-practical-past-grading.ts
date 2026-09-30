import policyRows from '../../../../../fixtures/public/ipe-practical-past-answer-policies.json';
import { gradePracticalFields, multipartPracticalInput } from './ipe-practical-answer-fields';

export interface PastAnswerPolicy {
  id: number;
  active: boolean;
  mode: string;
  answer: string;
  explanation?: string;
  alternatives: string[];
  parts: string[][];
  caseSensitive: boolean;
  hint: string;
  contentSha256: string;
  groups?: string[][];
  reject?: string[];
  sets?: string[][];
  edges?: number[][];
  requiredEdges?: number[][];
  ignoreAliases?: boolean;
  optionalHeader?: string;
}
const policies = new Map((policyRows as PastAnswerPolicy[]).map(policy => [policy.id, policy]));
const newlines = (s: string) => s.replace(/\r\n?/gu, '\n');
const normalized = (s: string, sensitive = false) => {
  const value = s.normalize('NFKC').trim().replace(/\s/gu, '');
  return sensitive ? value : value.toLowerCase();
};
const formula = (s: string, sensitive = false) => normalized(s, sensitive).replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
const sortedEqual = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

function parts(input: string, onlyLines = false): string[] | null {
  const raw = newlines(input).trim();
  // Circled digits may themselves be the requested values (e.g. execution order).
  const valueSequence = /^[①-⑳\s,;→|]+$/u.test(raw);
  const labels = valueSequence ? [] : [...raw.matchAll(/[①-⑳]/gu)];
  if (labels.length) {
    if (raw.slice(0, labels[0].index).trim() || labels.some((m, i) => m[0].charCodeAt(0) - '①'.charCodeAt(0) !== i)) return null;
    return labels.map((m, i) => raw.slice(m.index! + 1, labels[i + 1]?.index ?? raw.length).replace(/^[\s:.]+|[\s,;]+$/gu, ''));
  }
  const values = raw.split(onlyLines ? /\n/u : /\s*(?:,|;|\n|→|->|\|)\s*/u);
  return values.map((v, i) => v.trim().replace(new RegExp(`^(?:\\(${i + 1}\\)|${i + 1}[.)]\\s+)\\s*`, 'u'), ''));
}
function matchParts(actual: string[], required: string[][], normalize: (s: string) => string, unordered: boolean) {
  if (actual.length !== required.length || actual.some(v => !v.trim())) return false;
  if (!unordered) return required.every((aliases, i) => aliases.some(alias => normalize(alias) === normalize(actual[i])));
  // At most five items in this registry; each submitted value earns one distinct slot.
  const assign = (index: number, used: Set<number>): boolean => index === actual.length || required.some((aliases, j) =>
    !used.has(j) && aliases.some(alias => normalize(alias) === normalize(actual[index])) && assign(index + 1, new Set([...used, j])));
  return assign(0, new Set());
}
function setValues(input: string, normalize: (s: string) => string) {
  let raw = newlines(input).trim();
  if (raw.startsWith('{') && raw.endsWith('}')) raw = raw.slice(1, -1);
  if (/[{}]/u.test(raw)) return null;
  const values = raw.split(/[,\n;]/u).map(v => {
    const item = v.trim();
    return normalize(/^(['"])(.*)\1$/u.test(item) ? item.slice(1, -1) : item);
  });
  return values.every(Boolean) ? values : null;
}
function sqlTokens(input: string, ignoreAliases: boolean) {
  const source = newlines(input).trim().replace(/;$/u, '');
  const pattern = /\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|>=|<=|<>|!=|[(),.*=<>+\/-]/guy;
  const tokens: string[] = [];
  while (pattern.lastIndex < source.length) {
    const token = pattern.exec(source)?.[0];
    if (!token) return null;
    if (/^\s+$/u.test(token)) continue;
    tokens.push(token.startsWith("'") ? token : token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"').toLowerCase() : token.toLowerCase());
  }
  if (ignoreAliases) {
    // Only enabled where the supplied question explicitly permits any AS alias.
    for (let i = tokens.length - 2; i >= 0; i--) {
      if (tokens[i] === 'as' && /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(tokens[i + 1])) tokens.splice(i + 1, 1, '<alias>');
    }
  }
  return JSON.stringify(tokens);
}

export function pastAnswerInput(id: number, scope: string) {
  const policy = scope === 'IPEP' ? policies.get(id) : undefined;
  return policy?.active ? { multiline: !['text', 'number', 'formula'].includes(policy.mode), hint: policy.hint, ...multipartPracticalInput(id) } : undefined;
}
export function matchPastAnswer(policy: PastAnswerPolicy, input: string): boolean {
  if (typeof input !== 'string' || !input.trim() || input.length > 16384) return false;
  const normalize = (value: string) => formula(value, policy.caseSensitive);
  const accepted = [policy.answer, ...policy.alternatives];
  if (policy.mode === 'printed') {
    const print = (value: string) => newlines(value).replace(/[\t ]+$/gmu, '').replace(/\n+$/u, '');
    return accepted.some(value => print(value) === print(input));
  }
  if (policy.mode === 'sql') {
    const actual = sqlTokens(input, !!policy.ignoreAliases);
    return actual !== null && accepted.some(value => actual === sqlTokens(value, !!policy.ignoreAliases));
  }
  if (policy.mode === 'phrases') {
    const actual = normalized(input);
    if (policy.reject?.some(value => actual.includes(normalized(value)))) return false;
    return !!policy.groups?.length && policy.groups.every(group => group.some(value => actual.includes(normalized(value))));
  }
  if (policy.mode === 'branch-path') {
    const raw = input.normalize('NFKC').trim();
    if (!/^\d+(?:\s*(?:,|→|->|\n|-)\s*\d+)*$/u.test(raw)) return false;
    const path = raw.match(/\d+/gu)!.map(Number);
    if (path.length > 200 || path[0] !== 1 || path.at(-1) !== 7) return false;
    const traversed = path.slice(1).map((node, i) => `${path[i]},${node}`);
    const edges = new Set(policy.edges?.map(edge => edge.join(',')));
    return traversed.every(edge => edges.has(edge)) && !!policy.requiredEdges?.every(edge => traversed.includes(edge.join(',')));
  }
  if (['set', 'python-set'].includes(policy.mode)) {
    const actual = setValues(input, normalize), expected = setValues(policy.answer, normalize);
    return !!actual && !!expected && sortedEqual(actual, expected);
  }
  if (policy.mode === 'group-sets') {
    const rows = parts(input, true);
    return !!rows && !!policy.sets && rows.length === policy.sets.length && rows.every((row, i) => {
      const values = setValues(row, normalize);
      return !!values && sortedEqual(values, policy.sets![i].map(normalize));
    });
  }
  if (['parts', 'unordered-parts', 'header-set', 'lines'].includes(policy.mode)) {
    // Explicit full-answer alternatives are independently reviewed, never prefix matches.
    if (policy.alternatives.some(value => normalize(value) === normalize(input.replace(/→|->/gu, ',')))) return true;
    const actual = parts(input, policy.mode === 'lines');
    if (!actual) return false;
    if (policy.optionalHeader && normalize(actual[0]) === normalize(policy.optionalHeader)) actual.shift();
    if (policy.mode === 'header-set') return actual.length === policy.parts.length && policy.parts[0].some(v => normalize(v) === normalize(actual[0])) && matchParts(actual.slice(1), policy.parts.slice(1), normalize, true);
    const partNormalize = policy.mode === 'lines' ? (v: string) => normalize(v.replace(/→|->/gu, ',')) : normalize;
    return matchParts(actual, policy.parts, partNormalize, policy.mode === 'unordered-parts');
  }
  if (accepted.some(value => normalize(value) === normalize(input))) return true;
  if (policy.mode === 'number' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(input.trim())) return Number(input) === Number(policy.answer);
  return false;
}
export async function gradePastAnswer(question: { id: number; examScope: string; kind: string; prompt: string; explanation: string }, input: string) {
  const policy = question.examScope === 'IPEP' && question.kind === 'descriptive' ? policies.get(question.id) : undefined;
  if (!policy?.active) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(question.prompt + '\n' + question.explanation));
  const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== policy.contentSha256) return null;
  const correct = matchPastAnswer(policy, input);
  const multipart = gradePracticalFields(question.id, input, correct);
  if (multipart) return multipart;
  return { correct, result: correct ? 'correct' as const : 'incorrect' as const, score: correct ? 100 : 0,
    feedback: correct ? '입력한 답이 등록된 채점 기준에 맞습니다.' : '등록된 허용 답안과 일치하지 않습니다. 정답·해설과 입력 형식을 확인하세요.' };
}
