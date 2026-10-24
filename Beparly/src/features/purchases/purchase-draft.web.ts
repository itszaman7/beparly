import type { PurchaseCatalogItem } from '@/services/api';

const name = (businessId: number, key: string) => `beparly.purchase.${businessId}.${key}`;
export async function loadPurchaseDraft(businessId: number, key: string) {
  return localStorage.getItem(name(businessId, key));
}
export async function savePurchaseDraft(businessId: number, key: string, payload: string) {
  localStorage.setItem(name(businessId, key), payload);
}
export async function clearPurchaseDraft(businessId: number, key: string) {
  localStorage.removeItem(name(businessId, key));
}
export async function cachePurchaseCatalog(businessId: number, items: PurchaseCatalogItem[]) {
  const key = name(businessId, 'catalog');
  const current = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, PurchaseCatalogItem>;
  for (const item of items) current[item.variant_id] = item;
  localStorage.setItem(key, JSON.stringify(current));
}
export async function searchCachedPurchaseCatalog(businessId: number, search: string, page: number) {
  const rows = Object.values(JSON.parse(localStorage.getItem(name(businessId, 'catalog')) || '{}') as Record<string, PurchaseCatalogItem>);
  const term = search.trim().toLowerCase();
  const filtered = rows.filter(row => !term || `${row.name} ${row.variant_label} ${row.sku} ${row.barcode}`.toLowerCase().includes(term))
    .sort((a, b) => `${a.name}${a.variant_label}`.localeCompare(`${b.name}${b.variant_label}`));
  return { items: filtered.slice((page - 1) * 30, page * 30), next_page: filtered.length > page * 30 ? page + 1 : null };
}
