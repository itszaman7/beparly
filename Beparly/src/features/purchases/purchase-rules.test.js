import assert from 'node:assert/strict';
import test from 'node:test';
import { lineAmountCents, purchaseAmountCents } from './purchase-rules.js';

test('purchase totals use exact taka and poisha for many cart lines', () => {
  assert.equal(lineAmountCents('2.500', '12.3400'), 3085n);
  assert.equal(purchaseAmountCents(Array.from({ length: 1000 }, () => ({ quantity: '2.500', unitCost: '12.3400' }))), 3085000n);
});

test('rejects a fractional poisha, invalid precision and missing cost', () => {
  assert.equal(lineAmountCents('0.5', '0.01'), null);
  assert.equal(lineAmountCents('1.0001', '10'), null);
  assert.equal(lineAmountCents('1', ''), null);
});
