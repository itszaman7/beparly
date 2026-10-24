import type { Category, Contact, Product, ProductUnit, QuotationInput, StockLocation } from '@/services/api';
type CachedQuotationCustomer = Pick<Contact, 'id' | 'name' | 'phone' | 'address' | 'area' | 'district'>;
export type LocalQuotation = { key: string; serverId: string | null; version: number | null; commandId: string; state: 'pending' | 'conflict' | 'synced'; input: QuotationInput };
const key = (businessId: number, suffix: string) => `beparly.quotation.${businessId}.${suffix}`;
export async function loadQuotationDraft(businessId: number, draftKey: string) {
  const value = localStorage.getItem(key(businessId, `draft.${draftKey}`));
  return value ? JSON.parse(value) as LocalQuotation : null;
}
export async function saveQuotationDraft(businessId: number, draft: LocalQuotation) {
  localStorage.setItem(key(businessId, `draft.${draft.key}`), JSON.stringify(draft));
}
export async function clearQuotationDraft(businessId: number, draftKey: string) {
  localStorage.removeItem(key(businessId, `draft.${draftKey}`));
}
export async function listQuotationDrafts(businessId: number) {
  const prefix = key(businessId, 'draft.'); const rows: LocalQuotation[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const itemKey = localStorage.key(index);
    if (itemKey?.startsWith(prefix)) rows.push(JSON.parse(localStorage.getItem(itemKey) || '{}') as LocalQuotation);
  }
  return rows;
}
export async function cacheQuotationCatalog(businessId: number, products: Product[]) {
  localStorage.setItem(key(businessId, 'catalog'), JSON.stringify(products));
}
export async function loadQuotationCatalog(businessId: number) {
  return JSON.parse(localStorage.getItem(key(businessId, 'catalog')) || '[]') as Product[];
}
export async function cacheQuotationCategories(businessId: number, categories: Category[]) {
  localStorage.setItem(key(businessId, 'categories'), JSON.stringify(categories));
}
export async function loadQuotationCategories(businessId: number): Promise<Category[]> {
  return JSON.parse(localStorage.getItem(key(businessId, 'categories')) || '[]') as Category[];
}
export async function cacheQuotationOptions(businessId: number, locations: StockLocation[], customers: CachedQuotationCustomer[]) {
  localStorage.setItem(key(businessId, 'options'), JSON.stringify({ locations, customers }));
}
export async function loadQuotationOptions(businessId: number): Promise<{ locations: StockLocation[]; customers: CachedQuotationCustomer[] } | null> {
  const value = localStorage.getItem(key(businessId, 'options'));
  return value ? JSON.parse(value) : null;
}
export async function cacheQuotationUnits(businessId: number, productId: string, variantId: string | undefined, units: ProductUnit[]) {
  localStorage.setItem(key(businessId, `units:${productId}:${variantId ?? ''}`), JSON.stringify(units));
}
export async function loadQuotationUnits(businessId: number, productId: string, variantId?: string): Promise<ProductUnit[]> {
  return JSON.parse(localStorage.getItem(key(businessId, `units:${productId}:${variantId ?? ''}`)) || '[]');
}
