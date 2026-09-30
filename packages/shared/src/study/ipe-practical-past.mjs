// Public metadata only. Answers and grading policies remain in the backend.
// Retired from new delivery by the content owner. Historical IDs and records stay intact.
export const PRACTICAL_PAST_EXAMS_PUBLISHED = false;
export const PRACTICAL_PAST_RANGE = Object.freeze({ firstId: 88200001, lastId: 88200400 });
export const PRACTICAL_PAST_FORMS = Object.freeze(
  [[2020, 4], [2021, 3], [2022, 3], [2023, 3], [2024, 3], [2025, 3], [2026, 1]]
    .flatMap(([year, count]) => Array.from({ length: count }, (_, index) => ({ year, round: index + 1 })))
    .map(({ year, round }, index) => Object.freeze({
      id: `ipep-past-${year}-${round}`,
      year, round, title: `${year}년 ${round}회`,
      questionIds: Array.from({ length: 20 }, (_, number) => PRACTICAL_PAST_RANGE.firstId + index * 20 + number),
      note: year === 2022 && round === 2 ? '첨부 복원본의 원문 8번과 17번은 같은 코드 문제입니다.' : '',
    })),
);
export function isPracticalPastQuestion(id) {
  const value = Number(id?.id ?? id);
  return Number.isInteger(value) && value >= PRACTICAL_PAST_RANGE.firstId && value <= PRACTICAL_PAST_RANGE.lastId;
}
export function findPracticalPastForm(id) {
  return typeof id === 'string' ? PRACTICAL_PAST_FORMS.find(form => form.id === id) : undefined;
}
export function practicalPastQuestion(id) {
  const value = Number(id);
  if (!isPracticalPastQuestion(value)) return undefined;
  const form = PRACTICAL_PAST_FORMS[Math.floor((value - PRACTICAL_PAST_RANGE.firstId) / 20)];
  return { id: form.id, year: form.year, round: form.round, title: form.title, number: (value - PRACTICAL_PAST_RANGE.firstId) % 20 + 1 };
}
export function practicalPastFormForQuestionIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 20 || new Set(ids).size !== 20) return undefined;
  const question = practicalPastQuestion(ids[0]);
  const form = findPracticalPastForm(question?.id);
  if (!form || !ids.every(id => form.questionIds.includes(id))) return undefined;
  return { id: form.id, year: form.year, round: form.round, title: form.title };
}
/** @template T @param {T[]} items @param {() => number} [random] @returns {T[]} */
export function shuffledExamQuestions(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const target = Math.floor(random() * (i + 1));
    [result[i], result[target]] = [result[target], result[i]];
  }
  return result;
}

export function isHiddenPracticalPastQuestion(id) {
  return !PRACTICAL_PAST_EXAMS_PUBLISHED && isPracticalPastQuestion(id);
}
