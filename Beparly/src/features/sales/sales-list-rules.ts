export type SalesPeriod = 'all' | 'today' | 'week' | 'month' | 'custom';
export type SalesTier = 'all' | 'retail' | 'wholesale';
export type SalesFilters = { period: SalesPeriod; tier: SalesTier; dueOnly: boolean; start: string; end: string };

export const defaultSalesFilters: SalesFilters = { period: 'all', tier: 'all', dueOnly: false, start: '', end: '' };

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function periodBounds(filters: SalesFilters, now = new Date()) {
  if (filters.period === 'custom') return { start: filters.start, end: filters.end };
  if (filters.period === 'all') return { start: '', end: '' };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filters.period === 'week') start.setDate(start.getDate() - start.getDay());
  if (filters.period === 'month') start.setDate(1);
  return { start: localDay(start), end: localDay(now) };
}

export function saleMatchesFilters(sale: { invoice_date?: string | null; created_at: string; status: string; due: string; price_tier: string },
  filters: SalesFilters, bounds = periodBounds(filters)) {
  const date = (sale.invoice_date ?? sale.created_at).slice(0, 10);
  return (!filters.dueOnly || sale.status === 'completed' && Number(sale.due) > 0)
    && (filters.tier === 'all' || sale.price_tier === filters.tier)
    && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end);
}
