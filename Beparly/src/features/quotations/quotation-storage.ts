import * as SQLite from 'expo-sqlite';
import type { Category, Contact, Product, ProductUnit, QuotationInput, StockLocation } from '@/services/api';
type CachedQuotationCustomer = Pick<Contact, 'id' | 'name' | 'phone' | 'address' | 'area' | 'district'>;

export type LocalQuotation = { key: string; serverId: string | null; version: number | null; commandId: string; state: 'pending' | 'conflict' | 'synced'; input: QuotationInput };

let database: Promise<SQLite.SQLiteDatabase> | null = null;
async function db() {
  database ??= SQLite.openDatabaseAsync('beparly-quotations.db').then(async handle => {
    await handle.execAsync('CREATE TABLE IF NOT EXISTS quotation_draft (business_id INTEGER NOT NULL, draft_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (business_id, draft_key)); CREATE TABLE IF NOT EXISTS quotation_catalog (business_id INTEGER NOT NULL, product_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (business_id, product_id)); CREATE TABLE IF NOT EXISTS quotation_cache (business_id INTEGER NOT NULL, cache_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (business_id, cache_key));');
    return handle;
  });
  return database;
}
export async function loadQuotationDraft(businessId: number, key: string) {
  const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM quotation_draft WHERE business_id=? AND draft_key=?', businessId, key);
  return row ? JSON.parse(row.payload) as LocalQuotation : null;
}
export async function saveQuotationDraft(businessId: number, draft: LocalQuotation) {
  await (await db()).runAsync('INSERT OR REPLACE INTO quotation_draft (business_id,draft_key,payload) VALUES (?,?,?)', businessId, draft.key, JSON.stringify(draft));
}
export async function clearQuotationDraft(businessId: number, key: string) {
  await (await db()).runAsync('DELETE FROM quotation_draft WHERE business_id=? AND draft_key=?', businessId, key);
}
export async function listQuotationDrafts(businessId: number) {
  const rows = await (await db()).getAllAsync<{ payload: string }>('SELECT payload FROM quotation_draft WHERE business_id=?', businessId);
  return rows.map(row => JSON.parse(row.payload) as LocalQuotation);
}
export async function cacheQuotationCatalog(businessId: number, products: Product[]) {
  const handle = await db();
  await handle.withExclusiveTransactionAsync(async tx => {
    for (const product of products) await tx.runAsync('INSERT OR REPLACE INTO quotation_catalog (business_id,product_id,payload) VALUES (?,?,?)', businessId, product.id, JSON.stringify(product));
  });
}
export async function loadQuotationCatalog(businessId: number) {
  const rows = await (await db()).getAllAsync<{ payload: string }>('SELECT payload FROM quotation_catalog WHERE business_id=?', businessId);
  return rows.map(row => JSON.parse(row.payload) as Product);
}
export async function cacheQuotationCategories(businessId: number, categories: Category[]) {
  await (await db()).runAsync('INSERT OR REPLACE INTO quotation_cache (business_id,cache_key,payload) VALUES (?,?,?)', businessId, 'categories', JSON.stringify(categories));
}
export async function loadQuotationCategories(businessId: number): Promise<Category[]> {
  const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM quotation_cache WHERE business_id=? AND cache_key=?', businessId, 'categories');
  return row ? JSON.parse(row.payload) as Category[] : [];
}
export async function cacheQuotationOptions(businessId: number, locations: StockLocation[], customers: CachedQuotationCustomer[]) {
  await (await db()).runAsync('INSERT OR REPLACE INTO quotation_cache (business_id,cache_key,payload) VALUES (?,?,?)', businessId, 'options', JSON.stringify({ locations, customers }));
}
export async function loadQuotationOptions(businessId: number): Promise<{ locations: StockLocation[]; customers: CachedQuotationCustomer[] } | null> {
  const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM quotation_cache WHERE business_id=? AND cache_key=?', businessId, 'options');
  return row ? JSON.parse(row.payload) : null;
}
export async function cacheQuotationUnits(businessId: number, productId: string, variantId: string | undefined, units: ProductUnit[]) {
  await (await db()).runAsync('INSERT OR REPLACE INTO quotation_cache (business_id,cache_key,payload) VALUES (?,?,?)', businessId, `units:${productId}:${variantId ?? ''}`, JSON.stringify(units));
}
export async function loadQuotationUnits(businessId: number, productId: string, variantId?: string): Promise<ProductUnit[]> {
  const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM quotation_cache WHERE business_id=? AND cache_key=?', businessId, `units:${productId}:${variantId ?? ''}`);
  return row ? JSON.parse(row.payload) : [];
}
