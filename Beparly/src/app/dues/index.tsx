import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, PurchaseRecord, SaleRecord } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';

type Direction = 'collect' | 'pay';

export default function DuesScreen() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const [direction, setDirection] = useState<Direction>('collect');
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const canViewPurchases = session?.account?.role === 'owner' || session?.account?.can_manage_purchases;

  useFocusEffect(useCallback(() => {
    if (!session || !businessId) return;
    let active = true;
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const salesResult = await api.sales(session.token, businessId);
        let purchaseRows: PurchaseRecord[] = [];
        if (canViewPurchases) {
          let page = 1;
          let nextPage: number | null = 1;
          while (nextPage !== null) {
            const result = await api.purchases(session.token, businessId, page);
            purchaseRows = purchaseRows.concat(result.purchases);
            nextPage = result.next_page;
            if (nextPage !== null) page = nextPage;
          }
        }
        if (active) {
          setSales(salesResult.sales.filter((item) => item.status !== 'cancelled' && Number(item.due) > 0));
          setPurchases(purchaseRows.filter((item) => item.status === 'completed' && Number(item.due) > 0));
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load outstanding balances.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  // Pull-to-refresh changes this generation to rerun the focused request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, businessId, canViewPurchases, refreshCount]));

  const receivable = useMemo(() => sales.reduce((sum, item) => sum + Number(item.due), 0), [sales]);
  const payable = useMemo(() => purchases.reduce((sum, item) => sum + Number(item.due), 0), [purchases]);
  const filteredSales = useMemo(() => sales.filter((item) => `${item.invoice_number} ${item.customer_name}`.toLowerCase().includes(query.trim().toLowerCase())), [sales, query]);
  const filteredPurchases = useMemo(() => purchases.filter((item) => `${item.number} ${item.supplier_name}`.toLowerCase().includes(query.trim().toLowerCase())), [purchases, query]);

  if (!session?.account) return null;
  const amount = direction === 'collect' ? receivable : payable;

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/' as Href)} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <AppSymbol name="back" size={20} color={palette.ink} />
      </Pressable>
      <View style={styles.headerCopy}><Text style={styles.eyebrow}>OUTSTANDING BALANCES</Text><Text style={styles.title}>Dues</Text></View>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRefreshCount((count) => count + 1)} tintColor={palette.primaryDeep} />}>
      <View style={styles.switcher}>
        <Pressable onPress={() => { setDirection('collect'); setQuery(''); }} style={[styles.switchButton, direction === 'collect' && styles.switchActive]}>
          <Text style={[styles.switchText, direction === 'collect' && styles.switchTextActive]}>To collect</Text>
          <Text style={[styles.switchAmount, direction === 'collect' && styles.switchTextActive]}>৳{receivable.toFixed(2)}</Text>
        </Pressable>
        {canViewPurchases && <Pressable onPress={() => { setDirection('pay'); setQuery(''); }} style={[styles.switchButton, direction === 'pay' && styles.switchActive]}>
          <Text style={[styles.switchText, direction === 'pay' && styles.switchTextActive]}>To pay</Text>
          <Text style={[styles.switchAmount, direction === 'pay' && styles.switchTextActive]}>৳{payable.toFixed(2)}</Text>
        </Pressable>}
      </View>

      <View style={styles.summary}>
        <View style={[styles.summaryIcon, direction === 'pay' && styles.payIcon]}><AppSymbol name={direction === 'collect' ? 'receive' : 'purchase'} size={20} color={direction === 'collect' ? palette.primaryDeep : palette.orange} /></View>
        <View style={styles.summaryCopy}><Text style={styles.summaryLabel}>{direction === 'collect' ? 'Customers owe you' : 'You owe suppliers'}</Text><Text style={styles.summaryAmount}>৳{amount.toFixed(2)}</Text></View>
        <Text style={styles.count}>{direction === 'collect' ? filteredSales.length : filteredPurchases.length} records</Text>
      </View>

      <View style={styles.search}><AppSymbol name="products" size={17} color={palette.muted} /><TextInput value={query} onChangeText={setQuery} placeholder={direction === 'collect' ? 'Search customer or invoice' : 'Search supplier or purchase'} placeholderTextColor={palette.muted} style={styles.searchInput} /></View>

      {loading ? <ActivityIndicator color={palette.primaryDeep} style={styles.loading} /> : error ? <Text style={styles.error}>{error}</Text> : direction === 'collect' ? (
        filteredSales.length ? filteredSales.map((item) => <Pressable key={item.id} onPress={() => router.push(`/sales/${item.id}` as Href)} style={styles.row}>
          <View style={[styles.rowIcon, styles.receiveIcon]}><AppSymbol name="sale" size={18} color={palette.primaryDeep} /></View>
          <View style={styles.rowCopy}><Text style={styles.party} numberOfLines={1}>{item.customer_name || 'Walk-in customer'}</Text><Text style={styles.document}>{displayDocumentNumber(item.invoice_number)} · {item.created_at.slice(0, 10)}</Text><Text style={styles.amountMeta}>Total ৳{Number(item.total).toFixed(2)} · Paid ৳{Number(item.paid).toFixed(2)}</Text></View>
          <View style={styles.dueBlock}><Text style={styles.dueLabel}>Due</Text><Text style={styles.dueAmount}>৳{Number(item.due).toFixed(2)}</Text></View>
        </Pressable>) : <Empty title="No customer dues" detail="Sales with unpaid or partially paid balances will appear here." />
      ) : (
        filteredPurchases.length ? filteredPurchases.map((item) => <Pressable key={item.id} onPress={() => router.push(`/purchases/${item.id}` as Href)} style={styles.row}>
          <View style={[styles.rowIcon, styles.payIcon]}><AppSymbol name="purchase" size={18} color={palette.orange} /></View>
          <View style={styles.rowCopy}><Text style={styles.party} numberOfLines={1}>{item.supplier_name || 'Supplier'}</Text><Text style={styles.document}>{displayDocumentNumber(item.number)} · {item.created_at.slice(0, 10)}</Text><Text style={styles.amountMeta}>Total ৳{Number(item.total).toFixed(2)} · Paid ৳{Number(item.paid).toFixed(2)}</Text></View>
          <View style={styles.dueBlock}><Text style={styles.dueLabel}>Due</Text><Text style={[styles.dueAmount, styles.payAmount]}>৳{Number(item.due).toFixed(2)}</Text></View>
        </Pressable>) : <Empty title="No supplier dues" detail="Purchases with unpaid or partially paid balances will appear here." />
      )}
    </ScrollView>
  </SafeAreaView>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.empty}><AppSymbol name="dues" size={28} color={palette.muted} /><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft },
  headerCopy: { gap: 2 }, eyebrow: { color: palette.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, title: { color: palette.ink, fontSize: 22, fontWeight: '800' },
  content: { width: '100%', maxWidth: 660, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 12 },
  switcher: { flexDirection: 'row', gap: 9 }, switchButton: { flex: 1, minHeight: 68, borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: palette.surface, justifyContent: 'center', paddingHorizontal: 15, gap: 4 }, switchActive: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft }, switchText: { color: palette.secondary, fontSize: 12, fontWeight: '700' }, switchAmount: { color: palette.ink, fontSize: 17, fontWeight: '800' }, switchTextActive: { color: palette.primaryDeep },
  summary: { minHeight: 83, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, summaryIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }, payIcon: { backgroundColor: palette.orangeSoft }, summaryCopy: { flex: 1, gap: 3 }, summaryLabel: { color: palette.secondary, fontSize: 12, fontWeight: '600' }, summaryAmount: { color: palette.ink, fontSize: 20, fontWeight: '800' }, count: { color: palette.muted, fontSize: 11 },
  search: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, searchInput: { flex: 1, paddingVertical: 10, color: palette.ink, fontSize: 13 },
  row: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, receiveIcon: { backgroundColor: palette.primarySoft }, rowCopy: { flex: 1, gap: 3, minWidth: 0 }, party: { color: palette.ink, fontSize: 14, fontWeight: '800' }, document: { color: palette.muted, fontSize: 10 }, amountMeta: { color: palette.secondary, fontSize: 10, marginTop: 2 }, dueBlock: { alignItems: 'flex-end', gap: 3 }, dueLabel: { color: palette.muted, fontSize: 10 }, dueAmount: { color: palette.amber, fontSize: 14, fontWeight: '800' }, payAmount: { color: palette.orange },
  loading: { padding: 28 }, error: { color: '#A62925', backgroundColor: palette.surface, padding: 14, borderRadius: 12 }, empty: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 44, backgroundColor: palette.surface, borderRadius: 16, borderWidth: 1, borderColor: palette.border }, emptyTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' }, emptyCopy: { color: palette.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
