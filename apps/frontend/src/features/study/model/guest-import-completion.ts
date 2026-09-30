import type { GuestLearningState } from "../persistence/guest-learning-store";

export type GuestImportCompletion = {
  ok?: boolean;
  imported?: boolean;
  duplicate?: boolean;
  verified?: boolean;
  deferred?: boolean;
  bookmarks?: number;
  attempts?: number;
  theoryProgress?: number;
};

export function guestImportCompletedForSnapshot(
  submitted: GuestLearningState,
  result: GuestImportCompletion,
) {
  return result.ok === true && result.imported === true && result.verified === true
    && result.bookmarks === submitted.bookmarks.length
    && result.attempts === submitted.attempts.length
    && result.theoryProgress === 0;
}
