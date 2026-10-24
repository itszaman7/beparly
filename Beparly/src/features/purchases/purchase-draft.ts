import * as SQLite from 'expo-sqlite';
import type { PurchaseCatalogItem } from '@/services/api';

let database: Promise<SQLite.SQLiteDatabase> | null = null;
async function db() {
  database ??= SQLite.openDatabaseAsync('beparly-purchases.db').then(async handle => {
    await handle.execAsync('CREATE TABLE IF NOT EXISTS purchase_draft (business_id INTEGER NOT NULL, draft_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (business_id, draft_key));');
    await handle.execAsync('CREATE TABLE IF NOT EXISTS purchase_catalog (business_id INTEGER NOT NULL, variant_id TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (business_id, variant_id)); CREATE INDEX IF NOT EXISTS purchase_catalog_barcode ON purchase_catalog (business_id, barcode); CREATE INDEX IF NOT EXISTS purchase_catalog_sku ON purchase_catalog (business_id, sku); CREATE INDEX IF NOT EXISTS purchase_catalog_name ON purchase_catalog (business_id, name);');
    return handle;
  });
  return database;
}
export async function loadPurchaseDraft(businessId: number, key: string) {
  const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM purchase_draft WHERE business_id=? AND draft_key=?', businessId, key);
  return row?.payload ?? null;
}
export async function savePurchaseDraft(businessId: number, key: string, payload: string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO purchase_draft (business_id,draft_key,payload) VALUES (?,?,?)', businessId, key, payload);
}
export async function clearPurchaseDraft(businessId: number, key: string) {
  await (await db()).runAsync('DELETE FROM purchase_draft WHERE business_id=? AND draft_key=?', businessId, key);
}
export async function cachePurchaseCatalog(businessId: number, items: PurchaseCatalogItem[]) {
  const handle = await db();
  await handle.withExclusiveTransactionAsync(async tx => {
    for (const item of items) await tx.runAsync('INSERT OR REPLACE INTO purchase_catalog (business_id,variant_id,name,label,sku,barcode,payload) VALUES (?,?,?,?,?,?,?)',
      businessId, item.variant_id, item.name, item.variant_label, item.sku, item.barcode, JSON.stringify(item));
  });
}
export async function searchCachedPurchaseCatalog(businessId: number, search: string, page: number) {
  const term = search.trim();
  const rows = await (await db()).getAllAsync<{ payload: string }>(
    term ? 'SELECT payload FROM purchase_catalog WHERE business_id=? AND (barcode=? OR sku=? OR name LIKE ? OR label LIKE ? OR sku LIKE ?) ORDER BY name,label LIMIT 31 OFFSET ?' :
      'SELECT payload FROM purchase_catalog WHERE business_id=? ORDER BY name,label LIMIT 31 OFFSET ?',
    ...(term ? [businessId, term, term, `%${term}%`, `%${term}%`, `%${term}%`, (page - 1) * 30] : [businessId, (page - 1) * 30]));
  return { items: rows.slice(0, 30).map(row => JSON.parse(row.payload) as PurchaseCatalogItem),
    next_page: rows.length > 30 ? page + 1 : null };
}
