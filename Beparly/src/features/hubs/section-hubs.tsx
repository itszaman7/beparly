import { useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';

import { palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { businessToday, periodStart } from '@/features/reports/dates';
import { api, type FinancialSummary, type ProductSummary, type SalesHubSummary, type StockLocation } from '@/services/api';
import { HubActions, HubChart, HubLink, HubMetrics, HubPage, HubSectionTitle, HubState, type ChartBar, type HubAction } from './section-ui';

const money = (value: number | string) => formatBdt(String(value));
const number = (value: string | number) => Number(value) || 0;
function recentDays(today: string) {
  const anchor = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(anchor.getUTCDate() - (6 - index));
    return { key: date.toISOString().slice(0, 10), label: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date) };
  });
}

const salesActions: HubAction[] = [
  { title: 'Sales', caption: 'Invoices and history', icon: 'sale', href: '/sales', color: palette.primaryDeep, background: palette.primarySoft },
  { title: 'New sale', caption: 'Choose retail or wholesale from the sales list', icon: 'receipt', href: '/sales-hub', color: palette.blue, background: palette.blueSoft },
  { title: 'Quotations', caption: 'Offers and estimates', icon: 'duplicate', href: '/sales/quotations', color: palette.purple, background: palette.purpleSoft },
];

