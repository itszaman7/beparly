import { router, useFocusEffect, usePathname, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Keyboard, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Barcode, Camera, ChevronDown, ChevronLeft, Eye, FileText, Funnel, MoreHorizontal, Plus, Printer, RotateCcw, Search, Share2, X } from 'lucide-react-native';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { SelectionToolbar, useRecordSelection } from '@/features/documents/record-selection';
import { SalesFilterSheet, salesPeriodLabel } from '@/features/sales/sales-list-filters';
import { defaultSalesFilters, periodBounds, saleMatchesFilters, type SalesFilters } from '@/features/sales/sales-list-rules';
import { api, resolveAssetUrl, type SaleRecord } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';
import { blurWebFocus } from '@/utils/web-focus';

const PAGE_SIZE = 8;
type SymbolName = React.ComponentProps<typeof AppSymbol>['name'];
const dismissInput = () => { Keyboard.dismiss(); blurWebFocus(); };

export default function SalesHome() {
  const isTab = usePathname() === '/sales-hub';
  const { session } = useAuth();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SalesFilters>(defaultSalesFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [salePickerOpen, setSalePickerOpen] = useState(false);
  const [actionSale, setActionSale] = useState<SaleRecord | null>(null);
  const [error, setError] = useState('');
  const selection = useRecordSelection();
  const clearSelection = selection.clear;

  const load = useCallback(async () => {
    if (!session?.account) return;
    try {
      const result = await api.sales(session.token, session.account.business.id);
      setSales(result.sales); setNextPage(result.next_page); setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load sales.'); }
  }, [session]);
  useFocusEffect(useCallback(() => { void load(); return clearSelection; }, [load, clearSelection]));

  const loadOlder = async () => {
    if (!session?.account || !nextPage || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await api.sales(session.token, session.account.business.id, undefined, nextPage);
      setSales((current) => {
        const known = new Set(current.map((sale) => sale.id));
        return [...current, ...result.sales.filter((sale) => !known.has(sale.id))];
      });
      setNextPage(result.next_page); setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load older sales.'); }
    finally { setLoadingOlder(false); }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const { start, end } = periodBounds(filters);
    return sales.filter((sale) => {
      const search = `${sale.invoice_number} ${displayDocumentNumber(sale.invoice_number)} ${sale.customer_name} ${(sale.lines ?? []).map((line) => line.name).join(' ')}`.toLowerCase();
      return search.includes(normalized) && saleMatchesFilters(sale, filters, { start, end });
    });
  }, [sales, query, filters]);
  const summary = useMemo(() => sales.filter((sale) => sale.status !== 'cancelled').reduce((result, sale) => ({
    count: result.count + 1, revenue: result.revenue + Number(sale.net_total ?? sale.total),
    collected: result.collected + Number(sale.paid), due: result.due + Number(sale.due),
    profit: result.profit + Number(sale.profit ?? 0),
  }), { count: 0, revenue: 0, collected: 0, due: 0, profit: 0 }), [sales]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleSales = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeFilterCount = Number(filters.period !== 'all') + Number(filters.tier !== 'all') + Number(filters.dueOnly);

  if (!session?.account) return null;
  const newSale = (tier: 'retail' | 'wholesale') => {
    dismissInput(); setSalePickerOpen(false);
    router.push(`/sales/checkout?mode=${tier === 'retail' ? 'quick' : 'manual'}` as Href);
  };
  const openDocument = (sale: SaleRecord, kind: 'invoice' | 'receipt' | 'label') => {
    setActionSale(null);
    router.push(`/sales/${sale.id}/document?kind=${kind}` as Href);
  };
  const openSale = (sale: SaleRecord) => { setActionSale(null); router.push(`/sales/${sale.id}/details` as Href); };

  return <SafeAreaView style={styles.safe} edges={isTab ? ['top'] : ['top', 'bottom']}><View style={styles.screen}>
    <View style={styles.header}>
      {!isTab && <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/' as Href)} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}><ChevronLeft size={23} color={palette.ink} /></Pressable>}
      <View style={styles.headerCopy}><Text style={styles.title}>Sales</Text><Text style={styles.subtitle}>Invoices and checkout</Text></View>
      <Pressable onPress={() => { dismissInput(); setSalePickerOpen(true); }} accessibilityRole="button" accessibilityLabel="New Sale" style={styles.newSale}><Plus size={19} color="white" /><Text style={styles.newSaleText}>New Sale</Text></Pressable>
    </View>
    <RefreshableScrollView onRefresh={load} style={styles.page} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.scanRow}>
        <Pressable onPress={() => { dismissInput(); router.push('/sales/checkout?mode=quick&scan=1' as Href); }} accessibilityRole="button" accessibilityLabel="Open barcode scanner checkout" style={styles.scanButton}>
          <Barcode size={20} color={palette.primaryDeep} /><View style={styles.scanCopy}><Text style={styles.scanTitle}>Barcode scanner</Text><Text style={styles.scanHint}>USB / Bluetooth</Text></View>
        </Pressable>
        <Pressable onPress={() => { dismissInput(); router.push('/sales/checkout?mode=quick&camera=1' as Href); }} accessibilityRole="button" accessibilityLabel="Open phone camera checkout" style={styles.scanButton}>
          <Camera size={20} color={palette.primaryDeep} /><View style={styles.scanCopy}><Text style={styles.scanTitle}>Phone camera</Text><Text style={styles.scanHint}>Scan with device</Text></View>
        </Pressable>
      </View>

      <View style={styles.kpiGrid}>
        <Kpi icon="sale" label="Sales" value={String(summary.count)} tone="#006D64" />
        <Kpi icon="money" label="Revenue" value={`৳${summary.revenue.toFixed(2)}`} tone="#2C70C9" />
        <Kpi icon="dues" label="Due" value={`৳${summary.due.toFixed(2)}`} tone="#B66A12" />
        <Kpi icon="reports" label="Profit" value={`৳${summary.profit.toFixed(2)}`} tone="#258247" />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}><Search size={18} color={palette.muted} /><TextInput value={query} onChangeText={(value) => { selection.clear(); setQuery(value); setPage(1); }} placeholder="Invoice, customer or product" placeholderTextColor={palette.muted} accessibilityLabel="Search sales" style={styles.searchInput} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Filters" onPress={() => { dismissInput(); setFilterOpen(true); }} style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}><Funnel size={17} color={palette.primaryDeep} /><Text style={styles.filterButtonText}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Period: ${salesPeriodLabel(filters.period)}. Open filters`} onPress={() => { dismissInput(); setFilterOpen(true); }} style={styles.periodRow}>
        <Text style={styles.periodLabel}>Period</Text><Text style={styles.periodValue}>{salesPeriodLabel(filters.period)}{filters.period === 'custom' ? ` · ${filters.start} to ${filters.end}` : ''}</Text><ChevronDown size={16} color={palette.primaryDeep} />
      </Pressable>
      {(filters.tier !== 'all' || filters.dueOnly) && <Text style={styles.activeFilters}>{filters.tier !== 'all' ? `${filters.tier === 'retail' ? 'Retail' : 'Wholesale'} sales` : 'All sale types'}{filters.dueOnly ? ' · Unpaid only' : ''}</Text>}

      <View style={styles.listHeading}><View><Text style={styles.resultCount}>{filters.dueOnly ? 'Unpaid invoices' : 'Sales history'}</Text><Text style={styles.totalCount}>{filtered.length} matching of {sales.length} loaded</Text></View></View>
      <SelectionToolbar type="sale" rows={sales} {...selection} visibleIds={visibleSales.map((sale) => sale.id)} onChanged={() => void load()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {visibleSales.map((sale) => <SaleCard key={sale.id} sale={sale} selecting={selection.selecting} selected={selection.selected.includes(sale.id)}
        onLongPress={() => selection.longPress(sale.id)} onPress={() => selection.press(sale.id, () => openSale(sale))} onActions={() => { dismissInput(); setActionSale(sale); }} />)}
      {filtered.length === 0 && !error ? <View style={styles.empty}><AppSymbol name={filters.dueOnly ? 'dues' : 'sale'} size={27} color={palette.primaryDeep} /><Text style={styles.emptyTitle}>{filters.dueOnly ? 'No outstanding dues' : 'No sales match these filters'}</Text><Text style={styles.emptyCopy}>{nextPage ? 'No match in loaded sales. Load older sales to keep looking.' : 'Try another period, type, or search term.'}</Text></View> : null}
      {filtered.length > PAGE_SIZE ? <View style={styles.pagination}><Pressable disabled={page <= 1} onPress={() => setPage((value) => value - 1)} style={[styles.pageButton, page <= 1 && styles.pageDisabled]}><Text style={styles.pageText}>Previous</Text></Pressable><Text style={styles.pageNumber}>Page {page} of {pageCount}</Text><Pressable disabled={page >= pageCount} onPress={() => setPage((value) => value + 1)} style={[styles.pageButton, page >= pageCount && styles.pageDisabled]}><Text style={styles.pageText}>Next</Text></Pressable></View> : null}
      {nextPage ? <Pressable disabled={loadingOlder} onPress={() => void loadOlder()} style={[styles.olderButton, loadingOlder && styles.pageDisabled]}><Text style={styles.olderText}>{loadingOlder ? 'Loading older sales…' : 'Load older sales'}</Text></Pressable> : null}
    </RefreshableScrollView>

    {filterOpen && <SalesFilterSheet value={filters} onClose={() => setFilterOpen(false)} onApply={(next) => { selection.clear(); setFilters(next); setPage(1); setFilterOpen(false); }} />}
    <Modal visible={salePickerOpen} transparent animationType="fade" onRequestClose={() => setSalePickerOpen(false)}><View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setSalePickerOpen(false)} accessibilityLabel="Close sale type chooser" />
      <View style={styles.salePicker}><View style={styles.pickerHeader}><Text style={styles.pickerTitle}>Choose sale type</Text><Pressable onPress={() => setSalePickerOpen(false)} accessibilityLabel="Close" style={styles.closeButton}><X size={20} color={palette.ink} /></Pressable></View>
        <Pressable onPress={() => newSale('retail')} style={styles.saleTypeCard}><AppSymbol name="sale" size={22} color={palette.primaryDeep} /><View style={styles.saleTypeCopy}><Text style={styles.saleTypeTitle}>Retail Sale</Text><Text style={styles.saleTypeHint}>Quick checkout with retail prices</Text></View></Pressable>
        <Pressable onPress={() => newSale('wholesale')} style={styles.saleTypeCard}><AppSymbol name="products" size={22} color="#A35C00" /><View style={styles.saleTypeCopy}><Text style={styles.saleTypeTitle}>Wholesale Sale</Text><Text style={styles.saleTypeHint}>Party sale with wholesale prices</Text></View></Pressable>
      </View>
    </View></Modal>
    <Modal visible={!!actionSale} transparent animationType="fade" onRequestClose={() => setActionSale(null)}><View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setActionSale(null)} accessibilityLabel="Close sale actions" />
      {actionSale && <View style={styles.actionSheet}>
        <View style={styles.pickerHeader}><View><Text style={styles.pickerTitle}>Sale actions</Text><Text style={styles.actionSubtitle}>{displayDocumentNumber(actionSale.invoice_number)}</Text></View><Pressable onPress={() => setActionSale(null)} accessibilityLabel="Close" style={styles.closeButton}><X size={20} color={palette.ink} /></Pressable></View>
        <SaleAction icon={Eye} label="View details" onPress={() => openSale(actionSale)} />
        {actionSale.status === 'completed' && <>
          <SaleAction icon={Printer} label="Print invoice" onPress={() => openDocument(actionSale, 'invoice')} />
          <SaleAction icon={FileText} label="Print receipt" onPress={() => openDocument(actionSale, 'receipt')} />
          <SaleAction icon={Share2} label="Share invoice" onPress={() => openDocument(actionSale, 'invoice')} hint="Opens invoice preview with Share" />
          <SaleAction icon={Barcode} label="Print label" onPress={() => openDocument(actionSale, 'label')} />
          <SaleAction icon={RotateCcw} label="Return / Refund" onPress={() => { const id = actionSale.id; setActionSale(null); router.push(`/sales/${id}/return` as Href); }} />
        </>}
      </View>}
    </View></Modal>
  </View></SafeAreaView>;
}

function SaleCard({ sale, selecting, selected, onLongPress, onPress, onActions }: {
  sale: SaleRecord; selecting: boolean; selected: boolean; onLongPress: () => void; onPress: () => void; onActions: () => void;
}) {
  const total = sale.net_total ?? sale.total;
  const imageUrl = resolveAssetUrl(sale.lines?.[0]?.image_url);
  return <View style={[styles.saleCard, sale.status === 'cancelled' && styles.cancelledSale, selected && styles.selectedSale]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${displayDocumentNumber(sale.invoice_number)}, ${sale.customer_name}, ${sale.status}${selecting ? ', tap to select' : ', long press to select'}`}
      accessibilityState={{ selected }} onLongPress={onLongPress} onPress={onPress} style={styles.saleCardBody}>
    <View style={styles.saleTitleRow}>
      {selecting ? <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected ? <Text style={styles.checkmark}>✓</Text> : null}</View> :
        <View style={styles.thumbnail}>{imageUrl ? <Image source={{ uri: imageUrl }} style={styles.thumbnailImage} resizeMode="cover" /> : <AppSymbol name="products" size={19} color={palette.primaryDeep} />}</View>}
      <View style={styles.invoiceBlock}><Text style={styles.invoiceNumber}>{displayDocumentNumber(sale.invoice_number)}</Text><Text style={styles.dateText}>{new Date(sale.invoice_date ?? sale.created_at).toLocaleDateString()} · {sale.price_tier === 'wholesale' ? 'Wholesale' : 'Retail'}</Text></View>
      <View style={styles.amountBlock}><Text style={styles.saleAmount}>৳{Number(total).toFixed(2)}</Text><StatusPill status={sale.status} paid={Number(sale.due) <= 0} due={sale.due} /></View>
    </View>
    <Text style={styles.customerName} numberOfLines={1}>{sale.customer_name}</Text>
    <Text style={styles.productSummary} numberOfLines={1}>{(sale.lines ?? []).map((line) => line.name).join(', ') || `${sale.item_count ?? 0} items`}</Text>
    <View style={styles.saleMeta}><Text style={styles.metaText}>{sale.item_quantity ?? '0'} items</Text><Text style={styles.metaText}>Paid ৳{Number(sale.paid).toFixed(2)}</Text>
      {sale.status === 'cancelled' ? <Text style={[styles.metaText, styles.cancelReason]} numberOfLines={1}>Cancelled · {sale.cancellation_reason || 'No reason recorded'}</Text> : <Text style={[styles.metaText, Number(sale.profit ?? 0) >= 0 ? styles.profitText : styles.lossText]}>Profit ৳{Number(sale.profit ?? 0).toFixed(2)}</Text>}
    </View>
    </Pressable>
    {!selecting && <Pressable onPress={onActions} accessibilityRole="button" accessibilityLabel={`Actions for ${displayDocumentNumber(sale.invoice_number)}`} style={styles.moreButton}><MoreHorizontal size={18} color={palette.primaryDeep} /><Text style={styles.moreText}>Actions</Text></Pressable>}
  </View>;
}

function SaleAction({ icon: Icon, label, hint, onPress }: { icon: typeof Eye; label: string; hint?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.actionRow}><Icon size={19} color={palette.primaryDeep} /><Text style={styles.actionText}>{label}</Text></Pressable>;
}
function Kpi({ icon, label, value, tone }: { icon: SymbolName; label: string; value: string; tone: string }) {
  return <View style={styles.kpi}><View style={[styles.kpiIcon, { backgroundColor: `${tone}18` }]}><AppSymbol name={icon} size={16} color={tone} /></View><View style={styles.kpiCopy}><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View></View>;
}
function StatusPill({ status, paid, due }: { status: SaleRecord['status']; paid: boolean; due: string }) {
  return <View style={[styles.statusPill, status === 'cancelled' ? styles.cancelledPill : status === 'draft' ? styles.draftPill : paid ? styles.paidPill : styles.duePill]}>
    <Text style={[styles.statusText, status === 'cancelled' ? styles.cancelledText : status === 'draft' ? styles.draftText : paid ? styles.paidText : styles.dueText]}>{status === 'cancelled' ? 'Cancelled' : status === 'draft' ? 'Draft' : paid ? 'Paid' : `Due ৳${Number(due).toFixed(2)}`}</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, screen: { flex: 1, width: '100%', maxWidth: 860, alignSelf: 'center', backgroundColor: palette.background },
  header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingVertical: 12, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 }, title: { color: palette.ink, fontSize: 23, fontWeight: '800' }, subtitle: { color: palette.muted, fontSize: 11, marginTop: 2 },
  newSale: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, borderRadius: 13, backgroundColor: palette.primaryDeep }, newSaleText: { color: 'white', fontSize: 13, fontWeight: '800' },
  page: { flex: 1 }, pageContent: { padding: spacing.lg, paddingBottom: 90, gap: 13 },
  scanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scanButton: { flex: 1, minWidth: 145, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 13, backgroundColor: palette.surface },
  scanCopy: { flex: 1, minWidth: 0 }, scanTitle: { color: palette.ink, fontSize: 13, fontWeight: '700' }, scanHint: { color: palette.muted, fontSize: 10, marginTop: 2 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, kpi: { flexGrow: 1, flexBasis: '22%', minWidth: 140, minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  kpiIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, kpiCopy: { flex: 1, minWidth: 0 }, kpiLabel: { color: palette.muted, fontSize: 10 }, kpiValue: { color: palette.ink, fontSize: 14, fontWeight: '800', marginTop: 3 },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, searchBox: { flex: 1, minWidth: 175, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, searchInput: { flex: 1, minWidth: 0, padding: 0, color: palette.ink, fontSize: 13 },
  filterButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 13, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, filterButtonActive: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft }, filterButtonText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '800' },
  periodRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, periodLabel: { color: palette.muted, fontSize: 12 }, periodValue: { flex: 1, color: palette.ink, fontSize: 12, fontWeight: '700' }, activeFilters: { color: palette.primaryDeep, fontSize: 11, fontWeight: '700' },
  listHeading: { paddingTop: 5 }, resultCount: { color: palette.ink, fontSize: 17, fontWeight: '800' }, totalCount: { color: palette.muted, fontSize: 11, marginTop: 2 },
  saleCard: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, gap: 7 }, saleCardBody: { gap: 7 }, cancelledSale: { borderColor: '#F1CFCC', backgroundColor: '#FFFDFC' }, selectedSale: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft },
  saleTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, thumbnail: { width: 42, height: 42, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, thumbnailImage: { width: '100%', height: '100%' },
  checkbox: { width: 24, height: 24, margin: 9, borderRadius: 6, borderWidth: 1.5, borderColor: palette.primaryDeep, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }, checkboxSelected: { backgroundColor: palette.primaryDeep }, checkmark: { color: 'white', fontSize: 16, fontWeight: '800' },
  invoiceBlock: { flex: 1, minWidth: 0 }, invoiceNumber: { color: palette.primaryDeep, fontSize: 13, fontWeight: '800' }, dateText: { color: palette.muted, fontSize: 11, marginTop: 4 }, amountBlock: { alignItems: 'flex-end', gap: 5 }, saleAmount: { color: palette.ink, fontSize: 16, fontWeight: '800' }, customerName: { color: palette.ink, fontSize: 13, fontWeight: '700' }, productSummary: { color: palette.muted, fontSize: 11 },
  saleMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.border }, metaText: { color: palette.secondary, fontSize: 10 }, cancelReason: { color: '#A62925', flexShrink: 1 }, profitText: { color: '#258247' }, lossText: { color: '#B42318' },
  moreButton: { minHeight: 44, marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 9, backgroundColor: palette.primarySoft }, moreText: { color: palette.primaryDeep, fontSize: 11, fontWeight: '800' },
  statusPill: { borderRadius: 11, paddingHorizontal: 8, paddingVertical: 4 }, paidPill: { backgroundColor: palette.primarySoft }, duePill: { backgroundColor: palette.amberSoft }, draftPill: { backgroundColor: palette.blueSoft }, cancelledPill: { backgroundColor: '#FCEBE9' }, statusText: { fontSize: 9, fontWeight: '800' }, paidText: { color: palette.primaryDeep }, dueText: { color: palette.amber }, draftText: { color: palette.blue }, cancelledText: { color: '#A62925' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 5 }, pageButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 10, backgroundColor: palette.primarySoft }, pageDisabled: { opacity: 0.4 }, pageText: { color: palette.primaryDeep, fontSize: 11, fontWeight: '800' }, pageNumber: { color: palette.muted, fontSize: 11 },
  olderButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.primarySoft }, olderText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '800' }, empty: { alignItems: 'center', padding: 40, gap: 8 }, emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' }, emptyCopy: { color: palette.muted, fontSize: 12, textAlign: 'center' }, error: { color: '#B42318', fontSize: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,25,22,.42)' }, salePicker: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: spacing.lg, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: palette.surface }, actionSheet: { width: '100%', maxWidth: 620, maxHeight: '85%', alignSelf: 'center', padding: spacing.lg, gap: 5, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: palette.surface },
  pickerHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 5 }, pickerTitle: { color: palette.ink, fontSize: 20, fontWeight: '800' }, actionSubtitle: { color: palette.muted, fontSize: 12, marginTop: 3 }, closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  saleTypeCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background }, saleTypeCopy: { flex: 1, gap: 3 }, saleTypeTitle: { color: palette.ink, fontSize: 14, fontWeight: '800' }, saleTypeHint: { color: palette.muted, fontSize: 11 },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.background }, actionText: { color: palette.ink, fontSize: 14, fontWeight: '700' },
});
