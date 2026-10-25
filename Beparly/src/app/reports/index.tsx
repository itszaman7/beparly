import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { reportGroups, reportItems, type ReportGroup } from '@/features/reports/catalog';
import { businessToday, periodStart } from '@/features/reports/dates';
import { releaseWebFocus } from '@/features/reports/web-focus';
import { formatBdt } from '@/features/products/product-rules';
import { api, type FinancialSummary } from '@/services/api';

const colors: Record<ReportGroup, { ink: string; pale: string }> = {
  Business: { ink: '#006D64', pale: '#DDF3EF' },
  Inventory: { ink: '#744C12', pale: '#FFF1D6' },
  Accounting: { ink: '#3E519A', pale: '#E7ECFF' },
};
export default function ReportsHome() {
  const { session } = useAuth();
  const [group, setGroup] = useState<ReportGroup>('Business');
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const end = businessToday(session?.account?.business.timezone);
  const start = periodStart(end, 'month');
  const businessId = session?.account?.business.id;
  useEffect(() => {
    if (!session?.token || !businessId || session.account?.role !== 'owner') return;
    let active = true;
    void api.financialSummary(session.token, businessId, start, end, 'month').then((result) => {
      if (active) { setSummary(result); setError(''); }
    }).catch((problem: Error) => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, [session?.token, session?.account?.role, businessId, start, end, retry]);
  if (session?.account?.role !== 'owner') return null;
  const theme = colors[group];
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={() => { releaseWebFocus(); router.back(); }} accessibilityRole="button" accessibilityLabel="Back to dashboard" style={styles.back}><AppSymbol name="back" size={20} color="#15211F" /></Pressable>
    <Text style={styles.eyebrow}>YOUR BUSINESS</Text><Text style={styles.title}>Reports</Text>
    <View style={styles.hero}>
      <View style={styles.heroTop}><AppSymbol name="reports" size={22} color="#006D64" /><Text style={styles.heroLabel}>NET PROFIT THIS MONTH</Text></View>
      {!summary && !error ? <ActivityIndicator color="#006D64" /> : error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.heroValue}>{formatBdt(summary?.totals.profit_loss ?? '0')}</Text>}
      <Text style={styles.heroDates}>{start} to {end} · posted entries</Text>
      {!!error && <Pressable onPress={() => setRetry((n) => n + 1)} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>}
      <Pressable onPress={() => { releaseWebFocus(); router.push('/reports/financial-summary'); }} accessibilityRole="button"><Text style={styles.link}>Open Financial Summary →</Text></Pressable>
    </View>
    <View style={styles.tabs}>{reportGroups.map((item) => <Pressable key={item} onPress={() => setGroup(item)} accessibilityRole="tab" accessibilityState={{ selected: group === item }} style={[styles.tab, group === item && { borderColor: colors[item].ink, backgroundColor: colors[item].pale }]}><Text style={[styles.tabText, group === item && { color: colors[item].ink }]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.section}>{group} reports</Text>
    {reportItems.filter((item) => item.group === group).map((item) => <Pressable key={item.name} onPress={() => { releaseWebFocus(); router.push(`/reports/${item.name}` as Href); }} accessibilityRole="button" style={styles.card}>
      <View style={[styles.icon, { backgroundColor: theme.pale }]}><AppSymbol name={item.icon} size={22} color={theme.ink} /></View>
      <View style={styles.copy}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardText}>{item.subtitle}</Text></View>
      <AppSymbol name="chevron" size={18} color="#52635E" />
    </Pressable>)}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 70, gap: 10 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  eyebrow: { color: '#006D64', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }, title: { color: '#15211F', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  hero: { backgroundColor: '#E8F5F1', borderRadius: 18, padding: 18, gap: 8, marginBottom: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, heroLabel: { color: '#006D64', fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  heroValue: { color: '#15211F', fontSize: 30, fontWeight: '800' }, heroDates: { color: '#52635E', fontSize: 12 }, link: { color: '#006D64', fontSize: 12, fontWeight: '800' }, error: { color: '#A62925', fontSize: 13 },
  tabs: { flexDirection: 'row', gap: 7 }, tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: '#FFFFFF' },
  tabText: { color: '#52635E', fontSize: 12, fontWeight: '700' }, section: { color: '#15211F', fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 2 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5ECE9', borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 70 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 3 },
  cardTitle: { color: '#15211F', fontSize: 15, fontWeight: '800' }, cardText: { color: '#52635E', fontSize: 11 },
});
