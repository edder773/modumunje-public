export type SqlPracticeCandidate = {
  id: number;
  category: string;
  difficulty: string;
  kind: "single" | "multiple" | "descriptive";
  theoryId: number | null;
  practiceScope: "general" | "theory_only";
  variantGroupId?: string | null;
  bookmarked: boolean;
};

export function selectSqlPracticeCandidates<T extends SqlPracticeCandidate>(input: {
  questions: T[];
  category: string;
  difficulty: string;
  practiceKind: "objective" | "descriptive" | "mixed";
  bookmarkOnly?: boolean;
  questionId?: number;
  theoryId?: number;
  random?: () => number;
}): T[];
