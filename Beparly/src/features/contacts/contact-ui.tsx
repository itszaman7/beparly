import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { AppSymbol } from '@/components/app-symbol';
import { PartyAvatar, PartyButton, PartyInfo, PartyMetric } from '@/features/contacts/party-ui';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { api, type Contact, type SaleRecord } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';

const money = (value: string | number) => formatBdt(String(value || 0));
type Role = 'all' | 'customer' | 'supplier';
type Tab = 'sales' | 'activity';
type StatementRow = { date: string; description: string; kind: string; debit: string; credit: string };

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><View style={styles.headerInner}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/more' as Href)} style={styles.back}><AppSymbol name="back" size={20} color="#006D64" /></Pressable>
      <Text style={styles.title}>{title}</Text>
    </View></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}><View style={styles.content}>{children}</View></ScrollView>
  </SafeAreaView>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#83918B" style={styles.input} /></View>;
}

function RoleLabels({ contact }: { contact: Contact }) {
  return <View style={styles.roleRow}>
    {contact.is_customer && <Text style={styles.customerRole}>CUSTOMER</Text>}
    {contact.is_supplier && <Text style={styles.supplierRole}>SUPPLIER</Text>}
    {contact.customer_type === 'wholesale' && contact.is_customer && <Text style={styles.wholesaleRole}>WHOLESALE</Text>}
  </View>;
}

