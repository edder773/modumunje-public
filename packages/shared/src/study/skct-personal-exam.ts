// Independent cognitive practice configuration; actual recruitment instructions take precedence.
export const SKCT_MOCK_UNITS = ["U01", "U02", "U03", "U04", "U05"] as const;
export const SKCT_MOCK_SECTION_QUESTIONS = 20;
export const SKCT_MOCK_SECTION_SECONDS = 15 * 60;
export const SKCT_MOCK_BREAK_SECONDS = 60;
export const SKCT_MOCK_QUESTION_COUNT = SKCT_MOCK_UNITS.length * SKCT_MOCK_SECTION_QUESTIONS;
export type SkctFullMock = {
  sectionIndex: number;
  phase: "answering" | "break" | "completed";
  sectionDeadlineAt: string | null;
  breakUntil: string | null;
  serverNow: string;
};
