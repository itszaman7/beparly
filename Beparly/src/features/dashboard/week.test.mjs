import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart } from './week.ts';

test('business week starts on Sunday across month and year boundaries', () => {
  assert.equal(weekStart('2026-10-25'), '2026-10-25');
  assert.equal(weekStart('2026-10-31'), '2026-10-25');
  assert.equal(weekStart('2026-01-01'), '2025-12-28');
  assert.throws(() => weekStart('2026-02-30'));
});
