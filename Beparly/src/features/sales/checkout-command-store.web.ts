import { CheckoutCommand, canonicalPayload, checkoutScope, isUnresolved } from './checkout-command';

const databaseName = 'beparly-checkout-commands';
const storeName = 'commands';

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Persistent browser storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName).createIndex('scope', 'scope');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open checkout storage.'));
  });
}

async function transact<T>(scope: string, mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let value: T;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Checkout storage failed.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Checkout storage was interrupted.')); };
    operation(tx.objectStore(storeName), result => { value = result; }, error => { tx.abort(); reject(error); });
  });
}

export async function loadCheckoutCommand(businessId: number, userId: number): Promise<CheckoutCommand | null> {
  const scope = checkoutScope(businessId, userId);
  return transact(scope, 'readonly', (store, finish) => {
    const request = store.index('scope').getAll(scope);
    request.onsuccess = () => finish(((request.result as StoredCommand[])
      .map(row => row.command).filter(isUnresolved).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]) ?? null);
  });
}

type StoredCommand = { scope: string; command: CheckoutCommand };

export async function prepareCheckoutCommand(command: CheckoutCommand): Promise<CheckoutCommand> {
  if (canonicalPayload(command.payload) !== command.fingerprint) throw new Error('Checkout payload fingerprint is invalid.');
  const scope = checkoutScope(command.businessId, command.userId);
  return transact(scope, 'readwrite', (store, finish, fail) => {
    const request = store.index('scope').getAll(scope);
    request.onsuccess = () => {
      const existing = request.result as StoredCommand[];
      if (existing.some(row => isUnresolved(row.command))) { fail(new Error('An earlier sale needs review before another checkout.')); return; }
      store.put({ scope, command } satisfies StoredCommand, command.id); finish(command);
    };
  });
}

export async function saveCheckoutCommand(command: CheckoutCommand): Promise<void> {
  const scope = checkoutScope(command.businessId, command.userId);
  return transact(scope, 'readwrite', (store, finish, fail) => {
    const request = store.get(command.id);
    request.onsuccess = () => {
      const existing = request.result as StoredCommand | undefined;
      if (!existing || existing.scope !== scope || existing.command.fingerprint !== command.fingerprint ||
          canonicalPayload(command.payload) !== command.fingerprint ||
          canonicalPayload(existing.command.payload) !== command.fingerprint) {
        fail(new Error('Checkout command changed in storage.')); return;
      }
      store.put({ scope, command } satisfies StoredCommand, command.id); finish(undefined);
    };
  });
}
