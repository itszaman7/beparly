import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { formatBdt } from '@/features/products/product-rules';
import { useAuth } from '@/features/auth/auth-context';
import { businessToday, periodStart } from '@/features/reports/dates';
import { releaseWebFocus } from '@/features/reports/web-focus';
import { api, type FinancialAmounts, type FinancialSummary } from '@/services/api';

type Group = 'day' | 'month' | 'year';
function iso(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function defaultDates() { const today = businessToday(); return { start: periodStart(today, 'month'), end: today }; }
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T12:00:00`); return !Number.isNaN(parsed.getTime()) && iso(parsed) === value; }
function money(value: string) { return formatBdt(value); }

function WebDateInput({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  return createElement('input', { type: 'date', value, 'aria-label': label, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { flex: 1, minWidth: 0, minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #DCE6E2', backgroundColor: 'white', color: '#15211F', fontSize: 13 } });
}

export default function FinancialSummaryScreen() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const [group, setGroup] = useState<Group>('day');
  const [range, setRange] = useState<'today' | 'month' | 'year' | 'custom'>('month');
  const [customStart, setCustomStart] = useState(defaultDates().start);
  const [customEnd, setCustomEnd] = useState(defaultDates().end);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [response, setResponse] = useState<{ key: string; summary: FinancialSummary | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(30);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [detailResponse, setDetailResponse] = useState<{ key: string; summary: FinancialSummary | null; error: string } | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const today = businessToday(session?.account?.business.timezone);
  const start = range === 'custom' ? customStart : range === 'today' ? today : periodStart(today, range === 'year' ? 'year' : 'month');
  const end = range === 'custom' ? customEnd : today;
  const dateError = !validDate(start) || !validDate(end) ? 'Choose valid start and end dates.' : start > end ? 'Start date must be on or before end date.' : '';
  const requestKey = `${businessId}:${start}:${end}:${group}:${retry}`;
  const summary = response?.key === requestKey ? response.summary : null;
  const error = response?.key === requestKey ? response.error : '';
  const loading = response?.key !== requestKey;
  const activeRows = summary?.rows.filter((row) => row.has_activity) ?? [];
  const selectedRow = activeRows.find((row) => row.period === selectedPeriod);
  const periodEnd = selectedRow && group === 'year' ? `${selectedRow.period.slice(0, 4)}-12-31` : selectedRow && group === 'month' ? iso(new Date(Number(selectedRow.period.slice(0, 4)), Number(selectedRow.period.slice(5, 7)), 0)) : selectedPeriod;
  const detailStart = selectedPeriod && selectedPeriod > start ? selectedPeriod : start;
  const detailEnd = periodEnd && periodEnd < end ? periodEnd : end;
  const detailKey = `${businessId}:${selectedPeriod}:${detailStart}:${detailEnd}:${group}:${detailRetry}`;
  const detail = detailResponse?.key === detailKey ? detailResponse.summary : null;
  const detailError = detailResponse?.key === detailKey ? detailResponse.error : '';

  useEffect(() => {
    if (!session?.token || !businessId || session.account?.role !== 'owner' || dateError) return;
    let active = true;
    void api.financialSummary(session.token, businessId, start, end, group).then((result) => {
      if (active) setResponse({ key: requestKey, summary: result, error: '' });
    }).catch((problem: Error) => { if (active) setResponse({ key: requestKey, summary: null, error: problem.message }); });
    return () => { active = false; };
  }, [session?.token, session?.account?.role, businessId, start, end, group, dateError, requestKey]);

  useEffect(() => {
    if (!session?.token || !businessId || !selectedRow || dateError) return;
    let active = true;
    void api.financialSummary(session.token, businessId, detailStart, detailEnd, group).then((result) => {
      if (active) setDetailResponse({ key: detailKey, summary: result, error: '' });
    }).catch((problem: Error) => { if (active) setDetailResponse({ key: detailKey, summary: null, error: problem.message }); });
    return () => { active = false; };
  }, [session?.token, businessId, selectedRow, dateError, detailStart, detailEnd, group, detailKey]);

  function chooseGroup(value: Group) { setGroup(value); setSelectedPeriod(null); setVisibleCount(30); }
  function chooseRange(value: 'today' | 'month' | 'year' | 'custom') {
    if (value === 'custom' && range !== 'custom') { setCustomStart(start); setCustomEnd(end); }
    setRange(value); setSelectedPeriod(null); setVisibleCount(30);
  }
  function changeDate(which: 'start' | 'end', value: string) {
    if (which === 'start') setCustomStart(value); else setCustomEnd(value);
    setSelectedPeriod(null); setVisibleCount(30);
  }

  function chooseDate(event: DateTimePickerEvent, value?: Date) {
    if (event.type !== 'dismissed' && value) {
      if (picker) changeDate(picker, iso(value));
    }
    setPicker(null);
  }
  if (session?.account?.role !== 'owner') return null;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={retry > 0 && loading && !dateError} onRefresh={() => { setRetry((value) => value + 1); setDetailRetry((value) => value + 1); }} />}>
    <View style={styles.heading}><Pressable onPress={() => { releaseWebFocus(); router.back(); }} accessibilityRole="button" accessibilityLabel="Back to reports" style={styles.back}><AppSymbol name="back" size={20} color="#15211F" /></Pressable><View style={{ flex: 1 }}><Text style={styles.eyebrow}>REPORTS</Text><Text style={styles.title}>Financial Summary</Text></View></View>
    <Text style={styles.intro}>Posted income and costs for {session.account.business.name}. Payments against old dues are excluded.</Text>
    <View style={styles.viewSection}>
      <Text style={styles.controlLabel}>VIEW BY</Text>
      <View style={styles.viewOptions}>
        {([['day', 'Daily', 'One row per day'], ['month', 'Monthly', 'One row per month'], ['year', 'Yearly', 'One row per year']] as const).map(([value, label, hint]) => <Pressable key={value} onPress={() => chooseGroup(value)} accessibilityRole="button" accessibilityState={{ selected: group === value }} accessibilityLabel={`${label}, ${hint}`} style={[styles.viewTile, group === value && styles.viewTileActive]}>
          <AppSymbol name={value === 'year' ? 'dateRange' : value} size={23} color={group === value ? '#006D64' : '#52635E'} />
          <Text style={group === value ? styles.viewTitleActive : styles.viewTitle}>{label}</Text>
          <Text style={styles.viewHint}>{hint}</Text>
        </Pressable>)}
      </View>
    </View>
    <View style={styles.rangeSection}>
      <View style={styles.rangeHeader}><View style={styles.rangeIcon}><AppSymbol name="dateRange" size={20} color="#006D64" /></View><View style={styles.rangeHeaderCopy}><Text style={styles.rangeTitle}>Date range</Text><Text style={styles.rangeHint}>Which dates should this report include?</Text></View></View>
      <View style={styles.rangeChoices}>{([['today', 'Today'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom']] as const).map(([value, label]) => <Pressable key={value} onPress={() => chooseRange(value)} accessibilityRole="button" accessibilityState={{ selected: range === value }} style={[styles.rangeChoice, range === value && styles.rangeChoiceActive]}><Text style={range === value ? styles.rangeChoiceTextActive : styles.rangeChoiceText}>{label}</Text></Pressable>)}</View>
      {range === 'custom' && <View style={styles.dates}>{Platform.OS === 'web' ? <><WebDateInput value={customStart} label="Start date" onChange={(value) => changeDate('start', value)} /><WebDateInput value={customEnd} label="End date" onChange={(value) => changeDate('end', value)} /></> : <><Pressable onPress={() => setPicker('start')} accessibilityRole="button" accessibilityLabel={`Start date ${customStart}`} style={styles.dateButton}><Text style={styles.dateText}>From {customStart}</Text></Pressable><Pressable onPress={() => setPicker('end')} accessibilityRole="button" accessibilityLabel={`End date ${customEnd}`} style={styles.dateButton}><Text style={styles.dateText}>To {customEnd}</Text></Pressable></>}</View>}
      {Platform.OS !== 'web' && picker && <DateTimePicker mode="date" value={new Date(`${picker === 'start' ? customStart : customEnd}T12:00:00`)} onChange={chooseDate} />}
      <Text style={styles.rangeText}>{start} to {end} · inclusive</Text>
    </View>
    {dateError ? <Text accessibilityRole="alert" style={styles.error}>{dateError}</Text> : loading ? <View style={styles.state}><ActivityIndicator color="#006D64" /><Text style={styles.muted}>Loading financial summary…</Text></View> : error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={() => setRetry((value) => value + 1)} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : summary && <>
      <View style={styles.totals}><Text style={styles.section}>Period totals</Text><AmountRows values={summary.totals} metrics={summary.profit_metrics} /></View>
      <Pressable accessibilityRole="link" onPress={() => { releaseWebFocus(); router.push({ pathname: '/reports/sales', params: { start_date: start, end_date: end } }); }} style={styles.saleBrowse}><Text style={styles.link}>Browse sales for {start} to {end} →</Text><Text style={styles.muted}>Open a sale number for its customer and products.</Text></Pressable>
      <Text style={styles.section}>{group === 'day' ? 'Daily' : group === 'month' ? 'Monthly' : 'Yearly'} results</Text>
      <Text style={styles.muted}>Showing {activeRows.length} {group === 'day' ? 'days' : group === 'month' ? 'months' : 'years'} with activity. Tap a period for its breakdown.</Text>
      {!activeRows.length ? <View style={styles.card}><Text style={styles.muted}>No posted income or costs in this period.</Text></View> : <View style={styles.list}>
        {activeRows.slice(0, visibleCount).map((row) => <View key={row.period}>
          <Pressable onPress={() => setSelectedPeriod(selectedPeriod === row.period ? null : row.period)} accessibilityRole="button" accessibilityState={{ expanded: selectedPeriod === row.period }} accessibilityLabel={`${row.period} financial breakdown`} style={styles.periodRow}>
            <View style={styles.periodCopy}><Text style={styles.period}>{group === 'year' ? row.period.slice(0, 4) : group === 'month' ? row.period.slice(0, 7) : row.period}</Text><Text style={styles.periodMeta}>Income {money(row.income)} · Product {money(row.product_cost)} · Other {money(row.other_expenses)}</Text></View>
            <View style={styles.periodRight}><Text style={[styles.profit, Number(row.profit_loss) < 0 && styles.loss]}>{money(row.profit_loss)}</Text><Text style={styles.profitCaption}>Profit / loss</Text></View><AppSymbol name="chevron" size={16} color="#52635E" />
          </Pressable>
          {selectedPeriod === row.period && <View style={styles.detail}>
            <Text style={styles.detailTitle}>{group === 'year' ? row.period.slice(0, 4) : group === 'month' ? row.period.slice(0, 7) : row.period} breakdown</Text>
            <Pressable accessibilityRole="link" onPress={() => { releaseWebFocus(); router.push({ pathname: '/reports/sales', params: { start_date: detailStart, end_date: detailEnd } }); }}><Text style={styles.link}>Browse sales in this period →</Text></Pressable>
            {detailError ? <><Text accessibilityRole="alert" style={styles.error}>{detailError}</Text><Pressable onPress={() => setDetailRetry((value) => value + 1)} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable></> : !detail ? <ActivityIndicator color="#006D64" /> : <>
              <AmountRows values={detail.totals} metrics={detail.profit_metrics} />
              <Text style={styles.detailSection}>Income accounts</Text><Breakdown rows={detail.breakdown.income} />
              <Text style={styles.detailSection}>Expense accounts</Text><Breakdown rows={detail.breakdown.expenses} />
            </>}
          </View>}
        </View>)}
      </View>}
      {activeRows.length > visibleCount && <Pressable onPress={() => setVisibleCount((count) => count + 30)} accessibilityRole="button" style={styles.showMore}><Text style={styles.link}>Show next {Math.min(30, activeRows.length - visibleCount)} periods</Text></Pressable>}
    </>}
  </ScrollView></SafeAreaView>;
}

function AmountRows({ values, metrics }: { values: FinancialAmounts; metrics?: FinancialSummary['profit_metrics'] }) {
  const rows = metrics ? [['Net sales', metrics.net_sales], ['Product cost', values.product_cost], ['Gross profit', metrics.gross_profit], ['Other income', metrics.other_income], ['Other expenses', values.other_expenses], ['Net profit', values.profit_loss]] : [['Income', values.income], ['Product cost', values.product_cost], ['Other expenses', values.other_expenses], ['Profit / loss', values.profit_loss]];
  return <View style={styles.amountRows}>{rows.map(([label, value]) => <View key={label} style={styles.amountRow}><Text style={label === 'Net profit' || label === 'Profit / loss' ? styles.strong : styles.muted}>{label}</Text><Text style={label === 'Net profit' || label === 'Profit / loss' ? styles.strong : styles.amount}>{money(value)}</Text></View>)}</View>;
}
function Breakdown({ rows }: { rows: FinancialSummary['breakdown']['income'] }) {
  if (!rows.length) return <Text style={styles.muted}>No posted entries in this period.</Text>;
  return <View style={styles.card}>{rows.map((item) => <Pressable key={item.id} onPress={() => { releaseWebFocus(); router.push(`/money/account/${encodeURIComponent(item.id)}`); }} accessibilityRole="link" accessibilityLabel={`${item.name} ledger`} style={styles.breakdownRow}><View style={{ flex: 1 }}><Text style={styles.amount}>{item.name}</Text><Text style={styles.muted}>{item.type === 'product_cost' ? 'Product cost' : item.type === 'income' ? 'Income' : 'Other expense'}</Text></View><Text style={styles.amount}>{money(item.amount)}</Text><AppSymbol name="chevron" size={16} color="#52635E" /></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 70, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#006D64', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { color: '#15211F', fontSize: 23, fontWeight: '800' }, intro: { color: '#52635E', fontSize: 13, lineHeight: 20 },
  viewSection: { gap: 9 }, controlLabel: { color: '#52635E', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  viewOptions: { flexDirection: 'row', gap: 10 },
  viewTile: { flex: 1, minWidth: 0, minHeight: 100, padding: 13, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5ECE9', alignItems: 'flex-start', gap: 4 },
  viewTileActive: { backgroundColor: '#E8F5F1', borderColor: '#006D64', borderWidth: 2, padding: 12 },
  viewTitle: { color: '#15211F', fontSize: 15, fontWeight: '700' }, viewTitleActive: { color: '#006D64', fontSize: 15, fontWeight: '800' }, viewHint: { color: '#52635E', fontSize: 11 },
  rangeSection: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5ECE9', padding: 14, gap: 12 },
  rangeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, rangeIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#DDF3EF', alignItems: 'center', justifyContent: 'center' }, rangeHeaderCopy: { flex: 1, gap: 2 }, rangeTitle: { color: '#15211F', fontSize: 15, fontWeight: '800' }, rangeHint: { color: '#52635E', fontSize: 11 },
  rangeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, rangeChoice: { flexGrow: 1, minHeight: 40, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#DCE6E2' }, rangeChoiceActive: { backgroundColor: '#DDF3EF', borderColor: '#006D64' }, rangeChoiceText: { color: '#52635E', fontSize: 12, fontWeight: '600' }, rangeChoiceTextActive: { color: '#006D64', fontSize: 12, fontWeight: '800' },
  dates: { flexDirection: 'row', gap: 8 }, dateButton: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 10, justifyContent: 'center', paddingHorizontal: 8 }, dateText: { color: '#15211F', fontSize: 12 }, rangeText: { color: '#52635E', fontSize: 12 },
  totals: { backgroundColor: '#E8F5F1', borderRadius: 16, padding: 16, gap: 12 }, section: { color: '#15211F', fontSize: 17, fontWeight: '800', marginTop: 6 }, card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E5ECE9', padding: 15, gap: 10 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E5ECE9', overflow: 'hidden' },
  periodRow: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EEF2F0', flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodCopy: { flex: 1, minWidth: 0, gap: 4 }, period: { color: '#006D64', fontSize: 14, fontWeight: '800' }, periodMeta: { color: '#52635E', fontSize: 11, lineHeight: 16 },
  periodRight: { alignItems: 'flex-end', gap: 3 }, profit: { color: '#006D64', fontSize: 14, fontWeight: '800' }, loss: { color: '#A62925' }, profitCaption: { color: '#52635E', fontSize: 10 },
  detail: { backgroundColor: '#F3F8F6', padding: 15, gap: 11, borderBottomWidth: 1, borderBottomColor: '#DCE6E2' }, detailTitle: { color: '#15211F', fontSize: 15, fontWeight: '800' }, detailSection: { color: '#15211F', fontSize: 13, fontWeight: '800', marginTop: 5 },
  showMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5ECE9' }, link: { color: '#006D64', fontSize: 13, fontWeight: '800' },
  saleBrowse: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 12, padding: 13, gap: 5, minHeight: 62 },
  amountRows: { gap: 8 }, amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, muted: { color: '#52635E', fontSize: 12 }, amount: { color: '#15211F', fontSize: 13, fontWeight: '700' }, strong: { color: '#006D64', fontSize: 15, fontWeight: '800' },
  breakdownRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#EEF2F0' }, state: { minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: 12 }, error: { color: '#A62925', fontSize: 13 }, retry: { backgroundColor: '#006D64', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 }, retryText: { color: '#FFFFFF', fontWeight: '700' },
});