export function ContactsScreen() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const [items, setItems] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [role, setRole] = useState<Role>('all');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [customer, setCustomer] = useState(true);
  const [supplier, setSupplier] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setAppliedQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);
  const load = useCallback(async (page = 1) => {
    if (!session || !businessId) return;
    const request = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.contacts(session.token, businessId, page, appliedQuery, role);
      if (request !== requestId.current) return;
      setItems((current) => page === 1 ? result.contacts : [...current, ...result.contacts]);
      setNextPage(result.next_page);
      setError('');
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : 'Could not load contacts.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [session, businessId, appliedQuery, role]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    if (!session || !businessId || busy) return;
    if (!name.trim() || !customer && !supplier) { setError('Enter a name and choose customer, supplier, or both.'); return; }
    if (customer && !phone.trim()) { setError('Enter a Bangladeshi mobile number for the customer.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.createContact(session.token, businessId, { name: name.trim(), phone: phone.trim(), address: address.trim(), is_customer: customer, is_supplier: supplier });
      setName(''); setPhone(''); setAddress(''); setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add contact.');
    } finally {
      setBusy(false);
    }
  }

  return <Shell title="Contacts">
    <View style={styles.topRow}><View style={{ flex: 1, minWidth: 200 }}><Text style={styles.pageHeading}>Customers & suppliers</Text><Text style={styles.muted}>Find people, check dues, and open their account ledger.</Text></View><PartyButton label={adding ? 'Close form' : '+ Add contact'} primary onPress={() => setAdding(!adding)} /></View>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search name, phone or location" placeholderTextColor="#83918B" style={styles.search} accessibilityLabel="Search contacts" />
    <View style={styles.chips}><Chip label="All" selected={role === 'all'} onPress={() => setRole('all')} /><Chip label="Customers" selected={role === 'customer'} onPress={() => setRole('customer')} /><Chip label="Suppliers" selected={role === 'supplier'} onPress={() => setRole('supplier')} /></View>
    {adding && <View style={styles.card}><Text style={styles.sectionTitle}>Add contact</Text><View style={styles.formRow}><Field label="Name" value={name} onChangeText={setName} /><Field label={customer ? 'Mobile number *' : 'Phone (optional)'} value={phone} onChangeText={setPhone} /><Field label="Address (optional)" value={address} onChangeText={setAddress} /></View><View style={styles.chips}><Chip label="Customer" selected={customer} onPress={() => setCustomer(!customer)} /><Chip label="Supplier" selected={supplier} onPress={() => setSupplier(!supplier)} /></View><PartyButton label={busy ? 'Saving…' : 'Save contact'} primary onPress={() => void save()} /></View>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Text style={styles.caption}>{items.length} shown{nextPage ? ' · More available' : ''}</Text>
    {loading && !items.length ? <ActivityIndicator color="#006D64" /> : items.length ? items.map((item) => <View key={item.id} style={styles.card}>
      <View style={styles.listRow}><PartyAvatar name={item.name} /><View style={styles.listCopy}><Text style={styles.personName}>{item.name}</Text><RoleLabels contact={item} /><Text style={styles.muted}>{item.phone || 'No phone'}{[item.area, item.district].filter(Boolean).length ? ` · ${[item.area, item.district].filter(Boolean).join(', ')}` : ''}</Text></View>
        <View style={styles.balanceCopy}>{item.is_customer && <Text style={[styles.balance, Number(item.to_collect) > 0 && styles.due]}>To collect {money(item.to_collect)}</Text>}{item.is_supplier && <Text style={[styles.balance, Number(item.to_pay) > 0 && styles.due]}>To pay {money(item.to_pay)}</Text>}</View>
      </View>
      <View style={styles.actions}><PartyButton label="View details" onPress={() => router.push(`/contacts/${item.id}` as Href)} />
        {item.is_customer && item.customer_ledger_id && <PartyButton label="Customer ledger" onPress={() => router.push(`/money/account/${item.customer_ledger_id}` as Href)} />}
        {item.is_supplier && item.supplier_ledger_id && <PartyButton label="Supplier ledger" onPress={() => router.push(`/money/account/${item.supplier_ledger_id}` as Href)} />}
      </View>
    </View>) : <View style={styles.card}><Text style={styles.sectionTitle}>{appliedQuery || role !== 'all' ? 'No matching contacts' : 'No contacts yet'}</Text><Text style={styles.muted}>{appliedQuery || role !== 'all' ? 'Try another name, phone, location or role.' : 'Add a customer or supplier to get started.'}</Text></View>}
    {nextPage && !loading && <PartyButton label="Load more contacts" onPress={() => void load(nextPage)} />}
  </Shell>;
}

export function ContactDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const stacked = width < 760;
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const [contact, setContact] = useState<Contact | null>(null);
  const [statement, setStatement] = useState<StatementRow[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [tab, setTab] = useState<Tab>('sales');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!session || !businessId || !id) return;
    let active = true;
    void api.contact(session.token, businessId, id).then((detail) => {
      if (!active) return;
      setContact(detail.contact); setStatement(detail.statement); setError('');
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load contact.'); })
      .finally(() => { if (active) setLoading(false); });
    if (id) void api.sales(session.token, businessId, id).then((recent) => {
      if (active) setSales(recent.sales);
    }).catch(() => {});
    return () => { active = false; };
  }, [session, businessId, id]));

  return <Shell title="Contact details">
    {!!error && <Text style={styles.error}>{error}</Text>}
    {loading && !contact ? <ActivityIndicator color="#006D64" /> : contact ? <>
      <View style={styles.profileHeader}><PartyAvatar name={contact.name} size={62} /><View style={{ flex: 1, minWidth: 180, gap: 4 }}><Text style={styles.profileName}>{contact.name}</Text><RoleLabels contact={contact} /></View>
        <View style={styles.actions}>{contact.is_customer && contact.customer_ledger_id && <PartyButton label="View customer ledger" primary onPress={() => router.push(`/money/account/${contact.customer_ledger_id}` as Href)} />}{contact.is_supplier && contact.supplier_ledger_id && <PartyButton label="View supplier ledger" onPress={() => router.push(`/money/account/${contact.supplier_ledger_id}` as Href)} />}</View>
      </View>
      <View style={styles.metrics}>{contact.is_customer && <PartyMetric label="Customer owes" value={money(contact.to_collect)} tone="due" />}{contact.is_supplier && <PartyMetric label="We owe supplier" value={money(contact.to_pay)} tone="due" />}{contact.is_customer && <PartyMetric label="Customer advance" value={money(contact.customer_advance)} />}{contact.is_supplier && <PartyMetric label="Supplier advance" value={money(contact.supplier_advance)} />}</View>
      <View style={styles.columns}><View style={[styles.sideColumn, stacked && styles.stackedColumn]}>
        <View style={styles.card}><Text style={styles.sectionTitle}>Contact details</Text><PartyInfo label="Phone" value={contact.phone || ''} /><PartyInfo label="Address" value={[contact.address, contact.area, contact.district].filter(Boolean).join(', ')} />{contact.is_customer && <PartyInfo label="Customer type" value={contact.customer_type === 'wholesale' ? 'Wholesale' : 'Regular'} />}</View>
        {!!contact.notes && <View style={styles.card}><Text style={styles.sectionTitle}>Notes</Text><Text style={styles.muted}>{contact.notes}</Text></View>}
      </View><View style={[styles.mainColumn, stacked && styles.stackedColumn]}>
        <View style={styles.chips}><Chip label="Recent sales" selected={tab === 'sales'} onPress={() => setTab('sales')} /><Chip label="Activity" selected={tab === 'activity'} onPress={() => setTab('activity')} /></View>
        {tab === 'sales' ? sales.length ? sales.map((sale) => <Pressable key={sale.id} onPress={() => router.push(`/sales/${sale.id}/details` as Href)} style={styles.card}><View style={styles.saleRow}><View style={styles.saleCopy}><Text style={styles.link}>{displayDocumentNumber(sale.invoice_number)}</Text><Text style={styles.muted}>{sale.invoice_date || sale.created_at.slice(0, 10)} · {sale.status}</Text></View><View style={styles.saleAmounts}><Text style={styles.balance}>{money(sale.net_total ?? sale.total)}</Text><Text style={styles.muted}>Due {money(sale.due)}</Text></View></View></Pressable>)
          : <View style={styles.card}><Text style={styles.muted}>No sales found in the recent sales list.</Text></View>
          : statement.length ? statement.slice(0, 20).map((row, index) => <View key={`${row.date}-${row.kind}-${index}`} style={styles.card}><Text style={styles.balance}>{row.description}</Text><Text style={styles.muted}>{row.date} · {row.kind}</Text></View>)
          : <View style={styles.card}><Text style={styles.muted}>No activity yet.</Text></View>}
        {tab === 'activity' && contact.customer_ledger_id && <PartyButton label="View customer ledger for amounts" onPress={() => router.push(`/money/account/${contact.customer_ledger_id}` as Href)} />}
      </View></View>
    </> : !error ? <View style={styles.card}><Text style={styles.muted}>Contact not found.</Text></View> : null}
  </Shell>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' },
  header: { backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#E2EAE4', alignItems: 'center' },
  headerInner: { width: '100%', maxWidth: 1080, minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#E5F8F4', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#15211F', fontSize: 21, fontWeight: '800' },
  scroll: { alignItems: 'center', padding: 18, paddingBottom: 90 },
  content: { width: '100%', maxWidth: 1040, gap: 13 },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pageHeading: { color: '#15211F', fontSize: 20, fontWeight: '800' },
  muted: { color: '#52635E', fontSize: 12, lineHeight: 18 },
  caption: { color: '#67766F', fontSize: 11 },
  search: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: 'white', paddingHorizontal: 14, color: '#15211F' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' },
  chipSelected: { borderColor: '#006D64', backgroundColor: '#E5F8F4' },
  chipText: { color: '#52635E', fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: '#006D64' },
  card: { padding: 16, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: '#E2EAE4', backgroundColor: 'white' },
  sectionTitle: { color: '#15211F', fontSize: 15, fontWeight: '800' },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexGrow: 1, flexBasis: 200, minWidth: 180, gap: 6 },
  fieldLabel: { color: '#344943', fontSize: 12, fontWeight: '700' },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#DCE6E2', paddingHorizontal: 12, color: '#15211F' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 },
  listCopy: { flex: 1, minWidth: 170, gap: 5 },
  personName: { color: '#15211F', fontSize: 16, fontWeight: '800' },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  customerRole: { color: '#006D64', fontSize: 10, fontWeight: '800' },
  supplierRole: { color: '#9A5A13', fontSize: 10, fontWeight: '800' },
  wholesaleRole: { color: '#52635E', fontSize: 10, fontWeight: '800' },
  balanceCopy: { alignItems: 'flex-end', gap: 5 },
  balance: { color: '#15211F', fontSize: 12, fontWeight: '700' },
  due: { color: '#A9630F' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: '#A62925', backgroundColor: '#FCEBE9', padding: 12, borderRadius: 10 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 13, paddingVertical: 6 },
  profileName: { color: '#15211F', fontSize: 25, fontWeight: '800' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  columns: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  sideColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 290, minWidth: 0, gap: 12 },
  mainColumn: { flexGrow: 2, flexShrink: 1, flexBasis: 400, minWidth: 0, gap: 10 },
  stackedColumn: { width: '100%', flexBasis: '100%', flexGrow: 0, flexShrink: 0 },
  saleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  saleCopy: { flexGrow: 1, flexShrink: 1, minWidth: 130 },
  saleAmounts: { alignItems: 'flex-end', flexShrink: 0 },
  link: { color: '#006D64', fontSize: 13, fontWeight: '800' },
});
