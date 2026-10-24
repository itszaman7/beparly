const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validDecimal, formatBdt, setCurrencySymbolVisible } = require('./product-rules');

test('prices distinguish unset and zero and reject invalid precision', () => {
  assert.equal(validDecimal('', 2, true), true);
  assert.equal(validDecimal('0', 2), true);
  assert.equal(validDecimal('20.25', 2), true);
  assert.equal(validDecimal('20.255', 2), false);
  assert.equal(validDecimal('-1', 2), false);
  assert.equal(validDecimal('1e3', 2), false);
});

test('quantities and cost retain their own precision', () => {
  assert.equal(validDecimal('0.001', 3), true);
  assert.equal(validDecimal('0.0001', 3), false);
  assert.equal(validDecimal('25.1234', 4), true);
});

test('BDT formatting uses string arithmetic and preserves zero', () => {
  assert.equal(formatBdt(null), 'Not set');
  assert.equal(formatBdt('0.00'), '৳0.00');
  assert.equal(formatBdt('123456789012345.67'), '৳123,456,789,012,345.67');
  assert.equal(formatBdt('-1234.50'), '৳-1,234.50');
  assert.equal(formatBdt('0E-7'), '৳0.00');
});

test('currency symbol preference changes display without changing the amount', () => {
  setCurrencySymbolVisible(false);
  assert.equal(formatBdt('1234.50'), '1,234.50');
  assert.equal(formatBdt('0.00'), '0.00');
  setCurrencySymbolVisible(true);
  assert.equal(formatBdt('1234.50'), '৳1,234.50');
});

