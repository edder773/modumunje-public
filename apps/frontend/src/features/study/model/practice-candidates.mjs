import {
  dedupeCanonicalQuestions,
  isCanonicalPracticeQuestion,
  isGeneralPracticeQuestion,
  isTheoryOnlyQuestion,
} from "../../../../../../packages/shared/src/content/question-pool.mjs";

function isObjectiveQuestion(question) {
  return question.kind === "single" || question.kind === "multiple";
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function selectSqlPracticeCandidates({
  questions,
  category,
  difficulty,
  practiceKind,
  bookmarkOnly = false,
  questionId,
  theoryId,
  random = Math.random,
}) {
  if (questionId) return questions.filter((question) => question.id === questionId);

  if (theoryId) {
    const linked = questions.filter((question) => question.theoryId === theoryId);
    const pairedChecks = linked.filter(isTheoryOnlyQuestion);
    const theoryCandidates = dedupeCanonicalQuestions(pairedChecks.length ? pairedChecks : linked);
    const filtered = theoryCandidates.filter((question) => practiceKind === "descriptive"
      ? question.kind === "descriptive"
      : practiceKind === "mixed"
        ? true
        : isObjectiveQuestion(question));
    return shuffled(filtered, random).slice(0, 10);
  }

  let candidates = questions.filter(isGeneralPracticeQuestion);
  candidates = candidates.filter(isCanonicalPracticeQuestion);
  if (category !== "전체 과목") {
    candidates = candidates.filter((question) => question.category === category);
  }
  if (difficulty !== "전체" && practiceKind === "objective") {
    candidates = candidates.filter((question) => question.difficulty === difficulty);
  }
  if (difficulty !== "전체" && practiceKind === "mixed") {
    candidates = candidates.filter((question) => (
      question.kind === "descriptive" || question.difficulty === difficulty
    ));
  }
  if (practiceKind === "objective") candidates = candidates.filter(isObjectiveQuestion);
  if (practiceKind === "descriptive") {
    candidates = candidates.filter((question) => question.kind === "descriptive");
  }
  if (bookmarkOnly) candidates = candidates.filter((question) => question.bookmarked);
  return dedupeCanonicalQuestions(shuffled(candidates, random));
}
