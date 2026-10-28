import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, MoneyAccount, SaleRecord, SaleReturnReceiptRecord, StockLocation, Supplier } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';

const command = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const n = Math.random() * 16 | 0;
  return (c === 'x' ? n : n & 3 | 8).toString(16);
});
const money = (value: string | number) => `৳${Number(value).toFixed(2)}`;
type ReturnLine = NonNullable<NonNullable<SaleRecord['returns']>[number]['lines']>[number];

export default function SaleReturnPage() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = session?.account?.business.id;
  const [sale, setSale] = useState<SaleRecord | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [creditDelivery, setCreditDelivery] = useState(false);
  const [receipt, setReceipt] = useState<{ creditId: string; line: ReturnLine } | null>(null);
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [receiptLocation, setReceiptLocation] = useState<number | null>(null);
  const [receiptCondition, setReceiptCondition] = useState<'sellable' | 'damaged' | 'inspection' | null>(null);
  const [receiptEvidence, setReceiptEvidence] = useState('');
  const [inspection, setInspection] = useState<{ creditId: string; receipt: SaleReturnReceiptRecord } | null>(null);
  const [decisionAction, setDecisionAction] = useState<'restocked' | 'written_off' | 'returned_to_supplier' | null>(null);
  const [decisionEvidence, setDecisionEvidence] = useState('');
  const [decisionSupplier, setDecisionSupplier] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [refundId, setRefundId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundAccount, setRefundAccount] = useState('');
  const [refundEvidence, setRefundEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const creditCommand = useRef<string | null>(null);
  const receiptCommand = useRef<string | null>(null);
  const decisionCommand = useRef<string | null>(null);
  const refundCommand = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !businessId || !id) return;
    const [result, options, stock] = await Promise.all([
      api.sale(session.token, businessId, id),
      api.salesOptions(session.token, businessId),
      api.locations(session.token, businessId),
    ]);
    setSale(result.sale);
    setAccounts(options.accounts.filter((item) => item.is_active));
    setLocations(stock.locations.filter((item) => item.is_active));
  }, [session, businessId, id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh().catch((problem) => setError(problem instanceof Error ? problem.message : 'Could not load sale.'));
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!session || !businessId || decisionAction !== 'returned_to_supplier') return;
    const timer = setTimeout(() => {
      void api.suppliers(session.token, businessId, 1, supplierSearch.trim())
        .then((result) => setSuppliers(result.suppliers))
        .catch((problem) => setError(problem instanceof Error ? problem.message : 'Could not load suppliers.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [session, businessId, decisionAction, supplierSearch]);

  function clearCreditCommand() { creditCommand.current = null; }
  function clearReceiptCommand() { receiptCommand.current = null; }
  function clearDecisionCommand() { decisionCommand.current = null; }
  function clearRefundCommand() { refundCommand.current = null; }

  async function issueCredit() {
    if (!session || !businessId || !sale) return;
    const lines = (sale.lines ?? []).flatMap((line) => {
      const quantity = quantities[line.id]?.trim();
      return quantity ? [{ line_id: line.id, quantity }] : [];
    });
    if (!reason.trim() || (!lines.length && !creditDelivery)) {
      setError('Enter a reason and choose item quantities or the delivery charge.'); return;
    }
    for (const item of lines) {
      const sold = sale.lines?.find((line) => line.id === item.line_id);
      if (!sold || !/^\d+(?:\.\d{1,3})?$/.test(item.quantity) || Number(item.quantity) <= 0 ||
          Number(item.quantity) > Number(sold.quantity) - Number(sold.returned_quantity ?? 0)) {
        setError('Check the item quantities against the uncredited sale.'); return;
      }
    }
    setBusy(true); setError('');
    try {
      const result = await api.returnSale(session.token, businessId, sale.id,
        { reason: reason.trim(), lines, credit_delivery_fee: creditDelivery },
        creditCommand.current ?? (creditCommand.current = command()));
      setSale(result.sale); setReason(''); setQuantities({}); setCreditDelivery(false);
      creditCommand.current = null;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not issue sale credit.');
    } finally { setBusy(false); }
  }

  function chooseReceipt(creditId: string, line: ReturnLine) {
    setReceipt({ creditId, line }); setReceiptQuantity(''); setReceiptCondition(null);
    setReceiptLocation(sale?.location_id ?? null); setReceiptEvidence(''); clearReceiptCommand(); setError('');
  }

  async function confirmReceipt() {
    if (!session || !businessId || !sale || !receipt) return;
    const sold = sale.lines?.find((line) => line.id === receipt.line.line_id);
    const remaining = Number(receipt.line.quantity) - Number(receipt.line.received_quantity);
    if (!sold || !/^\d+(?:\.\d{1,3})?$/.test(receiptQuantity) || Number(receiptQuantity) <= 0 ||
        Number(receiptQuantity) > remaining || !receiptLocation || !receiptCondition || !receiptEvidence.trim()) {
      setError('Confirm the quantity, location, condition and physical receipt evidence.'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await api.receiveSaleReturn(session.token, businessId, sale.id, receipt.creditId,
        { return_line_id: receipt.line.id, product_id: sold.product_id,
          variant_id: sold.variant_id, batch_id: sold.batch_id ?? null,
          quantity: receiptQuantity, location_id: receiptLocation, condition: receiptCondition,
          received_confirmed: true, evidence_reference: receiptEvidence.trim() },
        receiptCommand.current ?? (receiptCommand.current = command()));
      setSale(result.sale); setReceipt(null); receiptCommand.current = null;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not record physical receipt.');
    } finally { setBusy(false); }
  }

  function chooseInspection(creditId: string, item: SaleReturnReceiptRecord) {
    setInspection({ creditId, receipt: item });
    setDecisionAction(null); setDecisionEvidence(''); setDecisionSupplier(null);
    setSupplierSearch('');
    clearDecisionCommand(); setError('');
  }

  async function confirmDecision() {
    if (!session || !businessId || !sale || !inspection) return;
    if (!decisionAction || !decisionEvidence.trim() ||
        (decisionAction === 'returned_to_supplier' && !decisionSupplier)) {
      setError('Select the inspection result and enter its evidence. Supplier dispatch needs a supplier.'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await api.decideSaleReturn(session.token, businessId, sale.id,
        inspection.creditId, inspection.receipt.id,
        { action: decisionAction, decision_confirmed: true,
          evidence_reference: decisionEvidence.trim(),
          supplier_id: decisionAction === 'returned_to_supplier' ? decisionSupplier : null },
        decisionCommand.current ?? (decisionCommand.current = command()));
      setSale(result.sale); setInspection(null); decisionCommand.current = null;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not record inspection decision.');
    } finally { setBusy(false); }
  }

  function chooseRefund(creditId: string, outstanding: string) {
    setRefundId(creditId); setRefundAmount(outstanding); setRefundAccount('');
    setRefundEvidence(''); clearRefundCommand(); setError('');
  }

  async function confirmRefund() {
    if (!session || !businessId || !sale || !refundId) return;
    const credit = sale.returns?.find((item) => item.id === refundId);
    if (!credit || !/^\d+(?:\.\d{1,2})?$/.test(refundAmount) || Number(refundAmount) <= 0 ||
        Number(refundAmount) > Number(credit.refund_outstanding) || !refundAccount || !refundEvidence.trim()) {
      setError('Enter the executed amount, account and refund confirmation reference.'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await api.refundSaleReturn(session.token, businessId, sale.id, refundId,
        { amount: refundAmount, account_id: refundAccount, refund_confirmed: true,
          confirmation_reference: refundEvidence.trim() },
        refundCommand.current ?? (refundCommand.current = command()));
      setSale(result.sale); setRefundId(null); refundCommand.current = null;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not record executed refund.');
    } finally { setBusy(false); }
  }

  if (!session?.account) return null;
  const isOwner = session.account.role === 'owner';
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <RefreshableScrollView onRefresh={() => refresh().catch((problem) => setError(problem instanceof Error ? problem.message : 'Could not load sale.'))} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.heading}><Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.link}>Back</Text></Pressable><Text style={styles.title}>Return / Refund</Text></View>
      {!sale ? <Text style={styles.muted}>{error || 'Loading sale…'}</Text> : <>
        <View style={styles.card}><Text style={styles.cardTitle}>{displayDocumentNumber(sale.invoice_number)}</Text><Text style={styles.muted}>Customer due {money(sale.due)} · Refund still owed {money(sale.refund_outstanding ?? 0)}</Text><Text style={styles.muted}>A sale credit, goods receipt and executed refund are recorded separately.</Text></View>
        {sale.status !== 'completed' ? <Text style={styles.error}>This sale is not available for a new credit.</Text> : <>
          {isOwner && <View style={styles.card}><Text style={styles.cardTitle}>1. Issue customer credit</Text><Text style={styles.muted}>This reduces the amount owed by the customer or creates a refund owed. It does not receive goods or move money.</Text>
            {(sale.lines ?? []).filter((line) => Number(line.quantity) > Number(line.returned_quantity ?? 0)).map((line) => <View key={line.id} style={styles.row}><View style={styles.flex}><Text style={styles.label}>{line.name}{line.variant ? ` · ${line.variant}` : ''}</Text><Text style={styles.muted}>SKU {line.sku} · Batch {line.batch_id ?? 'None'} · Up to {Number(line.quantity) - Number(line.returned_quantity ?? 0)} {line.unit}</Text></View><TextInput style={styles.smallInput} keyboardType="decimal-pad" placeholder="Qty" placeholderTextColor={palette.muted} value={quantities[line.id] ?? ''} onChangeText={(value) => { setQuantities((old) => ({ ...old, [line.id]: value })); clearCreditCommand(); }} accessibilityLabel={`Credit quantity for ${line.name}`} /></View>)}
            {Number(sale.delivery_fee ?? 0) > 0 && <Pressable style={[styles.choice, creditDelivery && styles.selected]} onPress={() => { setCreditDelivery(!creditDelivery); clearCreditCommand(); }} accessibilityRole="checkbox" accessibilityState={{ checked: creditDelivery }}><Text style={styles.label}>Credit delivery charge {money(sale.delivery_fee ?? 0)}</Text></Pressable>}
            <TextInput style={styles.input} value={reason} onChangeText={(value) => { setReason(value); clearCreditCommand(); }} placeholder="Reason for credit" placeholderTextColor={palette.muted} accessibilityLabel="Credit reason" />
            <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void issueCredit()}><Text style={styles.primaryText}>Issue credit only</Text></Pressable>
          </View>}
          <View style={styles.card}><Text style={styles.cardTitle}>2. Confirm goods received</Text><Text style={styles.muted}>Select the exact credited item, location and condition only after goods are physically in your custody.</Text>
            {(sale.returns ?? []).flatMap((credit) => credit.lines.filter((line) => line.condition === 'pending' && Number(line.quantity) > Number(line.received_quantity)).map((line) => <Pressable key={`${credit.id}-${line.id}`} style={styles.choice} onPress={() => chooseReceipt(credit.id, line)}><Text style={styles.label}>{sale.lines?.find((sold) => sold.id === line.line_id)?.name ?? 'Item'} · Unreceived {Number(line.quantity) - Number(line.received_quantity)}</Text><Text style={styles.link}>Record receipt</Text></Pressable>))}
            {receipt && <><Text style={styles.label}>Physical receipt for credited item #{receipt.line.id}</Text><TextInput style={styles.input} keyboardType="decimal-pad" placeholder="Quantity physically received" placeholderTextColor={palette.muted} value={receiptQuantity} onChangeText={(value) => { setReceiptQuantity(value); clearReceiptCommand(); }} /><Text style={styles.label}>Received at</Text><View style={styles.choices}>{locations.map((location) => <Pressable key={location.id} style={[styles.choice, receiptLocation === location.id && styles.selected]} onPress={() => { setReceiptLocation(location.id); clearReceiptCommand(); }}><Text style={styles.label}>{location.name}</Text></Pressable>)}</View><Text style={styles.label}>Condition</Text><View style={styles.choices}>{(['sellable', 'damaged', 'inspection'] as const).map((condition) => <Pressable key={condition} style={[styles.choice, receiptCondition === condition && styles.selected]} onPress={() => { setReceiptCondition(condition); clearReceiptCommand(); }}><Text style={styles.label}>{condition === 'sellable' ? 'Sellable' : condition === 'damaged' ? 'Damaged / write off' : 'Awaiting inspection'}</Text></Pressable>)}</View><TextInput style={styles.input} placeholder="Receipt evidence reference" placeholderTextColor={palette.muted} value={receiptEvidence} onChangeText={(value) => { setReceiptEvidence(value); clearReceiptCommand(); }} /><Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void confirmReceipt()}><Text style={styles.primaryText}>Confirm goods physically received</Text></Pressable></>}
          </View>
          {isOwner && <View style={styles.card}>
            <Text style={styles.cardTitle}>3. Finish inspection</Text>
            <Text style={styles.muted}>Goods awaiting inspection remain outside sellable stock and carry no new inventory value. Decide after checking the physical goods.</Text>
            {(sale.returns ?? []).flatMap((credit) => credit.lines.flatMap((line) => line.receipts.filter((item) => item.status === 'inspection').map((item) =>
              <Pressable key={item.id} style={styles.choice} onPress={() => chooseInspection(credit.id, item)}>
                <Text style={styles.label}>{sale.lines?.find((sold) => sold.id === line.line_id)?.name ?? 'Item'} · {item.quantity} held at location #{item.location_id}</Text>
                <Text style={styles.link}>Record inspection decision</Text>
              </Pressable>)))}
            {inspection && <>
              <View style={styles.choices}>{(['restocked', 'written_off', 'returned_to_supplier'] as const).map((action) =>
                <Pressable key={action} style={[styles.choice, decisionAction === action && styles.selected]}
                  onPress={() => { setDecisionAction(action); setDecisionSupplier(null); clearDecisionCommand(); }}>
                  <Text style={styles.label}>{action === 'restocked' ? 'Restock sellable' : action === 'written_off' ? 'Write off' : 'Send to supplier'}</Text>
                </Pressable>)}</View>
              {decisionAction === 'returned_to_supplier' && <>
                <Text style={styles.muted}>Physical dispatch only. Record any supplier credit separately when confirmed.</Text>
                <TextInput style={styles.input} placeholder="Search supplier" placeholderTextColor={palette.muted}
                  value={supplierSearch} onChangeText={(value) => { setSupplierSearch(value); setDecisionSupplier(null); clearDecisionCommand(); }} />
                <View style={styles.choices}>{suppliers.map((supplier) =>
                  <Pressable key={supplier.id} style={[styles.choice, decisionSupplier === supplier.id && styles.selected]}
                    onPress={() => { setDecisionSupplier(supplier.id); clearDecisionCommand(); }}>
                    <Text style={styles.label}>{supplier.name}</Text>
                  </Pressable>)}</View>
              </>}
              <TextInput style={styles.input} placeholder="Inspection or dispatch evidence reference"
                placeholderTextColor={palette.muted} value={decisionEvidence}
                onChangeText={(value) => { setDecisionEvidence(value); clearDecisionCommand(); }} />
              <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy}
                onPress={() => void confirmDecision()}><Text style={styles.primaryText}>Confirm inspection decision</Text></Pressable>
            </>}
          </View>}
          {isOwner && <View style={styles.card}><Text style={styles.cardTitle}>4. Record executed refund</Text><Text style={styles.muted}>Record money out only after the customer refund has actually been completed.</Text>
            {(sale.returns ?? []).filter((credit) => Number(credit.refund_outstanding) > 0).map((credit) => <Pressable key={credit.id} style={styles.choice} onPress={() => chooseRefund(credit.id, credit.refund_outstanding)}><Text style={styles.label}>Credit {money(credit.amount)} · Refund owed {money(credit.refund_outstanding)}</Text><Text style={styles.link}>Record refund</Text></Pressable>)}
            {refundId && <><TextInput style={styles.input} keyboardType="decimal-pad" placeholder="Amount actually refunded" placeholderTextColor={palette.muted} value={refundAmount} onChangeText={(value) => { setRefundAmount(value); clearRefundCommand(); }} /><Text style={styles.label}>Paid from account</Text><View style={styles.choices}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, refundAccount === account.id && styles.selected]} onPress={() => { setRefundAccount(account.id); clearRefundCommand(); }}><Text style={styles.label}>{account.name}</Text></Pressable>)}</View><TextInput style={styles.input} placeholder="Executed refund reference" placeholderTextColor={palette.muted} value={refundEvidence} onChangeText={(value) => { setRefundEvidence(value); clearRefundCommand(); }} /><Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void confirmRefund()}><Text style={styles.primaryText}>Confirm refund executed</Text></Pressable></>}
          </View>}
        </>}
      </>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </RefreshableScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, paddingBottom: 48, gap: 14 }, heading: { gap: 8 }, title: { color: palette.ink, fontSize: 24, fontWeight: '800' }, card: { padding: 16, gap: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16 }, cardTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' }, muted: { color: palette.muted, fontSize: 12, lineHeight: 18 }, label: { color: palette.ink, fontSize: 13, fontWeight: '700' }, link: { color: palette.primaryDeep, fontWeight: '800' }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, flex: { flex: 1 }, input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 10, color: palette.ink }, smallInput: { minWidth: 82, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 10, color: palette.ink }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { padding: 12, gap: 4, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, selected: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft }, primary: { minHeight: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: palette.primaryDeep }, primaryText: { color: 'white', fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.5 }, error: { color: '#B42318', fontSize: 12 },
});
