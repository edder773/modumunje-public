export type RestorableSwQuestion = {
  id: string;
  theoryId: number;
  subjectId: string;
  choices: string[];
  tags: string[];
};

export type RestorableSwSession = {
  subjectIds: string[];
  theoryId?: number;
  questionIds: string[];
  answers: Record<string, number[]>;
  revealedQuestionIds: string[];
  currentIndex: number;
};

export function requestedSwSessionQuestionIds(questionIds: string[]): string[];

export function restoreSwSessionSnapshot<T extends RestorableSwQuestion>(input: {
  session: RestorableSwSession;
  questions: T[];
  requestedQuestionIds: string[];
  requiredTag?: string;
}): {
  questions: T[];
  answers: Record<string, number[]>;
  revealedQuestionIds: string[];
  currentIndex: number;
  scopeIsComplete: boolean;
  omittedQuestionCount: number;
};
