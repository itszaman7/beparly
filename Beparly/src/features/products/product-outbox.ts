import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { api, ApiError, type ProductInput } from '@/services/api';
import { canDeduct, quantityMilli } from '@/features/products/stock-rules';

type Pending = { command_id: string; business_id: number; kind: 'create' | 'update'; product_id: string | null; payload: string; image_uri: string | null; status: 'pending' | 'rejected'; error: string | null };
let database: Promise<SQLite.SQLiteDatabase> | null = null;

async function db() {
  database ??= SQLite.openDatabaseAsync('beparly-products.db').then(async (handle) => {
    await handle.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS product_outbox (command_id TEXT PRIMARY KEY, business_id INTEGER NOT NULL, kind TEXT NOT NULL, product_id TEXT, payload TEXT NOT NULL, image_uri TEXT, status TEXT NOT NULL DEFAULT "pending", error TEXT);');
    const columns = await handle.getAllAsync<{ name: string }>('PRAGMA table_info(product_outbox)');
    if (!columns.some((column) => column.name === 'status')) await handle.execAsync('ALTER TABLE product_outbox ADD COLUMN status TEXT NOT NULL DEFAULT "pending";');
    if (!columns.some((column) => column.name === 'error')) await handle.execAsync('ALTER TABLE product_outbox ADD COLUMN error TEXT;');
    await handle.execAsync('CREATE TABLE IF NOT EXISTS stock_cache (business_id INTEGER NOT NULL, product_id TEXT NOT NULL, variant_key TEXT NOT NULL, location_id INTEGER NOT NULL, batch_key TEXT NOT NULL, confirmed_milli INTEGER NOT NULL, PRIMARY KEY (business_id,variant_key,location_id,batch_key));');
    await handle.execAsync('CREATE TABLE IF NOT EXISTS stock_outbox (command_id TEXT PRIMARY KEY, business_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, variant_key TEXT NOT NULL, location_id INTEGER NOT NULL, batch_key TEXT NOT NULL, delta_milli INTEGER NOT NULL, status TEXT NOT NULL DEFAULT "pending", error TEXT, created_at TEXT NOT NULL);');
    return handle;
  });
  return database;
}

export type StockKind = 'adjustment' | 'waste' | 'transfer' | 'receipt';
export type StockPayload = { product_id: string; variant_id?: string; location_id: number; quantity: string;
  destination_id?: number; increase?: boolean; unit_cost?: string; reason?: string; batch_id?: string; unit_id?: string };
type StockPending = { command_id: string; business_id: number; kind: StockKind; payload: string; status: 'pending' | 'rejected'; error: string | null;
  variant_key: string; location_id: number; batch_key: string; delta_milli: number };
const key = (data: StockPayload) => data.variant_id ?? data.product_id;
const batchKey = (data: StockPayload) => data.batch_id ?? '';

async function assertSpendable(tx: SQLite.SQLiteDatabase, businessId: number, variantKey: string,
    locationId: number, selectedBatch: string, amount: number) {
  const aggregate = await tx.getFirstAsync<{ confirmed_milli: number }>(
    'SELECT confirmed_milli FROM stock_cache WHERE business_id=? AND variant_key=? AND location_id=? AND batch_key=""',
    businessId, variantKey, locationId);
  const allPending = await tx.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(delta_milli),0) AS total FROM stock_outbox WHERE business_id=? AND variant_key=? AND location_id=? AND status="pending" AND delta_milli<0',
    businessId, variantKey, locationId);
  if (!aggregate || !canDeduct(aggregate.confirmed_milli, allPending?.total ?? 0, amount))
    throw new Error('Offline deduction exceeds confirmed stock at this location.');
  if (selectedBatch) {
    const batch = await tx.getFirstAsync<{ confirmed_milli: number }>(
      'SELECT confirmed_milli FROM stock_cache WHERE business_id=? AND variant_key=? AND location_id=? AND batch_key=?',
      businessId, variantKey, locationId, selectedBatch);
    const batchPending = await tx.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(delta_milli),0) AS total FROM stock_outbox WHERE business_id=? AND variant_key=? AND location_id=? AND batch_key=? AND status="pending" AND delta_milli<0',
      businessId, variantKey, locationId, selectedBatch);
    if (!batch || !canDeduct(batch.confirmed_milli, batchPending?.total ?? 0, amount))
      throw new Error('Offline deduction exceeds confirmed stock in this batch.');
  }
}

