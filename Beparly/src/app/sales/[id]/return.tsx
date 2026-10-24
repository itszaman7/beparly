import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, MoneyAccount, SaleRecord } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';

type ReturnDraft = { quantity: string; condition: 'sellable' | 'damaged' };
const money = (value: number | string) => `৳${Number(value).toFixed(2)}`;
const command = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : n & 3 | 8).toString(16); });

export default function SaleReturnPage() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = session?.account?.business.id;
  const [sale, setSale] = useState<SaleRecord | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [draft, setDraft] = useState<Record<number, ReturnDraft>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const commandId = useRef<string | null>(null);

  useEffect(() => {
    if (!session || !businessId || !id) return;
    void Promise.all([api.sale(session.token, businessId, id), api.salesOptions(session.token, businessId)])
      .then(([result, options]) => {
        setSale(result.sale);
        const active = options.accounts.filter((item) => item.is_active);
        setAccounts(active);
        setAccountId('');
      }).catch((problem) => setError(problem instanceof Error ? problem.message : 'Could not load this sale.'));
  }, [session, businessId, id]);

  const selected = (sale?.lines ?? []).flatMap((line) => {
    const item = draft[line.id];
    const quantity = Number(item?.quantity ?? 0);
    return quantity > 0 ? [{ line_id: line.id, quantity: item.quantity, condition: item.condition }] : [];
  });
  const estimatedReturn = (sale?.lines ?? []).reduce((sum, line) => {
    const quantity = Number(draft[line.id]?.quantity ?? 0);
    return sum + quantity * Number(line.unit_price) * (Number(sale?.subtotal ?? 0) > 0 ? (Number(sale?.subtotal ?? 0) - Number(sale?.discount ?? 0)) / Number(sale?.subtotal ?? 1) : 1);
  }, 0);
  const estimatedRefund = Math.max(0, estimatedReturn - Number(sale?.due ?? 0));

  async function submit() {
    if (!session || !businessId || !sale) return;
    if (!selected.length) { setError('Choose at least one item and quantity.'); return; }
    if (!reason.trim()) { setError('Add a reason for the return.'); return; }
    for (const item of selected) {
      const line = sale.lines?.find((row) => row.id === item.line_id);
      if (!line || !/^\d+(?:\.\d{1,3})?$/.test(item.quantity) || Number(item.quantity) > Number(line.quantity) - Number(line.returned_quantity ?? 0)) {
        setError('Check the returned quantities. They cannot exceed the remaining sold quantities.'); return;
      }
    }
    if (estimatedRefund > 0 && !accountId) { setError('Choose a money account for the refund.'); return; }
    setSaving(true); setError('');
    try {
      const result = await api.returnSale(session.token, businessId, sale.id,
        { reason: reason.trim(), refund_account_id: accountId || undefined, lines: selected },
        commandId.current ?? (commandId.current = command()));
      commandId.current = null;
      setSale(result.sale);
      setDraft({}); setReason('');
      router.replace(`/sales/${sale.id}/details` as Href);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not record the return.'); }
    finally { setSaving(false); }
  }

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><View style={styles.screen}>
    <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button"><AppSymbol name="back" size={20} color={palette.ink} /></Pressable><View><Text style={styles.eyebrow}>SALES RETURN</Text><Text style={styles.title}>Return & refund</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!sale ? <Text style={styles.muted}>{error || 'Loading sale…'}</Text> : <>
        <View style={styles.card}><Text style={styles.cardTitle}>{displayDocumentNumber(sale.invoice_number)}</Text><Text style={styles.muted}>{sale.customer_name} · Sold {money(sale.total)} · Due {money(sale.due)}</Text></View>
        {sale.status !== 'completed' ? <Text style={styles.error}>This sale is cancelled and cannot be returned.</Text> : <>
          <View style={styles.card}><Text style={styles.cardTitle}>Items to return</Text><Text style={styles.muted}>Enter a quantity for each returned item. Sellable items go back to the original shop.</Text>
            {(sale.lines ?? []).map((line) => {
              const remaining = Number(line.quantity) - Number(line.returned_quantity ?? 0);
              if (remaining <= 0) return null;
              const item = draft[line.id] ?? { quantity: '', condition: 'sellable' as const };
              return <View key={line.id} style={styles.item}><View style={styles.itemTop}><Text style={styles.itemName}>{line.name}{line.variant ? ` · ${line.variant}` : ''}</Text><Text style={styles.muted}>Up to {remaining} {line.unit}</Text></View><View style={styles.itemControls}><TextInput value={item.quantity} onChangeText={(quantity) => setDraft((old) => ({ ...old, [line.id]: { ...item, quantity } }))} placeholder="Quantity" placeholderTextColor={palette.muted} keyboardType="decimal-pad" style={styles.quantity} /><Pressable onPress={() => setDraft((old) => ({ ...old, [line.id]: { ...item, condition: 'sellable' } }))} style={[styles.chip, item.condition === 'sellable' && styles.chipSelected]}><Text style={styles.chipText}>Sellable</Text></Pressable><Pressable onPress={() => setDraft((old) => ({ ...old, [line.id]: { ...item, condition: 'damaged' } }))} style={[styles.chip, item.condition === 'damaged' && styles.chipSelected]}><Text style={styles.chipText}>Damaged</Text></Pressable></View></View>;
            })}
          </View>
          <View style={styles.card}><Text style={styles.cardTitle}>Refund</Text><Text style={styles.muted}>The returned item value clears any remaining due first. Delivery charges stay on the sale.</Text><Text style={styles.amount}>Estimated return {money(estimatedReturn)}</Text><Text style={styles.amount}>Estimated cash refund {money(estimatedRefund)}</Text>{selected.length ? <><Text style={styles.label}>Refund from {estimatedRefund > 0 ? '(required)' : '(if needed)'}</Text><View style={styles.accountList}>{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.chip, accountId === account.id && styles.chipSelected]}><Text style={styles.chipText}>{account.name}</Text></Pressable>)}</View></> : null}</View>
          <View style={styles.card}><Text style={styles.label}>Reason for return</Text><TextInput value={reason} onChangeText={setReason} placeholder="Why is the customer returning these items?" placeholderTextColor={palette.muted} style={styles.reason} multiline /></View>
        </>}
      </>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
    {sale?.status === 'completed' ? <View style={styles.footer}><Pressable disabled={saving || !selected.length} onPress={() => void submit()} style={[styles.primary, (saving || !selected.length) && styles.disabled]}><Text style={styles.primaryText}>{saving ? 'Recording…' : 'Record return & refund'}</Text></Pressable></View> : null}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, screen: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg }, back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }, eyebrow: { color: palette.primaryDeep, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, title: { color: palette.ink, fontSize: 22, fontWeight: '800' }, content: { paddingHorizontal: spacing.lg, paddingBottom: 24, gap: 12 }, card: { padding: 15, gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16 }, cardTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' }, muted: { color: palette.muted, fontSize: 12, lineHeight: 18 }, item: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, gap: 9 }, itemTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, itemName: { color: palette.ink, fontSize: 13, fontWeight: '700', flex: 1 }, itemControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, quantity: { minWidth: 90, flex: 1, minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 10, color: palette.ink }, chip: { minHeight: 42, borderWidth: 1, borderColor: palette.border, borderRadius: 11, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, chipSelected: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft }, chipText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' }, amount: { color: palette.ink, fontSize: 14, fontWeight: '700' }, label: { color: palette.secondary, fontSize: 12, fontWeight: '700' }, accountList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, reason: { minHeight: 76, borderWidth: 1, borderColor: palette.border, borderRadius: 11, padding: 11, color: palette.ink, textAlignVertical: 'top' }, footer: { padding: spacing.md, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border }, primary: { minHeight: 52, borderRadius: 14, backgroundColor: palette.primaryDeep, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: 'white', fontWeight: '800', fontSize: 14 }, disabled: { opacity: 0.45 }, error: { color: '#B42318', fontSize: 12 },
});
