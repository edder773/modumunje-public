export function requestedSwSessionQuestionIds(questionIds) {
  return [...new Set(questionIds)].slice(-100);
}

export function restoreSwSessionSnapshot({
  session,
  questions,
  requestedQuestionIds,
  requiredTag,
}) {
  const sessionSubjectIds = new Set(session.subjectIds);
  const requestedIds = new Set(requestedQuestionIds);
  const restoredIds = new Set();
  const scopedQuestions = questions.filter((question) => {
    const inScope = requestedIds.has(question.id)
      && sessionSubjectIds.has(question.subjectId)
      && (!session.theoryId || question.theoryId === session.theoryId)
      && (!requiredTag || question.tags.includes(requiredTag));
    if (!inScope || restoredIds.has(question.id)) return false;
    restoredIds.add(question.id);
    return true;
  });
  const scopeIsComplete = scopedQuestions.length === requestedQuestionIds.length
    && requestedQuestionIds.every((questionId) => restoredIds.has(questionId));
  const restoredAnswers = Object.fromEntries(
    Object.entries(session.answers).filter(([questionId, answer]) => {
      const question = scopedQuestions.find((item) => item.id === questionId);
      return restoredIds.has(questionId)
        && Array.isArray(answer)
        && answer.length > 0
        && answer.every((item) => Number.isInteger(item)
          && item >= 0
          && item < (question?.choices.length ?? 0));
    }),
  );
  const currentQuestionId = session.questionIds[session.currentIndex];
  const restoredIndex = scopedQuestions.findIndex((question) => question.id === currentQuestionId);

  return {
    questions: scopedQuestions,
    answers: restoredAnswers,
    revealedQuestionIds: session.revealedQuestionIds.filter((questionId) => (
      restoredIds.has(questionId) && Boolean(restoredAnswers[questionId]?.length)
    )),
    currentIndex: restoredIndex >= 0 ? restoredIndex : scopedQuestions.length - 1,
    scopeIsComplete,
    omittedQuestionCount: requestedQuestionIds.length - scopedQuestions.length,
  };
}
