import assert from 'node:assert/strict';
import test from 'node:test';
import { guestImportPayloadDigest } from '../apps/backend/src/modules/study/study-guest-import-digest';
import { backupTableSpec, BACKUP_SCHEMA_VERSION, supportedBackupSchema } from '../packages/shared/src/admin/backup-contract.mjs';

test('digest binds the normalized import payload and changes with actual records', async () => {
  const payload = { selectedExam: 'SQLD', bookmarks: [7, 5, 7], attempts: [{ questionId: 9, selectedAnswers: [1,0], mode: 'practice', examType: 'SQLD', createdAt: '2026-09-29T00:00:00Z' }] };
  const first = await guestImportPayloadDigest(payload);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(await guestImportPayloadDigest({ ...payload, bookmarks: [5,7], attempts: [{ ...payload.attempts[0], selectedAnswers: [0,1] }] }), first);
  assert.notEqual(await guestImportPayloadDigest({ ...payload, attempts: [{ ...payload.attempts[0], selectedAnswers: [1] }] }), first);
  assert.notEqual(await guestImportPayloadDigest({ ...payload, selectedExam: 'SQLP' }), first);
});

test('old backup schemas keep the three-column guest marker shape', () => {
  assert.equal(BACKUP_SCHEMA_VERSION, 'admin-9');
  for (const oldVersion of ['admin-8', 'admin-7', 'admin-6']) {
    assert.equal(supportedBackupSchema(oldVersion), true);
    assert.deepEqual(backupTableSpec('guest_import_batches', oldVersion)?.columns,
      ['user_key', 'import_id', 'imported_at']);
  }
  assert.deepEqual(backupTableSpec('guest_import_batches')?.columns,
    ['user_key', 'import_id', 'imported_at']);
  assert.deepEqual(backupTableSpec('guest_import_receipts')?.columns,
    ['user_key', 'import_id', 'payload_digest', 'imported_at']);
  for (const oldVersion of ['admin-8', 'admin-7', 'admin-6']) {
    assert.equal(backupTableSpec('guest_import_receipts', oldVersion), undefined);
  }
});
