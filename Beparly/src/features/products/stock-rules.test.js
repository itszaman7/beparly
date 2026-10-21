import assert from 'node:assert/strict';
import test from 'node:test';

import { canDeduct, quantityMilli } from './stock-rules.js';

test('offline deductions use only confirmed stock after earlier deductions', () => {
  const confirmed = quantityMilli('5.000');
  const queuedDeduction = -quantityMilli('3.250');
  assert.equal(canDeduct(confirmed, queuedDeduction, quantityMilli('1.750')), true);
  assert.equal(canDeduct(confirmed, queuedDeduction, quantityMilli('1.751')), false);
  // A queued receipt is not included in pending deductions or confirmed stock.
  assert.equal(canDeduct(confirmed, queuedDeduction, quantityMilli('2.000')), false);
});

test('stock quantities keep three decimal places exactly', () => {
  assert.equal(quantityMilli('15.005'), 15005);
  assert.throws(() => quantityMilli('1.0005'));
  assert.throws(() => quantityMilli('-1'));
});
