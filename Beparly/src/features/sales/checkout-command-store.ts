import * as SQLite from 'expo-sqlite';
import { CheckoutCommand, canonicalPayload, checkoutScope, isUnresolved } from './checkout-command';

let connection: Promise<SQLite.SQLiteDatabase> | null = null;
async function database() {
  connection ??= SQLite.openDatabaseAsync('beparly-checkout.db').then(async db => {
    await db.execAsync('CREATE TABLE IF NOT EXISTS checkout_command (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS checkout_command_scope ON checkout_command (scope, created_at);');
    return db;
  });
  return connection;
}

export async function loadCheckoutCommand(businessId: number, userId: number): Promise<CheckoutCommand | null> {
  const db = await database();
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM checkout_command WHERE scope = ? ORDER BY created_at DESC', checkoutScope(businessId, userId));
  return rows.map(row => JSON.parse(row.payload) as CheckoutCommand).find(isUnresolved) ?? null;
}

export async function prepareCheckoutCommand(command: CheckoutCommand): Promise<CheckoutCommand> {
  if (canonicalPayload(command.payload) !== command.fingerprint) throw new Error('Checkout payload fingerprint is invalid.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async tx => {
    const scope = checkoutScope(command.businessId, command.userId);
    const rows = await tx.getAllAsync<{ payload: string }>('SELECT payload FROM checkout_command WHERE scope = ?', scope);
    if (rows.some(row => isUnresolved(JSON.parse(row.payload) as CheckoutCommand)))
      throw new Error('An earlier sale needs review before another checkout.');
    await tx.runAsync('INSERT INTO checkout_command (id, scope, created_at, payload) VALUES (?, ?, ?, ?)', command.id, scope, command.createdAt, JSON.stringify(command));
  });
  return command;
}

export async function saveCheckoutCommand(command: CheckoutCommand): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async tx => {
    const scope = checkoutScope(command.businessId, command.userId);
    const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM checkout_command WHERE id = ? AND scope = ?', command.id, scope);
    const existing = row ? JSON.parse(row.payload) as CheckoutCommand : null;
    if (!existing || existing.id !== command.id || existing.fingerprint !== command.fingerprint ||
        canonicalPayload(command.payload) !== command.fingerprint || canonicalPayload(existing.payload) !== command.fingerprint)
      throw new Error('Checkout command changed in storage.');
    await tx.runAsync('UPDATE checkout_command SET payload = ? WHERE id = ?', JSON.stringify(command), command.id);
  });
}
