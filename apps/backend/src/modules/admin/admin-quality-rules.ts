import {
  extractModelAnswer,
  hasExplicitModelAnswerHeading,
  normalizeComparableContent,
} from "@shared/content/content-format.mjs";

export { hasExplicitModelAnswerHeading };

export function markdownFenceBalanced(value: unknown) {
  const markers = String(value ?? "")
    .split(/\r?\n/u)
    .filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line));
  return markers.length % 2 === 0;
}

export function hasUnsafeLongLine(value: unknown) {
  let insideFence = false;
  for (const line of String(value ?? "").split(/\r?\n/)) {
    if (/^\s{0,3}(?:```|~~~)/u.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (!insideFence && !/^\s*\|/u.test(line) && /\S{140,}/u.test(line)) {
      return true;
    }
  }
  return false;
}

export function normalizedDuplicateKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^\s{0,3}(?:#{1,6}|>)\s?/gmu, " ")
    .replace(/[`*_]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

export function modelAnswerForQuality(value: unknown) {
  const explanation = String(value ?? "");
  const normalizedExtracted = normalizeComparableContent(extractModelAnswer(explanation));
  if (normalizedExtracted.length) return extractModelAnswer(explanation);
  const section = explanation.match(
    /(?:^|\n)#{1,6}\s*(?:모범\s*답안|예시\s*답안|채점\s*답안)\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/iu,
  );
  return section?.[1] ?? "";
}
