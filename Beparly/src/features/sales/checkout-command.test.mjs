import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalPayload, isUnresolved } from './checkout-command.ts';

test('checkout fingerprint is stable across key order and changes with financial payload', () => {
  const first = { location_id: 2, lines: [{ product_id: 'p1', quantity: '2', unit_id: 'carton' }], paid: '20.00' };
  const reordered = { paid: '20.00', lines: [{ unit_id: 'carton', quantity: '2', product_id: 'p1' }], location_id: 2 };
  assert.equal(canonicalPayload(first), canonicalPayload(reordered));
  assert.notEqual(canonicalPayload(first), canonicalPayload({ ...first, lines: [{ ...first.lines[0], quantity: '3' }] }));
  assert.notEqual(canonicalPayload(first), canonicalPayload({ ...first, paid: '19.00' }));
});

test('only confirmed or rejected checkout permits a new local command', () => {
  for (const state of ['prepared', 'sending', 'awaiting_confirmation', 'needs_review']) {
    assert.equal(isUnresolved({ state }), true);
  }
  for (const state of ['confirmed', 'rejected']) assert.equal(isUnresolved({ state }), false);
});
