import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { AppSymbol } from '@/components/app-symbol';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, Contact, MoneyAccount, QuotationRecord, QuotationSaleDraft, resolveAssetUrl } from '@/services/api';

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => { const value = Math.floor(Math.random() * 16); return (character === 'x' ? value : (value & 3) | 8).toString(16); });
const money = (value: string | number) => `৳${Number(value).toFixed(2)}`;
type QuotationCustomer = Pick<Contact, 'id' | 'name' | 'phone' | 'address' | 'area' | 'district'>;
export default function QuotationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { session } = useAuth(); const businessId = session?.account?.business.id;
  const [quote, setQuote] = useState<QuotationRecord | null>(null); const [draft, setDraft] = useState<QuotationSaleDraft | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]); const [customers, setCustomers] = useState<QuotationCustomer[]>([]);
  const [accountId, setAccountId] = useState(''); const [customerId, setCustomerId] = useState(''); const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState(''); const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerNextPage, setCustomerNextPage] = useState<number | null>(null); const [customerLoading, setCustomerLoading] = useState(false);
  const customerRequest = useRef(0); const [paid, setPaid] = useState(''); const [dueDate, setDueDate] = useState('');
  const [prices, setPrices] = useState<string[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const checkoutCommand = useRef(uuid());
  const [refreshCount, setRefreshCount] = useState(0); const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => { if (!session || !businessId || !id) return; let active = true;
    void Promise.all([api.quotation(session.token, businessId, id), api.salesOptions(session.token, businessId, false)]).then(([result, options]) => {
      if (!active) return; setQuote(result.quotation); setPrices((result.quotation.lines ?? []).map(line => line.unit_price));
      setAccounts(options.accounts.filter(row => row.is_active));
      setAccountId(options.accounts.find(row => row.is_default)?.id ?? options.accounts[0]?.id ?? '');
      setCustomerId(result.quotation.customer_id ?? ''); setCustomerName(result.quotation.customer_name); setError('');
    }).catch(problem => { if (active) setError(problem.message); }).finally(() => { if (active) setRefreshing(false); }); return () => { active = false; };
  // Pull-to-refresh changes this generation to rerun the focused request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, businessId, id, refreshCount]));
  const fetchCustomers = useCallback(async (term: string, page: number, append: boolean) => {
    if (!session || !businessId) return;
    const request = ++customerRequest.current; setCustomerLoading(true);
    try {
      const result = await api.quotationCustomers(session.token, businessId, term, page);
      if (request !== customerRequest.current) return;
      setCustomers(current => append ? [...current, ...result.customers.filter(row => !current.some(item => item.id === row.id))] : result.customers);
      setCustomerNextPage(result.next_page);
    } catch {
      if (request === customerRequest.current) setCustomerNextPage(null);
    } finally {
      if (request === customerRequest.current) setCustomerLoading(false);
    }
  }, [session, businessId]);
  useEffect(() => {
    if (!customerPickerOpen) return;
    const timeout = setTimeout(() => void fetchCustomers(customerSearch.trim(), 1, false), customerSearch.trim() ? 250 : 0);
    return () => { clearTimeout(timeout); customerRequest.current += 1; };
  }, [customerPickerOpen, customerSearch, fetchCustomers]);
  async function act(action: 'issue' | 'status' | 'duplicate' | 'convert', data: object = {}) {
    if (!session || !businessId || !id) return;
    setBusy(true); setError('');
    try { const result = await api.quotationAction(session.token, businessId, id, action, data, uuid());
      if (result.sale_draft) setDraft(result.sale_draft);
      if (action === 'duplicate' && result.quotation) router.push(`/sales/quotations/${result.quotation.id}/edit` as Href);
      else if (result.quotation) setQuote(result.quotation);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not update quotation.'); }
    finally { setBusy(false); }
  }
  async function issueAndPrint() {
    if (!session || !businessId || !id || !quote || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.quotationAction(session.token, businessId, id, 'issue', { version: quote.version }, uuid());
      if (!result.quotation) throw new Error('Quotation was not issued. Please try again.');
      setQuote(result.quotation);
      router.push(`/sales/quotations/${id}/document?size=a4&print=1` as Href);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not issue quotation.'); }
    finally { setBusy(false); }
  }
  async function checkout() {
    if (quote && Number(paid || 0) < Number(quote.total) && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError('Enter a due date as YYYY-MM-DD.'); return; }
    if (!session || !businessId || !draft) return;
    setBusy(true); setError('');
    try { const result = await api.quotationCheckout(session.token, businessId, draft.id, {
      paid: paid || '0', ...(Number(paid) > 0 ? { account_id: accountId } : {}),
      ...(quote && Number(paid || 0) < Number(quote.total) ? { due_date: dueDate } : {}),
      ...(customerId ? { customer_id: customerId } : {}),
      ...(session.account?.role === 'owner' && prices.some((value, index) => value !== quote?.lines?.[index]?.unit_price) ? { prices } : {}),
    }, checkoutCommand.current);
      router.replace(`/sales/${result.sale.id}` as Href);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not complete sale.'); }
    finally { setBusy(false); }
  }
  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><><ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRefreshCount((count) => count + 1); }} />}>
    <View style={styles.header}><Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/sales/quotations' as Href)} style={styles.back} accessibilityLabel="Back to quotations"><AppSymbol name="back" size={20} color={palette.ink} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>QUOTATION DETAILS</Text><Text style={styles.title}>{quote?.number || 'Draft quotation'}</Text></View>{quote && <View style={styles.statusPill}><Text style={styles.statusText}>{quote.status.toUpperCase()}</Text></View>}</View>
    {quote ? <>
      <View style={styles.summaryGrid}><View style={styles.summaryStat}><AppSymbol name="price" size={17} color={palette.primaryDeep} /><Text style={styles.hint}>Offer total</Text><Text style={styles.summaryValue}>{money(quote.total)}</Text></View><View style={styles.summaryStat}><AppSymbol name="products" size={17} color={palette.primaryDeep} /><Text style={styles.hint}>Products</Text><Text style={styles.summaryValue}>{quote.lines?.length ?? 0}</Text></View></View>
      <View style={styles.card}><Text style={styles.cardTitle}>Offer information</Text><View style={styles.infoGrid}><Info label="Customer" value={quote.customer_name || 'Walk-in buyer'} /><Info label="Phone" value={quote.customer_phone || 'Not provided'} /><Info label="Source" value={quote.location_name || `Shop #${quote.location_id}`} /><Info label="Price type" value={quote.price_tier === 'wholesale' ? 'Wholesale' : 'Retail'} /><Info label="Issued" value={quote.issued_at ? new Date(quote.issued_at).toLocaleDateString() : 'Not issued'} /><Info label="Valid until" value={quote.valid_until || 'Set on issue'} /></View>{!!quote.customer_address && <Info label="Customer address" value={quote.customer_address} />}</View>
      <View style={styles.card}><Text style={styles.cardTitle}>Products</Text>{quote.lines?.map(line => <View key={line.id} style={styles.productRow}><ProductThumbnail uri={line.image_url} /><View style={styles.productCopy}><Text style={styles.productName}>{line.product_name}{line.variant_name ? ` · ${line.variant_name}` : ''}</Text><Text style={styles.hint}>SKU {line.sku || '—'} · {line.unit_name}{Number(line.conversion_factor) !== 1 ? ` × ${line.conversion_factor}` : ''}</Text><Text style={styles.hint}>{line.quantity} × {money(line.unit_price)}</Text></View><Text style={styles.lineTotal}>{money(line.line_total)}</Text></View>)}<View style={styles.totals}><InfoRow label="Subtotal" value={money(quote.subtotal)} /><InfoRow label="Discount" value={`− ${money(quote.discount)}`} /><InfoRow label="Delivery" value={money(quote.delivery_fee)} /><View style={styles.divider} /><InfoRow label="Offer total" value={money(quote.total)} strong /></View></View>
      {(quote.delivery_address || quote.notes) && <View style={styles.card}><Text style={styles.cardTitle}>Delivery & notes</Text>{!!quote.delivery_address && <Info label="Deliver to" value={quote.delivery_address} />}{!!quote.notes && <Info label="Notes" value={quote.notes} />}</View>}
      <View style={styles.card}><Text style={styles.cardTitle}>Quotation document</Text>{quote.status === 'draft' ? <><Text style={styles.hint}>Issue this draft to assign its quotation number and make it ready to print.</Text><Pressable style={styles.primaryAction} disabled={busy} onPress={() => void issueAndPrint()}><AppSymbol name="receipt" size={18} color="#fff" /><Text style={styles.primaryActionText}>Issue & print A4</Text></Pressable><View style={styles.row}><Button label="Edit draft" onPress={() => router.push(`/sales/quotations/${id}/edit` as Href)} /><Button label="Issue only" onPress={() => void act('issue', { version: quote.version })} /></View></> : <><Text style={styles.hint}>Print or share the issued quotation PDF.</Text><View style={styles.row}><Pressable style={styles.primaryAction} onPress={() => router.push(`/sales/quotations/${id}/document?size=a4&print=1` as Href)}><Text style={styles.primaryActionText}>Print A4</Text></Pressable><Pressable style={styles.secondaryAction} onPress={() => router.push(`/sales/quotations/${id}/document?size=a5&print=1` as Href)}><Text style={styles.secondaryActionText}>Print A5</Text></Pressable></View><View style={styles.row}><Button label="View / share PDF" onPress={() => router.push(`/sales/quotations/${id}/document?size=a4` as Href)} /><Button label="Duplicate" onPress={() => void act('duplicate')} /></View></>}</View>
      {quote.status === 'pending' && <View style={styles.row}><Button label="Accept" onPress={() => void act('status', { status: 'accepted' })} /><Button label="Reject" onPress={() => void act('status', { status: 'rejected' })} /><Button label="Cancel" onPress={() => void act('status', { status: 'cancelled' })} /></View>}
      {quote.sale_id && <Button label="View completed sale" onPress={() => router.push(`/sales/${quote.sale_id}` as Href)} />}
      {quote.status === 'accepted' && !quote.sale_id && !draft && <Button label="Create sale draft" onPress={() => void act('convert')} />}
      {draft && <View style={styles.card}><Text style={styles.bold}>Sale checkout</Text><Text style={styles.hint}>Stock is checked again when you complete this sale.</Text>
        <Text style={styles.label}>Customer for dues</Text>
        <Pressable style={styles.customerCard} onPress={() => { setCustomerSearch(''); setCustomerPickerOpen(true); }}>
          <View style={styles.customerIcon}><AppSymbol name="parties" size={17} color={palette.primaryDeep} /></View>
          <View style={styles.customerCopy}><Text style={styles.customerName}>{customerId ? customerName || 'Registered customer' : 'Walk-in buyer'}</Text>
            <Text style={styles.customerHint}>{customerId ? 'Unpaid balance is recorded on this customer' : 'Walk-in must pay in full'}</Text></View><Text style={styles.changeText}>Change</Text>
        </Pressable>
        {session.account.role === 'owner' && quote.lines?.map((line, index) => <View key={line.id}><Text style={styles.label}>{line.product_name} price (owner)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={prices[index] ?? line.unit_price} onChangeText={value => setPrices(old => old.map((price, position) => position === index ? value : price))} /></View>)}
        <Text style={styles.label}>Amount received now (৳)</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={paid} onChangeText={setPaid} placeholder={quote.total} />
        {Number(paid || 0) < Number(quote.total) && <><Text style={styles.label}>Due date *</Text><TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" accessibilityLabel="Customer due date" /></>}
        {Number(paid) > 0 && <View style={styles.wrap}>{accounts.map(account => <Button key={account.id} label={`${account.name}${accountId === account.id ? ' ✓' : ''}`} onPress={() => setAccountId(account.id)} />)}</View>}
        <Button label="Complete sale" onPress={() => void checkout()} />
      </View>}
    </> : <Text style={styles.hint}>Loading quotation…</Text>}
    {!!error && <Text style={styles.error}>{error}</Text>}{busy && <Text style={styles.hint}>Working…</Text>}
  </ScrollView>
  <Modal visible={customerPickerOpen} transparent animationType="slide" onRequestClose={() => setCustomerPickerOpen(false)}>
    <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalSheet}>
      <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>SALE CHECKOUT</Text><Text style={styles.modalTitle}>Choose a customer</Text></View>
        <Pressable style={styles.closeButton} onPress={() => setCustomerPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Close customer picker"><AppSymbol name="close" size={18} color={palette.secondary} /></Pressable>
      </View>
      <View style={styles.modalContent}>
        <TextInput style={styles.input} value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search by name or phone" placeholderTextColor={palette.muted} accessibilityLabel="Search customers by name or phone" />
        <Pressable style={styles.customerResult} onPress={() => { setCustomerId(''); setCustomerName(''); setCustomerPickerOpen(false); }}>
          <View style={styles.resultIcon}><AppSymbol name="sale" size={17} color={palette.primaryDeep} /></View><View style={styles.resultCopy}><Text style={styles.resultName}>Walk-in buyer</Text><Text style={styles.customerHint}>Full payment is required</Text></View>{!customerId && <AppSymbol name="activate" size={18} color={palette.primaryDeep} />}
        </Pressable>
        <FlatList style={styles.customerList} data={customers} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
          onEndReached={() => { if (customerNextPage && !customerLoading) void fetchCustomers(customerSearch.trim(), customerNextPage, true); }} onEndReachedThreshold={0.35}
          renderItem={({ item }) => <Pressable style={styles.customerResult} onPress={() => { setCustomerId(item.id); setCustomerName(item.name || item.phone); setCustomerPickerOpen(false); }}>
            <View style={styles.resultIcon}><AppSymbol name="parties" size={17} color={palette.primaryDeep} /></View><View style={styles.resultCopy}><Text style={styles.resultName} numberOfLines={1}>{item.name || item.phone}</Text><Text style={styles.customerHint}>{item.phone || 'No phone number'}</Text></View>{customerId === item.id && <AppSymbol name="activate" size={18} color={palette.primaryDeep} />}
          </Pressable>}
          ListEmptyComponent={!customerLoading ? <Text style={styles.emptyText}>{customerSearch ? 'No customers match that search.' : 'No registered customers found.'}</Text> : undefined}
          ListFooterComponent={customerLoading ? <ActivityIndicator color={palette.primaryDeep} style={{ padding: 14 }} /> : customerNextPage ? <Pressable style={styles.loadMore} onPress={() => void fetchCustomers(customerSearch.trim(), customerNextPage, true)}><Text style={styles.link}>Load more customers</Text></Pressable> : undefined}
        />
      </View>
    </View></KeyboardAvoidingView>
  </Modal></></SafeAreaView>;
}
function Button({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable style={styles.button} onPress={onPress} accessibilityRole="button"><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function ProductThumbnail({ uri }: { uri?: string }) { const source = resolveAssetUrl(uri); return <View style={styles.thumbnail}>{source ? <Image source={{ uri: source }} style={styles.thumbnailImage} resizeMode="cover" /> : <AppSymbol name="products" size={20} color={palette.primaryDeep} />}</View>; }
function Info({ label, value }: { label: string; value: string }) { return <View style={styles.info}><Text style={styles.hint}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
function InfoRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <View style={styles.infoRow}><Text style={strong ? styles.bold : styles.hint}>{label}</Text><Text style={strong ? styles.total : styles.infoValue}>{value}</Text></View>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, paddingBottom: 80, gap: 11 },
  link: { color: palette.primaryDeep, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', color: palette.ink },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: palette.primaryDeep, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: palette.primarySoft },
  statusText: { color: palette.primaryDeep, fontSize: 10, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', gap: 8 },
  summaryStat: { flex: 1, minHeight: 85, justifyContent: 'center', gap: 5, padding: 12, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  summaryValue: { color: palette.ink, fontSize: 17, fontWeight: '800' },
  status: { color: palette.primaryDeep, fontWeight: '800' },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  label: { color: palette.secondary, fontSize: 12, fontWeight: '700' },
  card: { padding: 13, gap: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 12 },
  cardTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  info: { minWidth: 110, flex: 1, gap: 3 },
  infoValue: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  productCopy: { flex: 1, gap: 3 },
  productName: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  thumbnail: { width: 46, height: 46, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  thumbnailImage: { width: '100%', height: '100%' },
  lineTotal: { color: palette.ink, fontSize: 12, fontWeight: '800' },
  totals: { gap: 8, paddingTop: 8 },
  divider: { height: 1, backgroundColor: palette.border },
  primaryAction: { minHeight: 46, flexGrow: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: palette.primaryDeep },
  primaryActionText: { color: '#fff', fontWeight: '800' },
  secondaryAction: { minHeight: 46, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: palette.primaryDeep },
  secondaryActionText: { color: palette.primaryDeep, fontWeight: '800' },
  bold: { fontWeight: '800', color: palette.ink },
  total: { fontSize: 18, fontWeight: '800', color: palette.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: { backgroundColor: palette.primaryDeep, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  buttonText: { color: '#fff', fontWeight: '700' },
  input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, color: palette.ink },
  customerCard: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15 },
  customerIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  customerCopy: { flex: 1, gap: 3 },
  customerName: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  customerHint: { color: palette.muted, fontSize: 11 },
  changeText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,25,22,.42)' },
  modalSheet: { width: '100%', maxWidth: 640, maxHeight: '88%', minHeight: 0, alignSelf: 'center', backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border },
  modalEyebrow: { color: palette.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  modalTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
  modalContent: { padding: spacing.lg, gap: 10, paddingBottom: 24, flexShrink: 1 },
  customerList: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  customerResult: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: palette.border },
  resultIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft },
  resultCopy: { flex: 1, gap: 3 },
  resultName: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  emptyText: { padding: 18, textAlign: 'center', color: palette.muted },
  loadMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#B42318' },
});
