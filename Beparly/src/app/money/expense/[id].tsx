import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecordAttachments } from '@/features/attachments/record-attachments';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { api, type MoneyTransaction, type PendingAttachment, type RecordAttachment } from '@/services/api';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [expense, setExpense] = useState<(MoneyTransaction & { category_name: string; account_name: string }) | null>(null);
  const [attachments, setAttachments] = useState<RecordAttachment[]>([]);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!session?.account || !id) return;
    setLoading(true);
    try {
      const businessId = session.account.business.id;
      const [record, documents] = await Promise.all([api.expense(session.token, businessId, id),
        api.recordAttachments(session.token, businessId, 'expense', id)]);
      setExpense(record.transaction); setAttachments(documents.attachments); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load expense.'); }
    finally { setLoading(false); }
  }, [session, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F8F7' }}>
    <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'white' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/money' as Href)}
        style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#006D64', fontSize: 24 }}>‹</Text></Pressable>
      <Text style={{ color: '#15211F', fontWeight: '800', fontSize: 21 }}>Expense</Text>
    </View>
    <RefreshableScrollView onRefresh={load} contentContainerStyle={{ padding: 18, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 560, gap: 17 }}>
        {loading ? <ActivityIndicator color="#006D64" /> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: '#A62925' }}>{error}</Text> : null}
        {expense && <>
          <View style={{ padding: 20, borderRadius: 18, backgroundColor: 'white', gap: 8 }}>
            <Text style={{ color: '#52635E' }}>Amount spent</Text>
            <Text style={{ color: '#15211F', fontSize: 30, fontWeight: '800' }}>{formatBdt(expense.amount)}</Text>
            <Text style={{ color: '#15211F' }}>{expense.category_name} · {expense.account_name}</Text>
            <Text style={{ color: '#52635E' }}>{expense.event_date}{expense.reversed ? ' · Reversed' : ''}</Text>
            {!!expense.reference && <Text style={{ color: '#15211F' }}>Reference: {expense.reference}</Text>}
            {!!expense.note && <Text style={{ color: '#15211F' }}>{expense.note}</Text>}
          </View>
          <View style={{ padding: 20, borderRadius: 18, backgroundColor: 'white' }}>
            <RecordAttachments kind="expense" pending={pending} onChange={setPending} existing={attachments}
              token={session?.token} businessId={session?.account?.business.id} recordId={expense.id}
              onUploaded={() => { void load(); }} />
          </View>
        </>}
      </View>
    </RefreshableScrollView>
  </SafeAreaView>;
}
