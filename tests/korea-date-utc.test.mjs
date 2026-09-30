import assert from 'node:assert/strict';
import test from 'node:test';
import { koreaDateKey, parseUtcDate } from '../packages/shared/src/date/korea-date.mjs';

const koreaTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: true,
});

test('SQLite UTC timestamps and explicit ISO UTC render the same KST time', () => {
  const sqlite = '2026-09-28 07:57:53';
  const iso = '2026-09-28T07:57:53Z';
  assert.equal(parseUtcDate(sqlite).toISOString(), iso.replace('Z', '.000Z'));
  assert.equal(koreaTime.format(parseUtcDate(sqlite)), koreaTime.format(parseUtcDate(iso)));
  assert.match(koreaTime.format(parseUtcDate(sqlite)), /04:57/u);
});

test('late KST practice stays on the same Korean calendar day', () => {
  assert.equal(koreaDateKey('2026-09-28 14:30:00'), '2026-09-28');
  assert.equal(koreaDateKey('2026-09-28T14:30:00Z'), '2026-09-28');
});