export async function cacheConfirmedStock(businessId: number, productId: string, variantId: string | undefined,
    locationId: number, batchId: string | undefined, quantity: string) {
  const handle = await db();
  await handle.runAsync('INSERT OR REPLACE INTO stock_cache (business_id,product_id,variant_key,location_id,batch_key,confirmed_milli) VALUES (?,?,?,?,?,?)',
    businessId, productId, variantId ?? productId, locationId, batchId ?? '', quantityMilli(quantity));
}

export async function queueStock(commandId: string, businessId: number, kind: StockKind, payload: StockPayload, baseQuantity: string) {
  const handle = await db(); const amount = quantityMilli(baseQuantity);
  const delta = kind === 'waste' || kind === 'transfer' || kind === 'adjustment' && !payload.increase ? -amount : amount;
  await handle.withExclusiveTransactionAsync(async (tx) => {
    if (delta < 0) await assertSpendable(tx, businessId, key(payload), payload.location_id, batchKey(payload), amount);
    await tx.runAsync('INSERT INTO stock_outbox (command_id,business_id,kind,payload,variant_key,location_id,batch_key,delta_milli,status,created_at) VALUES (?,?,?,?,?,?,?,?,"pending",?)',
      commandId, businessId, kind, JSON.stringify(payload), key(payload), payload.location_id, batchKey(payload), delta, new Date().toISOString());
  });
}

export async function pendingStock(businessId: number) {
  return (await db()).getAllAsync<StockPending>('SELECT * FROM stock_outbox WHERE business_id=? ORDER BY created_at,command_id', businessId);
}

export async function cancelStock(commandId: string) {
  await (await db()).runAsync('DELETE FROM stock_outbox WHERE command_id=? AND status="rejected"', commandId);
}

export async function correctStock(commandId: string, replacementId: string, quantity: string) {
  const handle = await db(); const requested = quantityMilli(quantity);
  if (requested <= 0) throw new Error('Enter a positive quantity.');
  await handle.withExclusiveTransactionAsync(async (tx) => {
    const item = await tx.getFirstAsync<StockPending>('SELECT * FROM stock_outbox WHERE command_id=? AND status="rejected"', commandId);
    if (!item) throw new Error('Rejected stock command not found.');
    const payload = JSON.parse(item.payload) as StockPayload;
    const oldRequested = quantityMilli(payload.quantity);
    const converted = requested * Math.abs(item.delta_milli) / oldRequested;
    if (!Number.isSafeInteger(converted)) throw new Error('Quantity conversion needs at most three decimal places.');
    const delta = item.delta_milli < 0 ? -converted : converted;
    if (delta < 0) await assertSpendable(tx, item.business_id, item.variant_key, item.location_id, item.batch_key, converted);
    await tx.runAsync('DELETE FROM stock_outbox WHERE command_id=?', commandId);
    await tx.runAsync('INSERT INTO stock_outbox (command_id,business_id,kind,payload,variant_key,location_id,batch_key,delta_milli,status,created_at) VALUES (?,?,?,?,?,?,?,?,"pending",?)',
      replacementId, item.business_id, item.kind, JSON.stringify({ ...payload, quantity }), item.variant_key,
      item.location_id, item.batch_key, delta, new Date().toISOString());
  });
}

