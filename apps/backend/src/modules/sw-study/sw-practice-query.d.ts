export type SwPracticeQueryInput = {
  subjects: string[];
  theoryId: number;
  excludedIds: string[];
  requiredTag: string | null;
  profileOrder: boolean;
  profilePhases: string[];
  limit: number;
};

export function buildSwPracticeQuery(input: SwPracticeQueryInput): {
  sql: string;
  values: Array<string | number>;
};
