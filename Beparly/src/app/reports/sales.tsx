import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { SaleLink } from '@/features/reports/sale-link';
import { releaseWebFocus } from '@/features/reports/web-focus';
import { api, type ReportSalesResponse } from '@/services/api';

export default function ReportSales() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const params = useLocalSearchParams<{
    start_date?: string; end_date?: string; as_of?: string; product_id?: string;
    variant_id?: string; customer_id?: string; location_id?: string;
  }>();
  const { start_date, end_date, as_of, product_id, variant_id, customer_id, location_id } = params;
  const [pageState, setPageState] = useState({ filterKey: '', page: 1 });
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data: ReportSalesResponse | null; error: string } | null>(null);
  const filterKey = [start_date, end_date, as_of, product_id, variant_id, customer_id, location_id].join(':');
  const page = pageState.filterKey === filterKey ? pageState.page : 1;
  const nextPage = (value: number) => setPageState({ filterKey, page: value });
  const key = `${businessId}:${filterKey}:${page}:${retry}`;
  const data = state?.key === key ? state.data : null;
  const error = state?.key === key ? state.error : '';
  useEffect(() => {
    if (!session?.token || !businessId || session.account?.role !== 'owner') return;
    const query = new URLSearchParams();
    const filters = { start_date, end_date, as_of, product_id, variant_id, customer_id, location_id };
    for (const name of Object.keys(filters) as (keyof typeof filters)[]) if (filters[name]) query.set(name, filters[name]);
    query.set('page', String(page));
    let active = true;
    void api.reportSales(session.token, businessId, query).then((result) => {
      if (active) setState({ key, data: result, error: '' });
    }).catch((problem: Error) => { if (active) setState({ key, data: null, error: problem.message }); });
    return () => { active = false; };
  }, [session?.token, session?.account?.role, businessId, filterKey, page, retry, key, start_date, end_date, as_of, product_id, variant_id, customer_id, location_id]);
  if (session?.account?.role !== 'owner') return null;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={retry > 0 && state?.key !== key} onRefresh={() => setRetry((value) => value + 1)} />}>
    <View style={styles.heading}><Pressable onPress={() => { releaseWebFocus(); router.back(); }} accessibilityRole="button" accessibilityLabel="Back to report" style={styles.back}><AppSymbol name="back" size={20} color="#15211F" /></Pressable><View style={{ flex: 1 }}><Text style={styles.eyebrow}>REPORT SALES</Text><Text style={styles.title}>Sales details</Text></View></View>
    <Text style={styles.muted}>{params.as_of ? `Posted through ${params.as_of}` : `Posted ${params.start_date} to ${params.end_date}`}</Text>
    <Text style={styles.muted}>Open a sale number to see its customer, products, payments and document details.</Text>
    {state?.key !== key ? <View style={styles.state}><ActivityIndicator color="#006D64" /><Text style={styles.muted}>Loading sales…</Text></View> : error ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={() => setRetry((value) => value + 1)} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable></View> : data && <>
      <Text style={styles.section}>Posted sales · page {data.page}</Text>
      {data.rows.length ? data.rows.map((sale) => <SaleLink key={sale.sale_id} sale={sale} />) : <View style={styles.empty}><Text style={styles.muted}>No posted sales match these dates and filters.</Text></View>}
      <View style={styles.pages}>{page > 1 && <Pressable onPress={() => nextPage(page - 1)} style={styles.button}><Text style={styles.buttonText}>Previous</Text></Pressable>}{data.next_page && <Pressable onPress={() => nextPage(data.next_page ?? 1)} style={styles.button}><Text style={styles.buttonText}>Next page</Text></Pressable>}</View>
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 70, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  eyebrow: { color: '#006D64', fontSize: 10, fontWeight: '800' }, title: { color: '#15211F', fontSize: 23, fontWeight: '800' }, muted: { color: '#52635E', fontSize: 12 },
  section: { color: '#15211F', fontSize: 16, fontWeight: '800', marginTop: 8 }, state: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 10 },
  error: { color: '#A62925', fontSize: 13 }, button: { backgroundColor: '#006D64', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 10 }, buttonText: { color: '#FFFFFF', fontWeight: '800' },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16 }, pages: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
