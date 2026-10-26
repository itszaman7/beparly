import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import ts from 'typescript';

globalThis.indexedDB = indexedDB;
const source = await readFile(new URL('./checkout-command-store.web.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace("from './checkout-command'", `from '${new URL('./checkout-command.ts', import.meta.url).href}'`);
const { loadCheckoutCommand, prepareCheckoutCommand, saveCheckoutCommand } = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript)}`);

function command(id, businessId = 1, userId = 1) {
  return { id, businessId, userId, payload: { paid: '10' }, fingerprint: '{"paid":"10"}',
    createdAt: new Date().toISOString(), state: 'prepared', saleId: null, lastError: null, attempts: 0,
    lastAttemptAt: null };
}

test('browser command survives adapter reopen and prevents a second unresolved checkout', async () => {
  const first = command('first');
  await prepareCheckoutCommand(first);
  assert.deepEqual(await loadCheckoutCommand(1, 1), first);
  await assert.rejects(prepareCheckoutCommand(command('second')), /earlier sale needs review/);
  assert.equal(await loadCheckoutCommand(1, 2), null);
  assert.equal(await loadCheckoutCommand(2, 1), null);
  await saveCheckoutCommand({ ...first, state: 'confirmed', saleId: 'sale-1' });
  assert.equal(await loadCheckoutCommand(1, 1), null);
  await prepareCheckoutCommand(command('second'));
});

test('browser storage refuses changes to the immutable command fingerprint', async () => {
  const first = command('immutable', 3, 7);
  await assert.rejects(prepareCheckoutCommand({ ...first, payload: { paid: '20' } }), /fingerprint is invalid/);
  await prepareCheckoutCommand(first);
  await assert.rejects(saveCheckoutCommand({ ...first, fingerprint: 'changed' }), /changed in storage/);
  await assert.rejects(saveCheckoutCommand({ ...first, payload: { paid: '20' } }), /changed in storage/);
  assert.deepEqual(await loadCheckoutCommand(3, 7), first);
});
