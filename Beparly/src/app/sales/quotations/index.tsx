import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { AppSymbol } from '@/components/app-symbol';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { listQuotationDrafts, LocalQuotation } from '@/features/quotations/quotation-storage';
import { api, QuotationRecord } from '@/services/api';

export default function Quotations() {
  const { session } = useAuth(); const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [locals, setLocals] = useState<LocalQuotation[]>([]); const [search, setSearch] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1); const [next, setNext] = useState<number | null>(null); const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const businessId = session?.account?.business.id;
  useFocusEffect(useCallback(() => {
    if (!session || !businessId) return;
    let active = true;
    setLoading(true); setRows([]); setNext(null);
    void listQuotationDrafts(businessId).then(value => { if (active) setLocals(value.filter(row => row.state !== 'synced')); });
    void api.quotations(session.token, businessId, search, page).then(value => { if (active) { setRows(value.quotations); setNext(value.next_page); setError(''); setLoading(false); } }).catch(problem => { if (active) { setError(problem.message); setLoading(false); } });
    return () => { active = false; };
  // Pull-to-refresh changes this generation to rerun the focused request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, businessId, search, page, refreshCount]));
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRefreshCount((count) => count + 1)} />}>
    <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/sales' as Href)}><Text style={styles.link}>‹ Sales</Text></Pressable>
    <View style={styles.heading}><Text style={styles.title}>Quotations</Text><Pressable accessibilityRole="button" accessibilityLabel="Create quotation" style={styles.primary} onPress={() => setShowTypePicker(true)}><AppSymbol name="plus" size={20} color="#fff" /></Pressable></View>
    <Text style={styles.hint}>Offers do not reserve stock or create customer dues.</Text>
    <TextInput style={styles.input} placeholder="Search number or customer" value={search} onChangeText={value => { setSearch(value); setPage(1); }} />
    {!!locals.length && <Text style={styles.sectionTitle}>Unfinished drafts</Text>}
    {locals.map(local => <Pressable key={local.key} style={styles.card} onPress={() => router.push(local.serverId ? `/sales/quotations/${local.serverId}/edit` as Href : `/sales/quotations/new?tier=${local.input.price_tier}&draft=${encodeURIComponent(local.key)}` as Href)}><Text style={styles.link}>{local.serverId ? 'Local changes' : 'New local draft'}</Text><Text>{local.input.customer_name || 'Walk-in buyer'} · {local.state === 'conflict' ? 'Conflict' : 'Pending sync'}</Text></Pressable>)}
    {!!error && <Text style={styles.error}>{error} Local drafts remain available above.</Text>}
    <Text style={styles.sectionTitle}>Your quotations</Text>
    {loading && <ActivityIndicator color={palette.primaryDeep} style={{ padding: 20 }} />}
    {rows.map(row => <Pressable key={row.id} style={styles.card} onPress={() => router.push(`/sales/quotations/${row.id}` as Href)}><View style={styles.heading}><Text style={styles.link}>{row.number || 'Draft'}</Text><Text style={styles.status}>{row.status.toUpperCase()}</Text></View><Text>{row.customer_name || 'Walk-in buyer'}</Text><Text style={styles.amount}>৳{Number(row.total).toFixed(2)}</Text><Text style={styles.hint}>{row.valid_until ? `Valid until ${row.valid_until}` : 'Not issued'}</Text></Pressable>)}
    {!loading && !rows.length && !locals.length && !error && <Text style={styles.hint}>No quotations yet. Tap + to create one.</Text>}
    <View style={styles.heading}><Pressable disabled={page <= 1} onPress={() => setPage(value => value - 1)}><Text style={styles.link}>Previous</Text></Pressable><Text>Page {page}</Text><Pressable disabled={!next} onPress={() => setPage(next ?? page)}><Text style={styles.link}>Next</Text></Pressable></View>
  </ScrollView><Modal visible={showTypePicker} transparent animationType="fade" onRequestClose={() => setShowTypePicker(false)}><View style={styles.modalBackdrop}><View style={styles.typeSheet}><View style={styles.modalHeading}><View><Text style={styles.modalEyebrow}>NEW QUOTATION</Text><Text style={styles.modalTitle}>Choose price type</Text></View><Pressable accessibilityLabel="Close" onPress={() => setShowTypePicker(false)} style={styles.closeButton}><AppSymbol name="close" size={18} color={palette.secondary} /></Pressable></View>{(['retail', 'wholesale'] as const).map(tier => <Pressable key={tier} style={styles.typeChoice} onPress={() => { setShowTypePicker(false); router.push(`/sales/quotations/new?tier=${tier}&draft=${Date.now()}-${Math.random().toString(36).slice(2)}` as Href); }}><View style={styles.typeIcon}><AppSymbol name={tier === 'retail' ? 'sale' : 'products'} size={19} color={palette.primaryDeep} /></View><View style={{ flex: 1 }}><Text style={styles.typeTitle}>{tier === 'retail' ? 'Retail' : 'Wholesale'}</Text><Text style={styles.hint}>{tier === 'retail' ? 'Use retail prices' : 'Use wholesale prices'}</Text></View><AppSymbol name="chevron" size={17} color={palette.primaryDeep} /></Pressable>)}</View></View></Modal></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.background }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, gap: 12 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, title: { color: palette.ink, fontSize: 24, fontWeight: '800' }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '800', marginTop: 6 }, hint: { color: palette.muted, fontSize: 12 }, link: { color: palette.primaryDeep, fontWeight: '700' }, input: { minHeight: 46, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, primary: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.primaryDeep }, primaryText: { color: '#fff', fontWeight: '800' }, card: { padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, gap: 5 }, status: { color: palette.secondary, fontSize: 11, fontWeight: '700' }, amount: { color: palette.ink, fontSize: 17, fontWeight: '800' }, error: { color: '#B42318' }, modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22, backgroundColor: 'rgba(15,25,22,.42)' }, typeSheet: { width: '100%', maxWidth: 440, padding: 18, borderRadius: 22, backgroundColor: palette.surface, gap: 10 }, modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }, modalEyebrow: { color: palette.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, modalTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }, closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: palette.background }, typeChoice: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border }, typeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.primarySoft }, typeTitle: { color: palette.ink, fontSize: 14, fontWeight: '800' } });
