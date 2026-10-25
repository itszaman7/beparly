import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumMoney } from './money.ts';

test('sums weekly sale amounts exactly, including returns', () => {
  assert.equal(sumMoney(['0.10', '0.20', '-5.00', '123456789012345.67']), '123456789012340.97');
  assert.equal(sumMoney([]), '0.00');
  assert.throws(() => sumMoney(['not an amount']));
});