export async function syncStock(token: string, businessId: number) {
  const handle = await db(); let done = 0;
  for (const item of await pendingStock(businessId)) {
    if (item.status === 'rejected') continue;
    const payload = JSON.parse(item.payload) as StockPayload;
    try {
      if (item.kind === 'adjustment') await api.adjustment(token, businessId, payload as Parameters<typeof api.adjustment>[2], item.command_id);
      else if (item.kind === 'waste') await api.waste(token, businessId, payload as Parameters<typeof api.waste>[2], item.command_id);
      else if (item.kind === 'transfer') await api.transfer(token, businessId, payload as Parameters<typeof api.transfer>[2], item.command_id);
      else await api.manualReceipt(token, businessId, payload as Parameters<typeof api.manualReceipt>[2], item.command_id);
      await handle.withExclusiveTransactionAsync(async (tx) => {
        // A retry can return an already committed server result after an app crash.
        // Invalidate the old snapshot instead of applying its delta twice.
        await tx.runAsync('DELETE FROM stock_cache WHERE business_id=? AND variant_key=? AND location_id=?',
          businessId, item.variant_key, item.location_id);
        if (item.kind === 'transfer' && payload.destination_id) await tx.runAsync(
          'DELETE FROM stock_cache WHERE business_id=? AND variant_key=? AND location_id=?',
          businessId, item.variant_key, payload.destination_id);
        await tx.runAsync('DELETE FROM stock_outbox WHERE command_id=?', item.command_id);
      }); done++;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 401 && cause.status !== 429) {
        await handle.runAsync('UPDATE stock_outbox SET status="rejected",error=? WHERE command_id=?', cause.message, item.command_id);
        continue;
      }
      throw cause;
    }
  }
  return done;
}

export async function stageProductImage(uri: string, id: string) {
  const directory = new Directory(Paths.document, 'product-images');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${id}.jpg`);
  await new File(uri).copy(destination);
  return destination.uri;
}

export async function queueProduct(commandId: string, businessId: number, kind: 'create' | 'update', productId: string | null, input: ProductInput, imageUri: string | null) {
  const handle = await db();
  await handle.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT OR REPLACE INTO product_outbox (command_id,business_id,kind,product_id,payload,image_uri,status,error) VALUES (?,?,?,?,?,?,"pending",NULL)',
      commandId, businessId, kind, productId, JSON.stringify(input), imageUri);
  });
}

export async function pendingProducts(businessId: number) {
  return (await db()).getAllAsync<Pending>('SELECT * FROM product_outbox WHERE business_id = ? ORDER BY rowid', businessId);
}

export async function cancelProduct(commandId: string) {
  const handle = await db();
  const item = await handle.getFirstAsync<Pending>('SELECT * FROM product_outbox WHERE command_id = ?', commandId);
  await handle.runAsync('DELETE FROM product_outbox WHERE command_id = ?', commandId);
  if (item?.image_uri) { const file = new File(item.image_uri); if (file.exists) file.delete(); }
}

export async function syncProducts(token: string, businessId: number) {
  const handle = await db();
  const pending = await pendingProducts(businessId);
  let done = 0;
  for (const item of pending) {
    if (item.status === 'rejected') continue;
    const input = JSON.parse(item.payload) as ProductInput;
    let productId = item.product_id;
    try {
    if (item.kind === 'create') {
      const result = await api.createProduct(token, businessId, input, item.command_id);
      productId = result.product.id;
      await handle.runAsync('UPDATE product_outbox SET product_id = ? WHERE command_id = ?', productId, item.command_id);
    } else if (item.kind === 'update') {
      if (!productId) throw new Error('Pending product is missing its ID.');
      const { id: _id, product_type: _productType, opening_stock: _openingStock, attributes: _attributes, variants: _variants, ...fields } = input;
      await api.updateProduct(token, businessId, productId, fields, item.command_id);
    }
    if (!productId) throw new Error('Pending product is missing its ID.');
    if (item.image_uri) await api.uploadProductImage(token, businessId, productId, item.image_uri);
    await handle.runAsync('DELETE FROM product_outbox WHERE command_id = ?', item.command_id);
    if (item.image_uri) {
      const file = new File(item.image_uri);
      if (file.exists) file.delete();
    }
    done++;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 401 && cause.status !== 429) {
        await handle.runAsync('UPDATE product_outbox SET status = "rejected", error = ? WHERE command_id = ?', cause.message, item.command_id);
        continue;
      }
      throw cause;
    }
  }
  return done;
}
