import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUEST_IMPORT_PENDING_KEY, GUEST_IMPORT_RECEIPT_PREFIX, GUEST_LEARNING_STORAGE_KEY,
  pendingGuestImportSnapshot, readGuestLearningState,
  reconcileGuestImportSnapshot, stageGuestImportSnapshot, writeGuestLearningState,
  type GuestLearningState,
} from '../apps/frontend/src/features/study/persistence/guest-learning-store';

function localStorage() {
  const data = new Map<string,string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key,value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const attempt = (id: number): GuestLearningState['attempts'][number] => ({
  id, questionId: id, selectedAnswers: [0], correct: false, mode: 'practice',
  userKey: 'guest', examType: 'SQLD', result: 'incorrect', score: 0, answerText: '',
  evaluationId: null, reviewStatus: 'pending', createdAt: '2026-09-29T00:00:00Z',
});
const owner = 'account-hash-001';

function setup(original: GuestLearningState) {
  const storage = localStorage();
  (globalThis as unknown as {window: unknown}).window = { localStorage: storage };
  writeGuestLearningState(original);
  return storage;
}

test('lost response reuses the account-bound pending snapshot and receipt leaves raw draft untouched', () => {
  const original = { version: 1, importId: 'guest_import_snapshot_001', selectedExam: 'SQLD', bookmarks: [12], attempts: [attempt(1)], theoryProgress: [] } as GuestLearningState;
  const storage = setup(original);
  const pending = stageGuestImportSnapshot(readGuestLearningState(), owner);
  assert.deepEqual(stageGuestImportSnapshot(readGuestLearningState(), owner), pending);
  assert.throws(() => pendingGuestImportSnapshot('other-account'));
  writeGuestLearningState({ ...original, bookmarks: [12,13], attempts: [attempt(1),attempt(2)] } as GuestLearningState);
  const rawBefore = storage.getItem(GUEST_LEARNING_STORAGE_KEY);
  assert.equal(reconcileGuestImportSnapshot(pending, owner), true);
  assert.equal(storage.getItem(GUEST_LEARNING_STORAGE_KEY), rawBefore);
  const remaining = readGuestLearningState();
  assert.deepEqual(remaining.bookmarks, [13]);
  assert.deepEqual(remaining.attempts, [attempt(2)]);
  assert.notEqual(remaining.importId, original.importId);
  assert.equal(storage.getItem(GUEST_IMPORT_PENDING_KEY), null);
  assert.ok(storage.getItem(`${GUEST_IMPORT_RECEIPT_PREFIX}${original.importId}`));
  assert.deepEqual(readGuestLearningState(), remaining);
  writeGuestLearningState(remaining);
  assert.deepEqual(readGuestLearningState(), remaining);
});

test('modified attempt with same ID and new attempt arriving during receipt write survive', () => {
  const original = { version: 1, importId: 'guest_import_snapshot_002', selectedExam: 'SQLD', bookmarks: [], attempts: [attempt(1)], theoryProgress: [] } as GuestLearningState;
  const storage = setup(original);
  const pending = stageGuestImportSnapshot(original, owner);
  const edited = { ...attempt(1), selectedAnswers: [1] };
  let appended = false;
  const storageWithConcurrentWriter = {
    ...storage,
    setItem: (key: string, value: string) => {
      storage.setItem(key, value);
      if (key.startsWith(GUEST_IMPORT_RECEIPT_PREFIX) && !appended) {
        appended = true;
        storage.setItem(GUEST_LEARNING_STORAGE_KEY, JSON.stringify({ ...original, attempts: [attempt(1), edited, attempt(3)] }));
      }
    },
  };
  (globalThis as unknown as {window: unknown}).window = { localStorage: storageWithConcurrentWriter };
  assert.equal(reconcileGuestImportSnapshot(pending, owner), true);
  assert.equal(appended, true);
  const rawAfter = storage.getItem(GUEST_LEARNING_STORAGE_KEY);
  assert.deepEqual(readGuestLearningState().attempts, [edited, attempt(3)]);
  const nextId = readGuestLearningState().importId;
  assert.equal(readGuestLearningState().importId, nextId);
  assert.equal(storage.getItem(GUEST_LEARNING_STORAGE_KEY), rawAfter);
  const nextPending = stageGuestImportSnapshot(readGuestLearningState(), owner);
  assert.equal(nextPending.importId, nextId);
  assert.deepEqual(nextPending.attempts, [edited, attempt(3)]);
  assert.equal(reconcileGuestImportSnapshot(nextPending, owner), true);
  assert.deepEqual(readGuestLearningState().attempts, []);
  assert.equal(storage.getItem(GUEST_LEARNING_STORAGE_KEY), rawAfter);
});

test('same receipt replay is idempotent and residual gets one stable next ID', () => {
  const original = { version: 1, importId: 'guest_import_snapshot_003', selectedExam: 'SQLD', bookmarks: [], attempts: [attempt(1)], theoryProgress: [] } as GuestLearningState;
  const storage = setup(original);
  const pending = stageGuestImportSnapshot(original, owner);
  assert.equal(reconcileGuestImportSnapshot(pending, owner), true);
  const first = readGuestLearningState();
  assert.deepEqual(first.attempts, []);
  const receiptRaw = storage.getItem(`${GUEST_IMPORT_RECEIPT_PREFIX}${original.importId}`);
  assert.deepEqual(readGuestLearningState(), first);
  assert.equal(storage.getItem(`${GUEST_IMPORT_RECEIPT_PREFIX}${original.importId}`), receiptRaw);
  assert.equal(reconcileGuestImportSnapshot(pending, owner), false);
  assert.deepEqual(readGuestLearningState(), first);
});

test('bookmark removed and re-added after the submitted snapshot remains a new guest intent', () => {
  const original = { version: 1, importId: 'guest_import_snapshot_004', selectedExam: 'SQLD',
    bookmarks: [12], attempts: [], theoryProgress: [] } as GuestLearningState;
  const storage = setup(original);
  const submitted = stageGuestImportSnapshot(readGuestLearningState(), owner);
  const before = submitted.bookmarkAddTokens?.['12'];
  writeGuestLearningState({ ...readGuestLearningState(), bookmarks: [] });
  writeGuestLearningState({ ...readGuestLearningState(), bookmarks: [12] });
  const renewed = readGuestLearningState();
  assert.notEqual(renewed.bookmarkAddTokens?.['12'], before);
  const rawBefore = storage.getItem(GUEST_LEARNING_STORAGE_KEY);
  assert.equal(reconcileGuestImportSnapshot(submitted, owner), true);
  const residual = readGuestLearningState();
  assert.deepEqual(residual.bookmarks, [12]);
  assert.notEqual(residual.importId, submitted.importId);
  assert.equal(storage.getItem(GUEST_LEARNING_STORAGE_KEY), rawBefore);
  assert.deepEqual(readGuestLearningState(), residual);
});

test('a corrupt receipt leaves raw guest records intact and returns an explicit recovery error', () => {
  const original = { version: 1, importId: 'guest_import_snapshot_005', selectedExam: 'SQLD',
    bookmarks: [12], attempts: [attempt(1)], theoryProgress: [] } as GuestLearningState;
  const storage = setup(original);
  const rawBefore = storage.getItem(GUEST_LEARNING_STORAGE_KEY);
  storage.setItem(`${GUEST_IMPORT_RECEIPT_PREFIX}${original.importId}`, '{invalid-json');
  const result = readGuestLearningState();
  assert.deepEqual(result.bookmarks, [12]);
  assert.deepEqual(result.attempts, [attempt(1)]);
  assert.match(result.recoveryError ?? '', /영수증 오류/u);
  assert.equal(storage.getItem(GUEST_LEARNING_STORAGE_KEY), rawBefore);
});
