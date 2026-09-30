import type {
  ExamResult,
  ExamResultBreakdown,
  EvaluationVerdict,
} from "@shared/study/study-domain";
export function buildExamResultBreakdown<TQuestion>(
  results: ExamResult["questionResults"],
  questions: ReadonlyMap<number, TQuestion>,
  keyFor: (question: TQuestion) => string,
): ExamResultBreakdown {
  return results.reduce<ExamResultBreakdown>((rows, item) => {
    const question = questions.get(item.questionId);
    if (!question) return rows;
    const key = keyFor(question);
    const current = rows[key] ?? { total: 0, correct: 0 };
    current.total += 1;
    if (item.result === "correct") current.correct += 1;
    rows[key] = current;
    return rows;
  }, {});
}

export function rounded(value: number, decimals: number) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function selfAssessmentVerdict(score: number): EvaluationVerdict {
  if (score >= 80) return "correct";
  if (score >= 40) return "partial";
  return "incorrect";
}

export * from "@shared/study/study-domain";
