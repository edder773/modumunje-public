import assert from 'node:assert/strict';
import test from 'node:test';
import { guestImportCompletedForSnapshot } from '../apps/frontend/src/features/study/model/guest-import-completion';
import type { GuestLearningState } from '../apps/frontend/src/features/study/persistence/guest-learning-store';

const draft: GuestLearningState = {
  version: 1, importId: 'guest_import_client_001', selectedExam: 'SQLD',
  bookmarks: [12], attempts: [{ id: 1, questionId: 13, selectedAnswers: [0] } as GuestLearningState['attempts'][number]],
  theoryProgress: [],
};

test('only complete verified receipt accepts an immutable submitted snapshot', () => {
  const complete = { ok: true, imported: true, verified: true, bookmarks: 1, attempts: 1, theoryProgress: 0 };
  assert.equal(guestImportCompletedForSnapshot(draft, complete), true);
  assert.equal(guestImportCompletedForSnapshot(draft, { ...complete, duplicate: true }), true);
  assert.equal(guestImportCompletedForSnapshot(draft, { ok: true, imported: false, deferred: true }), false);
  assert.equal(guestImportCompletedForSnapshot(draft, { ...complete, verified: false }), false);
  assert.equal(guestImportCompletedForSnapshot(draft, { ...complete, attempts: 0 }), false);
  assert.equal(guestImportCompletedForSnapshot(draft, { ...complete, bookmarks: 0 }), false);
});
