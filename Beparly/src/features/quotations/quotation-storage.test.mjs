import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const storage = await import('./quotation-storage.web.ts');

test('quotation drafts survive reload and remain business scoped', async () => {
  values.clear();
  const input = { location_id: 3, price_tier: 'retail', discount: '0', delivery_fee: '0', lines: [{ product_id: 'p1', quantity: '2' }] };
  const pending = { key: 'new', serverId: null, version: null, commandId: 'one', state: 'pending', input };
  await storage.saveQuotationDraft(11, pending);
  assert.deepEqual(await storage.loadQuotationDraft(11, 'new'), pending);
  assert.equal(await storage.loadQuotationDraft(12, 'new'), null);
  await storage.saveQuotationDraft(11, { ...pending, state: 'conflict' });
  assert.equal((await storage.listQuotationDrafts(11))[0].state, 'conflict');
  await storage.clearQuotationDraft(11, 'new');
  assert.deepEqual(await storage.listQuotationDrafts(11), []);
});

test('cached catalog, contacts and package units remain business scoped', async () => {
  values.clear();
  await storage.cacheQuotationCatalog(11, [{ id: 'p1', name: 'সাবান' }]);
  await storage.cacheQuotationOptions(11, [{ id: 3, name: 'Shop' }], [{ id: 'c1', name: 'Rahim' }]);
  await storage.cacheQuotationUnits(11, 'p1', 'v1', [{ id: 'u1', name: 'Box', factor: '2' }]);
  assert.equal((await storage.loadQuotationCatalog(11))[0].name, 'সাবান');
  assert.equal((await storage.loadQuotationOptions(11)).locations[0].id, 3);
  assert.equal((await storage.loadQuotationUnits(11, 'p1', 'v1'))[0].factor, '2');
  assert.deepEqual(await storage.loadQuotationUnits(12, 'p1', 'v1'), []);
});
