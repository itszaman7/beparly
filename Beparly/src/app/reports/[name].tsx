import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { DateField } from '@/components/date-field';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { reportItems } from '@/features/reports/catalog';
import { businessToday, periodStart } from '@/features/reports/dates';
import { openSaleDetail, SaleLink } from '@/features/reports/sale-link';
import { releaseWebFocus } from '@/features/reports/web-focus';
import { api, type ReportResponse, type ReportSalePreview, type StockLocation } from '@/services/api';

function iso(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function value(row: Record<string, unknown>, key: string) { return String(row[key] ?? ''); }
function dateValid(text: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; const date = new Date(`${text}T12:00:00`); return !Number.isNaN(date.getTime()) && iso(date) === text; }
function commandId() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => { const n = Math.floor(Math.random() * 16); return (char === 'x' ? n : (n & 3) | 8).toString(16); }); }
const balanceNames = ['current-stock', 'stock-valuation', 'expiry', 'customer-dues', 'supplier-dues', 'balance-sheet', 'trial-balance'];

export default function ReportDetail() {
  const { name, account_code: initialAccount, start_date: initialStart, end_date: initialEnd } = useLocalSearchParams<{ name: string; account_code?: string; start_date?: string; end_date?: string }>();
  const { session } = useAuth();
  const item = reportItems.find((row) => row.name === name);
  const businessId = session?.account?.business.id;
  const today = businessToday(session?.account?.business.timezone);
  const [preset, setPreset] = useState<'today' | 'month' | 'year' | 'custom'>(initialStart && initialEnd ? 'custom' : 'month');
  const [customStart, setCustomStart] = useState(initialStart || periodStart(today, 'month'));
  const [customEnd, setCustomEnd] = useState(initialEnd || today);
  const [accountCode, setAccountCode] = useState(initialAccount ?? '');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [revision, setRevision] = useState<{ id: string; kind: 'sale' | 'purchase'; date: string; reason: string; command: string } | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [savingRevision, setSavingRevision] = useState(false);
  const [state, setState] = useState<{ key: string; data: ReportResponse | null; error: string } | null>(null);
  const start = preset === 'custom' ? customStart : preset === 'today' ? today : periodStart(today, preset === 'year' ? 'year' : 'month');
  const end = preset === 'custom' ? customEnd : today;
  const balance = !!name && balanceNames.includes(name);
  const invalid = !dateValid(start) || !dateValid(end) || start > end;
  const key = `${name}:${businessId}:${start}:${end}:${accountCode}:${locationId}:${page}:${retry}`;
  const loading = state?.key !== key;
  const data = state?.key === key ? state.data : null;
  const error = state?.key === key ? state.error : '';
  useEffect(() => {
    if (!session?.token || !businessId || !item || !name || invalid || session.account?.role !== 'owner' || (name === 'general-ledger' && !accountCode)) return;
    const query = new URLSearchParams();
    if (balance) query.set('as_of', end); else { query.set('start_date', start); query.set('end_date', end); }
    if (name === 'general-ledger') { query.set('as_of', end); query.set('account_code', accountCode); }
    if (locationId && item.group === 'Inventory') query.set('location_id', String(locationId));
    query.set('page', String(page));
    let active = true;
    void api.report(session.token, businessId, name, query).then((result) => {
      if (active) setState({ key, data: result, error: '' });
    }).catch((problem: Error) => { if (active) setState({ key, data: null, error: problem.message }); });
    return () => { active = false; };
  }, [session?.token, session?.account?.role, businessId, item, name, invalid, balance, start, end, accountCode, locationId, page, retry, key]);
  useEffect(() => {
    if (!session?.token || !businessId || item?.group !== 'Inventory') return;
    let active = true;
    void api.locations(session.token, businessId).then((result) => { if (active) setLocations(result.locations); });
    return () => { active = false; };
  }, [session?.token, businessId, item?.group]);
  function selectPreset(next: typeof preset) {
    if (next === 'custom' && preset !== 'custom') { setCustomStart(start); setCustomEnd(end); }
    setPreset(next); setPage(1);
  }
  function openRow(row: Record<string, unknown>) {
    releaseWebFocus();
    const source = value(row, 'source_type');
    const sourceId = value(row, 'source_id') || value(row, 'id');
    if (typeof row.sale_id === 'string') openSaleDetail(row.sale_id);
    else if (name === 'trial-balance' || name === 'balance-sheet') {
      const code = value(row, 'id');
      if (code) router.push({ pathname: '/reports/[name]', params: { name: 'general-ledger', account_code: code } });
    } else if (name === 'daily-sales' && row.date) router.push({ pathname: '/reports/[name]', params: { name: 'sales-summary', start_date: value(row, 'date'), end_date: value(row, 'date') } });
    else if (name === 'best-sellers' && row.product_id) router.push({ pathname: '/reports/sales', params: { start_date: start, end_date: end, product_id: value(row, 'product_id'), ...(row.variant_id ? { variant_id: value(row, 'variant_id') } : {}) } });
    else if (source === 'sale' && sourceId) openSaleDetail(sourceId);
    else if ((source === 'purchase' || name === 'supplier-dues') && sourceId) router.push(`/purchases/${sourceId}` as Href);
    else if (row.product_id) router.push(`/products/${row.product_id}` as Href);
  }
  async function saveRevision() {
    if (!revision || !session?.token || !businessId) return;
    if (!dateValid(revision.date) || !revision.reason.trim()) { setRevisionError('Enter a valid due date and reason.'); return; }
    setSavingRevision(true); setRevisionError('');
    try {
      await api.rescheduleDue(session.token, businessId, revision.kind, revision.id, revision.date, revision.reason.trim(), revision.command);
      setRevision(null); setRetry((n) => n + 1);
    } catch (problem) { setRevisionError(problem instanceof Error ? problem.message : 'Could not update due date.'); }
    finally { setSavingRevision(false); }
  }
  if (session?.account?.role !== 'owner' || !item) return null;
  const rows: Record<string, unknown>[] = data?.rows ?? (data?.groups ? Object.values(data.groups).flat() : []);
  return <SafeAreaView style={styles.safe}><ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={retry > 0 && loading && !invalid} onRefresh={() => setRetry((value) => value + 1)} />}>
    <View style={styles.heading}><Pressable onPress={() => { releaseWebFocus(); router.back(); }} accessibilityRole="button" accessibilityLabel="Back to reports" style={styles.back}><AppSymbol name="back" size={20} color="#15211F" /></Pressable><View style={{ flex: 1 }}><Text style={styles.eyebrow}>{item.group.toUpperCase()}</Text><Text style={styles.title}>{item.title}</Text></View></View>
    <Text style={styles.muted}>{item.subtitle}</Text>
    <View style={styles.controls}><Text style={styles.label}>{balance ? 'AS OF DATE' : 'DATE RANGE'}</Text><View style={styles.choices}>{([['today', 'Today'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom']] as const).map(([id, label]) => <Pressable key={id} onPress={() => selectPreset(id)} accessibilityRole="button" accessibilityState={{ selected: preset === id }} style={[styles.choice, preset === id && styles.chosen]}><Text style={[styles.choiceText, preset === id && styles.chosenText]}>{label}</Text></Pressable>)}</View>
      {preset === 'custom' && <View style={{ gap: 8 }}>
        {!balance && <DateField label="Start date" value={customStart} onChange={(date) => { setCustomStart(date); setPage(1); }} />}
        <DateField label={balance ? 'As of date' : 'End date'} value={customEnd} onChange={(date) => { setCustomEnd(date); setPage(1); }} />
      </View>}
      <Text style={styles.muted}>{balance ? `As of ${end}` : `${start} to ${end} · inclusive`}</Text>
      {name === 'general-ledger' && <TextInput style={styles.input} value={accountCode} onChangeText={(text) => { setAccountCode(text); setPage(1); }} placeholder="Account code" accessibilityLabel="Ledger account code" autoCapitalize="characters" />}
      {item.group === 'Inventory' && <ScrollView horizontal contentContainerStyle={styles.locations}><Pressable onPress={() => { setLocationId(null); setPage(1); }} style={[styles.choice, !locationId && styles.chosen]}><Text style={styles.choiceText}>All locations</Text></Pressable>{locations.map((location) => <Pressable key={location.id} onPress={() => { setLocationId(location.id); setPage(1); }} style={[styles.choice, locationId === location.id && styles.chosen]}><Text style={styles.choiceText}>{location.name}</Text></Pressable>)}</ScrollView>}
    </View>
    {invalid ? <Text style={styles.error}>Choose a valid date range.</Text> : name === 'general-ledger' && !accountCode ? <Text style={styles.muted}>Enter an account code, or open an account from Trial Balance.</Text> : loading ? <View style={styles.state}><ActivityIndicator color="#006D64" /><Text style={styles.muted}>Loading report…</Text></View> : error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={() => setRetry((n) => n + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : data?.available === false ? <View style={styles.notice}><AppSymbol name="warning" size={20} color="#744C12" /><Text style={styles.muted}>{data.reason}</Text></View> : data && <>
      {data.reconciled === false && <View style={styles.notice}><AppSymbol name="warning" size={20} color="#A62925" /><Text style={styles.error}>Reconciliation difference found. Review the underlying records before using this total.</Text></View>}
      <View style={styles.totals}>{[
        ['Total', data.total], ['Outstanding', data.total_outstanding], ['Advances', data.advances],
        ['Stock value', data.value], ['Inventory ledger', data.ledger_value], ['Quantity', data.total_quantity],
        ['Expired awaiting disposal', data.expired_awaiting_disposal], ['Expired stock cost', data.expired_awaiting_disposal_cost],
        ['Recognized write-offs', data.recognized_write_off_quantity], ['Write-off cost', data.recognized_write_off_cost],
        ['Recorded cost', data.total_cost], ['Assets', data.assets], ['Liabilities', data.liabilities],
        ['Equity', data.equity], ['Current earnings', data.current_earnings],
        ['Opening balance', data.opening_balance], ['Closing balance', data.closing_balance],
        ['Debits', data.total_debit], ['Credits', data.total_credit],
        ['Net sales', data.profit_metrics?.net_sales], ['Other income', data.profit_metrics?.other_income],
        ['Product cost', data.totals?.product_cost], ['Gross profit', data.profit_metrics?.gross_profit],
        ['Other expenses', data.totals?.other_expenses], ['Net profit', data.totals?.profit_loss],
      ].filter((entry) => entry[1] !== undefined && entry[1] !== null).map(([label, amount]) => <View key={label} style={styles.totalRow}><Text style={styles.muted}>{label}</Text><Text style={styles.amount}>{['Quantity', 'Expired awaiting disposal', 'Recognized write-offs'].includes(label || '') ? amount : formatBdt(amount || '0')}</Text></View>)}
      {data.buckets && Object.entries(data.buckets).map(([bucket, amount]) => <View key={bucket} style={styles.totalRow}><Text style={styles.muted}>{bucket.replaceAll('_', ' ')}</Text><Text style={styles.amount}>{formatBdt(amount)}</Text></View>)}
      </View>
      <Pressable accessibilityRole="link" onPress={() => { releaseWebFocus(); router.push({ pathname: '/reports/sales', params: balance ? { as_of: end, ...(locationId && item.group === 'Inventory' ? { location_id: String(locationId) } : {}) } : { start_date: start, end_date: end, ...(locationId && item.group === 'Inventory' ? { location_id: String(locationId) } : {}) } }); }} style={styles.browseSales}><Text style={styles.browseTitle}>Browse sales for these dates →</Text><Text style={styles.muted}>Each sale opens customer, products and payment details.</Text></Pressable>
      <Text style={styles.section}>Details {data.page ? `· page ${data.page}` : ''}</Text>
      {rows.length === 0 ? <View style={styles.card}><Text style={styles.muted}>No posted records for these dates.</Text></View> : rows.map((row, index) => {
        const title = value(row, 'name') || value(row, 'contact_name') || value(row, 'description') || value(row, 'date') || value(row, 'period') || value(row, 'id');
        const amount = value(row, 'amount') || value(row, 'value') || value(row, 'outstanding') || value(row, 'running_balance') || value(row, 'profit_loss') || value(row, 'quantity');
        return <View key={`${value(row, 'id') || value(row, 'date')}-${index}`} style={styles.card}><Pressable onPress={() => openRow(row)} accessibilityRole="button" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.muted}>{[value(row, 'variant'), value(row, 'date') || value(row, 'event_date'), value(row, 'number'), value(row, 'type') || value(row, 'bucket'), row.due_date !== undefined ? `Due ${value(row, 'due_date') || 'date not set'}` : '', row.expires_on ? `Expires ${value(row, 'expires_on')}` : '', row.status ? value(row, 'status').replaceAll('_', ' ') : '', row.quantity !== undefined && row.value !== undefined ? `${value(row, 'quantity')} units` : '', row.debit !== undefined ? `Dr ${formatBdt(value(row, 'debit'))}` : '', row.credit !== undefined ? `Cr ${formatBdt(value(row, 'credit'))}` : ''].filter(Boolean).join(' · ')}</Text></View><Text style={styles.amount}>{amount && (row.quantity !== undefined && !row.amount && !row.value && !row.outstanding && !row.running_balance ? amount : formatBdt(amount))}</Text><AppSymbol name="chevron" size={15} color="#52635E" /></Pressable>{typeof row.sale_id === 'string' && <SaleLink sale={row as ReportSalePreview} compact />}{(name === 'customer-dues' || name === 'supplier-dues') && row.document_type !== 'opening' && <Pressable accessibilityRole="button" onPress={() => { setRevision({ id: value(row, 'id'), kind: name === 'customer-dues' ? 'sale' : 'purchase', date: value(row, 'due_date'), reason: '', command: commandId() }); setRevisionError(''); }}><Text style={styles.link}>Reschedule</Text></Pressable>}</View>;
      })}
      {revision && <View style={styles.controls}><Text style={styles.section}>Reschedule due date</Text><DateField label="New due date" value={revision.date} onChange={(date) => setRevision({ ...revision, date })} /><TextInput value={revision.reason} onChangeText={(reason) => setRevision({ ...revision, reason })} style={styles.input} placeholder="Reason for change" accessibilityLabel="Reason for rescheduling" />{!!revisionError && <Text style={styles.error}>{revisionError}</Text>}<View style={styles.pages}><Pressable onPress={() => setRevision(null)} style={styles.choice}><Text style={styles.choiceText}>Cancel</Text></Pressable><Pressable onPress={() => void saveRevision()} disabled={savingRevision} style={styles.retry}><Text style={styles.retryText}>{savingRevision ? 'Saving…' : 'Save date'}</Text></Pressable></View></View>}
      <View style={styles.pages}>{page > 1 && <Pressable onPress={() => setPage((n) => n - 1)} style={styles.retry}><Text style={styles.retryText}>Previous</Text></Pressable>}{data.next_page && <Pressable onPress={() => setPage(data.next_page ?? 1)} style={styles.retry}><Text style={styles.retryText}>Next page</Text></Pressable>}</View>
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 70, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  eyebrow: { color: '#006D64', fontSize: 10, fontWeight: '800' }, title: { color: '#15211F', fontSize: 23, fontWeight: '800' }, muted: { color: '#52635E', fontSize: 12 },
  controls: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 14, gap: 10 }, label: { color: '#52635E', fontSize: 11, fontWeight: '800' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minHeight: 38, paddingHorizontal: 11, justifyContent: 'center', borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 9 }, chosen: { backgroundColor: '#DDF3EF', borderColor: '#006D64' }, choiceText: { color: '#52635E', fontSize: 12, fontWeight: '700' }, chosenText: { color: '#006D64' },
  dateFields: { flexDirection: 'row', gap: 8 }, input: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 9, color: '#15211F' }, locations: { gap: 6 },
  state: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 10 }, error: { color: '#A62925', fontSize: 13 }, retry: { backgroundColor: '#006D64', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 10 }, retryText: { color: '#FFFFFF', fontWeight: '800' },
  notice: { backgroundColor: '#FFF1D6', borderRadius: 12, padding: 13, flexDirection: 'row', gap: 9, alignItems: 'center' }, totals: { backgroundColor: '#E8F5F1', borderRadius: 15, padding: 16, gap: 9 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, amount: { color: '#15211F', fontSize: 13, fontWeight: '800' },
  section: { color: '#15211F', fontSize: 16, fontWeight: '800' }, card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 13, minHeight: 58, gap: 8 }, rowTitle: { color: '#15211F', fontSize: 13, fontWeight: '700' }, pages: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, link: { color: '#006D64', fontSize: 12, fontWeight: '800', alignSelf: 'flex-end' },
  browseSales: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 12, padding: 13, gap: 4, minHeight: 62 }, browseTitle: { color: '#006D64', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