export function SalesHub() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [sales, setSales] = useState<SalesHubSummary | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    const scope = `${businessId}:${retry}`;
    let active = true;
    void api.salesHubSummary(token, businessId).then((result) => { if (active) { setSales(result); setLoadedScope(scope); setError(''); } })
      .catch((cause) => { if (active) { setLoadedScope(scope); setError(cause instanceof Error ? cause.message : 'Could not load sales figures.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, businessId, retry]));
  const daily = (sales?.last_seven_days ?? []).map((row) => ({
    label: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${row.date}T12:00:00Z`)),
    value: number(row.amount),
  }));
  const lastWeek = daily.reduce((total, day) => total + day.value, 0);
  const paid = number(sales?.collected_against_sales ?? 0);
  const due = number(sales?.customer_due ?? 0);
  if (!businessId) return <HubPage eyebrow="SELLING" title="Sales" subtitle="Set up a business on Home to see sales." />;
  return <HubPage eyebrow="SELLING" title="Sales" subtitle="Checkout, quotations, and a clear view of recent sales." onRefresh={() => setRetry((value) => value + 1)} refreshing={retry > 0 && loadedScope !== `${businessId}:${retry}`}>
    <HubSectionTitle title="Quick actions" />
    <HubActions actions={salesActions} />
    <HubSectionTitle title="At a glance" detail="Live business data" />
    <HubState loading={loading || loadedScope !== `${businessId}:${retry}`} error={error} onRetry={() => { setLoading(true); setRetry((value) => value + 1); }}>
      <HubMetrics items={[{ label: 'Sales · last 7 days', value: money(lastWeek) }, { label: 'Completed sales', value: String(sales?.completed_sales ?? 0) },
        { label: 'Collected against sales', value: money(paid) }, { label: 'Customer due', value: money(due), color: palette.amber }]} />
      <HubChart title="Sales over the last 7 days" subtitle="Completed sale value by invoice date" bars={daily.map((day) => ({ ...day, display: money(day.value) }))} />
      <HubChart title="Collection position" subtitle="Payments and remaining dues on completed sales" color={palette.blue}
        bars={[{ label: 'Collected', value: paid, display: money(paid) }, { label: 'Due', value: due, display: money(due) }]} />
    </HubState>
    <HubLink title="Open sales history" detail="Browse invoices and customer purchases" href="/sales" />
  </HubPage>;
}

const inventoryActions: HubAction[] = [
  { title: 'Products', caption: 'Catalog and stock', icon: 'products', href: '/products', color: palette.blue, background: palette.blueSoft },
  { title: 'Suppliers', caption: 'Purchases and parties', icon: 'parties', href: '/suppliers', color: palette.orange, background: palette.orangeSoft },
  { title: 'Shops', caption: 'Shop stock locations', icon: 'home', href: '/stock?type=shop', color: palette.primaryDeep, background: palette.primarySoft },
  { title: 'Warehouses', caption: 'Warehouse locations', icon: 'stock', href: '/stock?type=warehouse', color: palette.purple, background: palette.purpleSoft },
];

export function InventoryHub() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    const scope = `${businessId}:${retry}`;
    let active = true;
    void Promise.all([api.productSummary(token, businessId), api.locations(token, businessId)])
      .then(([products, places]) => { if (active) { setSummary(products); setLocations(places.locations); setLoadedScope(scope); setError(''); } })
      .catch((cause) => { if (active) { setLoadedScope(scope); setError(cause instanceof Error ? cause.message : 'Could not load inventory figures.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, businessId, retry]));
  const shops = locations.filter((place) => place.type === 'shop' && place.is_active).length;
  const warehouses = locations.filter((place) => place.type === 'warehouse' && place.is_active).length;
  const active = summary?.active_products ?? 0;
  const low = summary?.low_stock ?? 0;
  const out = summary?.out_of_stock ?? 0;
  const actions = session?.account?.role === 'owner' || session?.account?.can_manage_purchases ? inventoryActions : inventoryActions.filter((action) => action.title !== 'Suppliers');
  if (!businessId) return <HubPage eyebrow="CATALOG & STORAGE" title="Inventory" subtitle="Set up a business on Home to see inventory." />;
  return <HubPage eyebrow="CATALOG & STORAGE" title="Inventory" subtitle="Products and the places you keep them." onRefresh={() => setRetry((value) => value + 1)} refreshing={retry > 0 && loadedScope !== `${businessId}:${retry}`}>
    <HubSectionTitle title="Quick actions" />
    <HubActions actions={actions} />
    <HubSectionTitle title="Stock snapshot" detail="Live business data" />
    <HubState loading={loading || loadedScope !== `${businessId}:${retry}`} error={error} onRetry={() => { setLoading(true); setRetry((value) => value + 1); }}>
      <HubMetrics items={[{ label: 'Active products', value: String(active) }, { label: 'Low stock', value: String(low), color: palette.amber },
        { label: 'Out of stock', value: String(out), color: palette.rose }, { label: 'Active locations', value: String(shops + warehouses) }]} />
      <HubChart title="Stock attention" subtitle="Product counts needing attention" color={palette.orange}
        bars={[{ label: 'Low stock', value: low }, { label: 'Out of stock', value: out }]} empty="No products need stock attention." />
      <HubChart title="Storage locations" subtitle="Active shops and warehouses" color={palette.purple}
        bars={[{ label: 'Shops', value: shops }, { label: 'Warehouses', value: warehouses }]} empty="No active shops or warehouses yet." />
    </HubState>
    <HubLink title="All storage units" detail="View shops, warehouses, and their stock" href="/stock" />
  </HubPage>;
}

const financeActions: HubAction[] = [
  { title: 'Accounts', caption: 'Cash, bank, wallets', icon: 'money', href: '/money/accounts-list', color: palette.primaryDeep, background: palette.primarySoft },
  { title: 'Dues', caption: 'Customer and supplier', icon: 'dues', href: '/dues', color: palette.amber, background: palette.amberSoft },
  { title: 'Receive', caption: 'Record money in', icon: 'receive', href: '/money/new?flow=in', color: palette.blue, background: palette.blueSoft },
  { title: 'Expense', caption: 'Record money out', icon: 'expense', href: '/money/new?flow=expense', color: palette.orange, background: palette.orangeSoft },
  { title: 'Reports', caption: 'Sales and accounting', icon: 'reports', href: '/reports' as Href, color: palette.purple, background: palette.purpleSoft },
];

export function FinanceHub() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const today = businessToday(session?.account?.business.timezone);
  const start = periodStart(today, 'month');
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [moneyState, setMoneyState] = useState<{ available: string; customerDue: number; supplierDue: number } | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId || session?.account?.role !== 'owner') return;
    const scope = `${businessId}:${today}:${retry}`;
    let active = true;
    void Promise.all([api.financialSummary(token, businessId, start, today, 'day'), api.moneyAccounts(token, businessId)])
      .then(([financial, accounts]) => { if (active) { setSummary(financial); setLoadedScope(scope);
        setMoneyState({ available: accounts.available_money,
          customerDue: accounts.party_accounts.filter((item) => item.party_type === 'customer').reduce((sum, item) => sum + Math.max(0, number(item.balance)), 0),
          supplierDue: accounts.party_accounts.filter((item) => item.party_type === 'supplier').reduce((sum, item) => sum + Math.max(0, number(item.balance)), 0) });
        setError(''); } })
      .catch((cause) => { if (active) { setLoadedScope(scope); setError(cause instanceof Error ? cause.message : 'Could not load finance figures.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, businessId, session?.account?.role, start, today, retry]));
  if (session?.account?.role !== 'owner') return <HubPage eyebrow="MONEY" title="Finance" subtitle="Only the business owner can view financial summaries." />;
  const dates = recentDays(today);
  const incomeBars: ChartBar[] = dates.map(({ key, label }) => ({ label, value: number(summary?.rows.find((row) => row.period === key)?.income ?? 0) }));
  const expenseBars: ChartBar[] = dates.map(({ key, label }) => ({ label, value: number(summary?.rows.find((row) => row.period === key)?.other_expenses ?? 0) }));
  return <HubPage eyebrow="MONEY & REPORTS" title="Finance" subtitle="Track balances, dues, income, and expenses." onRefresh={() => setRetry((value) => value + 1)} refreshing={retry > 0 && loadedScope !== `${businessId}:${today}:${retry}`}>
    <HubSectionTitle title="Quick actions" />
    <HubActions actions={financeActions} />
    <HubSectionTitle title="This month" detail="Posted financial data" />
    <HubState loading={loading || loadedScope !== `${businessId}:${today}:${retry}`} error={error} onRetry={() => { setLoading(true); setRetry((value) => value + 1); }}>
      <HubMetrics items={[{ label: 'Available money', value: money(moneyState?.available ?? 0) },
        { label: 'Income', value: money(summary?.totals.income ?? 0) },
        { label: 'Expenses', value: money(summary?.totals.other_expenses ?? 0), color: palette.orange },
        { label: 'Net profit / loss', value: money(summary?.totals.profit_loss ?? 0) }]} />
      <HubChart title="Income · last 7 days" subtitle="Posted income by business day" bars={incomeBars.map((item) => ({ ...item, display: money(item.value) }))} />
      <HubChart title="Expenses · last 7 days" subtitle="Posted operating expenses by business day" color={palette.orange}
        bars={expenseBars.map((item) => ({ ...item, display: money(item.value) }))} />
      <HubChart title="Outstanding dues" subtitle="Open customer and supplier balances" color={palette.amber}
        bars={[{ label: 'To collect', value: moneyState?.customerDue ?? 0, display: money(moneyState?.customerDue ?? 0) },
          { label: 'To pay', value: moneyState?.supplierDue ?? 0, display: money(moneyState?.supplierDue ?? 0) }]} />
    </HubState>
    <HubLink title="Financial reports" detail="See detailed summaries and account activity" href={'/reports' as Href} />
  </HubPage>;
}
