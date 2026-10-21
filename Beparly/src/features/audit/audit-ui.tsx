import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, type AuditEvent } from '@/services/api';

import { auditChanges, auditDetails, auditTitle } from './audit-format';

function AuditRow({ event }: { event: AuditEvent }) {
  const icon: AppSymbolName = event.entity_type === 'stock' ? 'stock' : event.entity_type === 'location' ? 'location' : event.entity_type === 'package' ? 'package' : event.entity_type === 'batch' ? 'batch' : event.entity_type === 'category' ? 'category' : 'products';
  return <View style={styles.row}>
    <View style={styles.icon}><AppSymbol name={icon} size={19} color={palette.primaryDeep} /></View>
    <View style={styles.rowBody}>
      <Text style={styles.rowTitle}>{auditTitle(event)}</Text>
      <Text style={styles.subject}>{event.subject || auditDetails(event)}</Text>
      {event.entity_type === 'stock' && <Text style={styles.detail}>{auditDetails(event)}</Text>}
      {auditChanges(event).map((line, index) => <Text key={`${event.id}-${index}`} style={styles.detail}>{line}</Text>)}
      <Text style={styles.meta}>{event.actor} · {new Date(event.created_at).toLocaleString()}</Text>
    </View>
  </View>;
}

export function AuditLogScreen() {
  const { productId, locationId } = useLocalSearchParams<{ productId?: string; locationId?: string }>();
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const loadingMore = useRef(false);

  const load = useCallback(async (page = 1) => {
    if (!token || !businessId) { setError('Select a business first.'); setLoading(false); return; }
    if (page > 1 && loadingMore.current) return;
    if (page > 1) loadingMore.current = true;
    else setLoading(true);
    try {
      const result = await api.auditEvents(token, businessId, {
        productId, locationId: locationId ? Number(locationId) : undefined, page,
      });
      setEvents((old) => page === 1 ? result.events : [...old, ...result.events]);
      setNextPage(result.next_page);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load audit history.'); }
    finally { setLoading(false); setRefreshing(false); loadingMore.current = false; }
  }, [token, businessId, productId, locationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const title = productId ? 'Product history' : locationId ? 'Location history' : 'Audit log';
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><AppSymbol name="back" size={24} color={palette.primary} /></Pressable><Text style={styles.title}>{title}</Text></View>
    {loading && !events.length ? <View style={styles.center}><ActivityIndicator color={palette.primary} /></View> :
      <FlatList data={events} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        onEndReached={() => { if (nextPage && !loading) void load(nextPage); }} onEndReachedThreshold={0.4}
        renderItem={({ item }) => <AuditRow event={item} />}
        ListEmptyComponent={<View style={styles.center}><Text style={styles.detail}>{error || 'No recorded changes yet.'}</Text></View>}
        ListFooterComponent={nextPage && events.length ? <ActivityIndicator color={palette.primary} /> : undefined}
      />}
    {error && events.length > 0 && <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void load(nextPage ?? 1)}><Text style={styles.retryText}>Could not load more. Tap to retry.</Text></Pressable>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, backgroundColor: palette.surface },
  back: { width: 44, height: 44, justifyContent: 'center' }, title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: 32, flexGrow: 1 },
  center: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 3 }, rowTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  subject: { color: palette.ink, fontSize: 14 }, detail: { color: palette.secondary, fontSize: 13, lineHeight: 19 },
  meta: { color: palette.muted, fontSize: 12, marginTop: 6 },
  retry: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.surface },
  retryText: { color: palette.primaryDeep, fontSize: 13, fontWeight: '600' },
});
