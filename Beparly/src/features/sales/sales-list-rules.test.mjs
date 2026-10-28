import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./sales-list-rules.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const rules = {};
new Function('exports', compiled)(rules);

const sale = { invoice_date: '2026-10-28', created_at: '2026-10-28T14:00:00Z', status: 'completed', due: '20.00', price_tier: 'retail' };
const filter = (changes = {}) => ({ ...rules.defaultSalesFilters, ...changes });

test('preset periods use inclusive local calendar boundaries', () => {
  const now = new Date(2026, 9, 28, 12);
  assert.deepEqual(rules.periodBounds(filter({ period: 'today' }), now), { start: '2026-10-28', end: '2026-10-28' });
  assert.deepEqual(rules.periodBounds(filter({ period: 'week' }), now), { start: '2026-10-25', end: '2026-10-28' });
  assert.deepEqual(rules.periodBounds(filter({ period: 'month' }), now), { start: '2026-10-01', end: '2026-10-28' });
});

test('custom range includes its endpoints and excludes outside dates', () => {
  const selected = filter({ period: 'custom', start: '2026-10-27', end: '2026-10-28' });
  assert.equal(rules.saleMatchesFilters(sale, selected), true);
  assert.equal(rules.saleMatchesFilters({ ...sale, invoice_date: '2026-10-26' }, selected), false);
  assert.equal(rules.saleMatchesFilters({ ...sale, invoice_date: '2026-10-29' }, selected), false);
});

test('type and unpaid filters preserve completed sale semantics', () => {
  assert.equal(rules.saleMatchesFilters(sale, filter({ tier: 'retail', dueOnly: true })), true);
  assert.equal(rules.saleMatchesFilters(sale, filter({ tier: 'wholesale' })), false);
  assert.equal(rules.saleMatchesFilters({ ...sale, status: 'draft' }, filter({ dueOnly: true })), false);
  assert.equal(rules.saleMatchesFilters({ ...sale, due: '0.00' }, filter({ dueOnly: true })), false);
});
