import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api, type MoneyAccount, type Product, type ProductUnit, type PurchaseInput,
  type PurchaseLineInput, type PurchaseRecord, type StockBatch, type StockLocation,
  type Supplier, type SupplierAction, type Variant } from '@/services/api';

const command = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const value = Math.floor(Math.random() * 16);
  return (c === 'x' ? value : (value & 3) | 8).toString(16);
});
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not connect. Try again.';

function Screen({ title, icon = 'purchase', backTo = '/purchases', children }: {
  title: string; icon?: AppSymbolName; backTo?: string; children: React.ReactNode;
}) {
  return <SafeAreaView style={styles.safe}>
    <View style={styles.headerShell}><View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back"
        onPress={() => router.canGoBack() ? router.back() : router.replace(backTo as Href)} style={styles.backButton}>
        <AppSymbol name="back" size={23} color="#006D64" />
      </Pressable>
      <View style={styles.headerIcon}><AppSymbol name={icon} size={22} color="#006D64" /></View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.content}>{children}</View>
    </ScrollView>
  </SafeAreaView>;
}
function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'phone-pad'; multiline?: boolean;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    style={[styles.input, multiline && { minHeight: 82, textAlignVertical: 'top' }]}
    value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType}
    multiline={multiline} placeholderTextColor="#8A9891" /></View>;
}
function Action({ label, onPress, disabled, secondary, icon }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: AppSymbolName }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.action, secondary && styles.secondary, disabled && { opacity: 0.5 }]}>
    {icon && <AppSymbol name={icon} size={18} color={secondary ? '#006D64' : '#FFFFFF'} />}
    <Text style={[styles.actionText, secondary && { color: '#006D64' }]}>{label}</Text>
  </Pressable>;
}
function SectionHeading({ icon, children }: { icon: AppSymbolName; children: React.ReactNode }) {
  return <View style={styles.sectionHeading}><AppSymbol name={icon} size={19} color="#006D64" />
    <Text style={styles.heading}>{children}</Text></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.choice, selected && styles.chosen]}><Text style={styles.choiceText}>{label}</Text></Pressable>;
}
function ErrorText({ value }: { value: string }) { return value ? <Text style={styles.error}>{value}</Text> : null; }

export function SuppliersScreen() {
  const { session } = useAuth();
  const [items, setItems] = useState<Supplier[]>([]);
  const [page, setPage] = useState<number | null>(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async (next = 1, term = search) => {
    if (!session?.account) return;
    try {
      const result = await api.suppliers(session.token, session.account.business.id, next, term);
      setItems(current => next === 1 ? result.suppliers : [...current, ...result.suppliers]);
      setPage(result.next_page); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session, search]);
  useFocusEffect(useCallback(() => { void load(1); }, [load]));
  return <Screen title="Suppliers" icon="parties" backTo="/more"><Field label="Search suppliers" value={search} onChangeText={setSearch} placeholder="Name or phone" />
    <Action label="Search" secondary onPress={() => void load(1, search)} />
    <Action label="Add supplier" icon="plus" onPress={() => router.push('/suppliers/new')} />
    <ErrorText value={error} />
    {items.length === 0 && !error && <Text style={styles.muted}>No suppliers yet.</Text>}
    {items.map(item => <Pressable key={item.id} style={styles.card} onPress={() => router.push(`/suppliers/${item.id}` as Href)}>
      <Text style={styles.heading}>{item.name}</Text><Text style={styles.muted}>{item.phone || 'No phone'}</Text>
      <Text>To pay ৳{item.to_pay} · Advance ৳{item.supplier_advance}</Text>
    </Pressable>)}
    {page && <Action label="Load more" secondary onPress={() => void load(page)} />}
  </Screen>;
}

export function SupplierFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const { session } = useAuth();
  const [fields, setFields] = useState({ name: '', phone: '', address: '', area: '', district: '', notes: '', payment_terms: '', opening_payable: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const commandId = useRef(command());
  useEffect(() => {
    if (!id || !session?.account) return;
    void api.supplier(session.token, session.account.business.id, id).then(({ supplier }) =>
      setFields(current => ({ ...current, name: supplier.name, phone: supplier.phone, address: supplier.address,
        area: supplier.area, district: supplier.district, notes: supplier.notes, payment_terms: supplier.payment_terms })))
      .catch(cause => setError(message(cause)));
  }, [id, session]);
  const set = (key: keyof typeof fields) => (value: string) => setFields(current => ({ ...current, [key]: value }));
  async function save() {
    if (!session?.account) return;
    setBusy(true); setError('');
    try {
      const business = session.account.business.id;
      const { opening_payable, ...profile } = fields;
      const result = editing && id ? await api.updateSupplier(session.token, business, id, profile) :
        await api.createSupplier(session.token, business, fields, commandId.current);
      router.replace(`/suppliers/${result.supplier.id}` as Href);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={editing ? 'Edit supplier' : 'Add supplier'} icon="parties" backTo="/suppliers">
    <Field label="Name *" value={fields.name} onChangeText={set('name')} />
    <Field label="Phone (optional)" value={fields.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
    <Field label="Address" value={fields.address} onChangeText={set('address')} />
    <Field label="Area" value={fields.area} onChangeText={set('area')} />
    <Field label="District" value={fields.district} onChangeText={set('district')} />
    <Field label="Payment terms" value={fields.payment_terms} onChangeText={set('payment_terms')} />
    <Field label="Notes" value={fields.notes} onChangeText={set('notes')} multiline />
    {!editing && <Field label="Opening payable (৳, optional)" value={fields.opening_payable}
      onChangeText={set('opening_payable')} keyboardType="decimal-pad" />}
    <Text style={styles.muted}>A new supplier starts with zero balance unless you enter an opening payable.</Text>
    <ErrorText value={error} /><Action label={busy ? 'Saving…' : 'Save supplier'} icon="default" disabled={busy} onPress={() => void save()} />
  </Screen>;
}

export function SupplierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [nextPurchases, setNextPurchases] = useState<number | null>(null);
  const [activity, setActivity] = useState<{ id: number; description: string; account: string; debit: string; credit: string }[]>([]);
  const [nextActivity, setNextActivity] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [kind, setKind] = useState<SupplierAction['kind']>('payment');
  const [target, setTarget] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const commandId = useRef(command());
  const load = useCallback(async () => {
    if (!session?.account || !id) return;
    const business = session.account.business.id;
    try {
      const [supplierResult, purchaseResult, activityResult, accountResult] = await Promise.all([
        api.supplier(session.token, business, id), api.purchases(session.token, business, 1, id),
        api.supplierActivity(session.token, business, id), api.moneyAccounts(session.token, business)]);
      setSupplier(supplierResult.supplier); setPurchases(purchaseResult.purchases); setNextPurchases(purchaseResult.next_page);
      setActivity(activityResult.activity); setNextActivity(activityResult.next_page); setAccounts(accountResult.accounts);
      setAccountId(current => current || accountResult.accounts.find(item => item.is_default)?.id || ''); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function postAction() {
    if (!session?.account || !supplier) return;
    const needsTarget = ['payment', 'payment_refund', 'apply_advance', 'allocation_reversal'].includes(kind);
    if (needsTarget && !target) { setError('Choose a purchase or opening payable.'); return; }
    const data: SupplierAction = { kind, amount, ...(!['apply_advance', 'allocation_reversal'].includes(kind) && { account_id: accountId }),
      ...(target.startsWith('opening:') ? { opening_id: target.slice(8) } : target ? { purchase_id: target } : {}) };
    setBusy(true); setError('');
    try {
      await api.supplierAction(session.token, session.account.business.id, supplier.id, data, commandId.current);
      commandId.current = command(); setAmount(''); await load();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={supplier?.name || 'Supplier details'} icon="parties" backTo="/suppliers">
    <ErrorText value={error} />
    {supplier && <><Text style={styles.heading}>To pay ৳{supplier.to_pay}</Text>
      <Text style={styles.heading}>Advance ৳{supplier.supplier_advance}</Text>
      <Text style={styles.muted}>{[supplier.phone, supplier.address, supplier.area, supplier.district].filter(Boolean).join(' · ') || 'No contact details'}</Text>
      {!!supplier.payment_terms && <Text>Terms: {supplier.payment_terms}</Text>}
      <Action label="Edit supplier" icon="edit" secondary onPress={() => router.push(`/suppliers/${id}/edit` as Href)} />
      <Action label="New purchase from this supplier" icon="purchase" onPress={() => router.push(`/purchases/new?supplierId=${id}`)} />
      <Text style={styles.heading}>Supplier money</Text>
      <View style={styles.row}>{(['payment', 'advance', 'advance_refund', 'payment_refund', 'apply_advance', 'allocation_reversal'] as const)
        .map(item => <Choice key={item} label={item.replaceAll('_', ' ')} selected={kind === item}
          onPress={() => { setKind(item); setTarget(''); commandId.current = command(); }} />)}</View>
      {['payment', 'payment_refund', 'apply_advance', 'allocation_reversal'].includes(kind) && <>
        <Text style={styles.label}>Select payable</Text><View style={styles.row}>
          {supplier.opening_payables?.filter(item => Number(item.due) > 0 || ['payment_refund', 'allocation_reversal'].includes(kind))
            .map(item => <Choice key={item.id} label={`Opening ৳${item.due}`} selected={target === `opening:${item.id}`}
              onPress={() => setTarget(`opening:${item.id}`)} />)}
          {purchases.filter(item => item.status === 'completed').map(item =>
            <Choice key={item.id} label={`${item.number} · Due ৳${item.due}`} selected={target === item.id}
              onPress={() => setTarget(item.id)} />)}
        </View></>}
      {!['apply_advance', 'allocation_reversal'].includes(kind) && <><Text style={styles.label}>Money account</Text>
        <View style={styles.row}>{accounts.filter(item => item.is_active).map(item =>
          <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => setAccountId(item.id)} />)}</View></>}
      <Field label="Amount ৳" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Action label={busy ? 'Saving…' : 'Record supplier action'} disabled={busy} onPress={() => void postAction()} />
      <Text style={styles.heading}>Purchases</Text>
      {purchases.map(item => <Pressable key={item.id} style={styles.card} onPress={() => router.push(`/purchases/${item.id}` as Href)}>
        <Text style={styles.heading}>{item.number || 'Draft purchase'} · ৳{item.total}</Text><Text>{item.status} · Due ৳{item.due}</Text>
      </Pressable>)}
      {nextPurchases && <Action label="More purchases" secondary onPress={() => {
        if (!session?.account) return;
        void api.purchases(session.token, session.account.business.id, nextPurchases, supplier.id)
          .then(result => { setPurchases(current => [...current, ...result.purchases]); setNextPurchases(result.next_page); })
          .catch(cause => setError(message(cause)));
      }} />}
      <Text style={styles.heading}>Statement</Text>
      {activity.map(item => <View key={item.id} style={styles.card}><Text>{item.description}</Text>
        <Text style={styles.muted}>{item.account} · Debit ৳{item.debit} · Credit ৳{item.credit}</Text></View>)}
      {nextActivity && <Action label="More activity" secondary onPress={() => {
        if (!session?.account) return;
        void api.supplierActivity(session.token, session.account.business.id, supplier.id, nextActivity)
          .then(result => { setActivity(current => [...current, ...result.activity]); setNextActivity(result.next_page); })
          .catch(cause => setError(message(cause)));
      }} />}
    </>}
  </Screen>;
}

export function PurchasesScreen() {
  const { session } = useAuth();
  const [rows, setRows] = useState<PurchaseRecord[]>([]);
  const [next, setNext] = useState<number | null>(1);
  const [error, setError] = useState('');
  const load = useCallback(async (page = 1) => {
    if (!session?.account) return;
    try {
      const result = await api.purchases(session.token, session.account.business.id, page);
      setRows(current => page === 1 ? result.purchases : [...current, ...result.purchases]);
      setNext(result.next_page); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Screen title="Purchases" backTo="/more"><Action label="New purchase" icon="plus" onPress={() => router.push('/purchases/new')} />
    <ErrorText value={error} />{rows.length === 0 && !error && <Text style={styles.muted}>No purchases yet.</Text>}
    {rows.map(item => <Pressable key={item.id} style={styles.card} onPress={() => router.push(`/purchases/${item.id}` as Href)}>
      <Text style={styles.heading}>{item.number || 'Draft purchase'} · {item.supplier_name}</Text>
      <Text>৳{item.total} · Due ৳{item.due} · {item.status}</Text></Pressable>)}
    {next && <Action label="Load more" secondary onPress={() => void load(next)} />}
  </Screen>;
}

type EditableLine = PurchaseLineInput & { key: string; productName: string; variants: Variant[]; units: ProductUnit[]; batches: StockBatch[]; newLot: string; newExpiry: string };
const emptyLine = (): EditableLine => ({ key: command(), product_id: '', quantity: '1', unit_cost: '', productName: '', variants: [], units: [], batches: [], newLot: '', newExpiry: '' });

export function PurchaseFormScreen() {
  const { id, supplierId, locationId } = useLocalSearchParams<{ id?: string; supplierId?: string; locationId?: string }>();
  const { session } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [supplier, setSupplier] = useState(supplierId || '');
  const [location, setLocation] = useState(locationId || '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [productSearch, setProductSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draftCommand = useRef(command());
  useEffect(() => {
    if (!session?.account) return;
    const business = session.account.business.id;
    void Promise.all([api.suppliers(session.token, business), api.products(session.token, business, { active: 'true' }),
      api.locations(session.token, business), ...(id ? [api.purchase(session.token, business, id)] : [])])
      .then(([supplierResult, productResult, locationResult, existing]) => {
        setSuppliers(supplierResult.suppliers); setProducts(productResult.products); setLocations(locationResult.locations);
        setLocation(current => current || String(locationResult.locations.find(item => item.is_default)?.id || ''));
        if (existing && 'purchase' in existing) {
          const draft = existing.purchase as PurchaseRecord;
          setSupplier(draft.supplier_id); setLocation(String(draft.location_id)); setNotes(draft.notes);
          void Promise.all((draft.lines || []).map(async item => {
            const [detail, unitResult, batchResult] = await Promise.all([
              api.product(session.token, business, item.product_id),
              api.productUnits(session.token, business, item.product_id, item.variant_id),
              api.productBatches(session.token, business, item.product_id, item.variant_id)]);
            return { ...item, key: command(), productName: item.product_name, newLot: '', newExpiry: '',
              variants: detail.variants || [], units: unitResult.units, batches: batchResult.batches };
          })).then(loaded => setLines(loaded.length ? loaded : [emptyLine()])).catch(cause => setError(message(cause)));
        }
      }).catch(cause => setError(message(cause)));
  }, [session, id]);
  useEffect(() => {
    if (!session?.account || !productSearch.trim()) return;
    const timer = setTimeout(() => {
      void api.products(session.token, session.account!.business.id, { search: productSearch, active: 'true' })
        .then(result => setProducts(result.products))
        .catch(cause => setError(message(cause)));
    }, 250);
    return () => clearTimeout(timer);
  }, [session, productSearch]);
  const updateLine = (key: string, change: Partial<EditableLine>) => setLines(current =>
    current.map(item => item.key === key ? { ...item, ...change } : item));
  async function chooseProduct(key: string, product: Product) {
    if (!session?.account) return;
    try {
      const detail = await api.product(session.token, session.account.business.id, product.id);
      const variant = detail.variants?.find(item => item.is_active);
      updateLine(key, { product_id: product.id, productName: product.name, variant_id: variant?.id,
        unit_id: undefined, batch_id: undefined, unit_cost: variant?.purchase_price || product.purchase_price || '',
        variants: detail.variants || [], units: [], batches: [] });
      if (variant) await chooseVariant(key, product.id, variant.id);
    } catch (cause) { setError(message(cause)); }
  }
  async function chooseVariant(key: string, productId: string, variantId: string) {
    if (!session?.account) return;
    try {
      const business = session.account.business.id;
      const [unitsResult, batchesResult] = await Promise.all([
        api.productUnits(session.token, business, productId, variantId),
        api.productBatches(session.token, business, productId, variantId)]);
      updateLine(key, { variant_id: variantId, unit_id: undefined, batch_id: undefined,
        units: unitsResult.units, batches: batchesResult.batches });
    } catch (cause) { setError(message(cause)); }
  }
  async function createLineBatch(line: EditableLine) {
    if (!session?.account || !line.variant_id || !line.newLot.trim()) {
      setError('Choose a variant and enter a batch identifier.'); return;
    }
    const tracking = line.variants.find(item => item.id === line.variant_id)?.tracking_mode;
    if (tracking === 'expiry' && !/^\d{4}-\d{2}-\d{2}$/.test(line.newExpiry)) {
      setError('Enter an expiry date as YYYY-MM-DD.'); return;
    }
    try {
      const result = await api.createBatch(session.token, session.account.business.id, line.product_id,
        { variant_id: line.variant_id, lot_code: line.newLot.trim(), expires_on: line.newExpiry || null });
      updateLine(line.key, { batch_id: result.batch.id, batches: [...line.batches, result.batch], newLot: '', newExpiry: '' });
      setError('');
    } catch (cause) { setError(message(cause)); }
  }
  async function save() {
    if (!session?.account) return;
    if (!supplier || !location || lines.some(item => !item.product_id || !item.quantity || !item.unit_cost)) {
      setError('Choose a supplier, location, product, quantity and cost for every line.'); return;
    }
    const payload: PurchaseInput = { supplier_id: supplier, location_id: Number(location), notes,
      lines: lines.map(({ product_id, variant_id, unit_id, batch_id, quantity, unit_cost }) =>
        ({ product_id, ...(variant_id && { variant_id }), ...(unit_id && { unit_id }),
          ...(batch_id && { batch_id }), quantity, unit_cost })) };
    setBusy(true); setError('');
    try {
      const business = session.account.business.id;
      const result = id ? await api.updatePurchase(session.token, business, id, payload, draftCommand.current) :
        await api.createPurchase(session.token, business, payload, draftCommand.current);
      router.replace(`/purchases/${result.purchase.id}` as Href);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={id ? 'Edit purchase draft' : 'New purchase'} backTo="/purchases">
    <Text style={styles.muted}>Saving a draft leaves stock and balances unchanged. Complete it online from the next screen.</Text>
    <SectionHeading icon="parties">Supplier</SectionHeading><View style={styles.row}>{suppliers.map(item =>
      <Choice key={item.id} label={item.name} selected={supplier === item.id} onPress={() => setSupplier(item.id)} />)}</View>
    <Action label="Add supplier" icon="plus" secondary onPress={() => router.push('/suppliers/new')} />
    <SectionHeading icon="location">Receive at</SectionHeading><View style={styles.row}>{locations.filter(item => item.is_active).map(item =>
      <Choice key={item.id} label={item.name} selected={location === String(item.id)} onPress={() => setLocation(String(item.id))} />)}</View>
    {lines.map((line, index) => <View key={line.key} style={styles.card}>
      <SectionHeading icon="products">Product {index + 1}</SectionHeading>
      <Field label="Find product" value={productSearch} onChangeText={setProductSearch} placeholder="Search by name" />
      <View style={styles.row}>{products.filter(item => item.is_active && item.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 25)
        .map(item => <Choice key={item.id} label={item.name} selected={line.product_id === item.id}
          onPress={() => void chooseProduct(line.key, item)} />)}</View>
      {!!line.product_id && <><Text style={styles.label}>Variant</Text><View style={styles.row}>{line.variants.filter(item => item.is_active)
        .map(item => <Choice key={item.id} label={item.label || item.sku || 'Standard'} selected={line.variant_id === item.id}
          onPress={() => void chooseVariant(line.key, line.product_id, item.id)} />)}</View>
        <Text style={styles.label}>Packaging unit</Text><View style={styles.row}>
          <Choice label="Base unit" selected={!line.unit_id} onPress={() => updateLine(line.key, { unit_id: undefined })} />
          {line.units.filter(item => item.is_active).map(item => <Choice key={item.id} label={`${item.name} (${item.factor})`}
            selected={line.unit_id === item.id} onPress={() => updateLine(line.key, { unit_id: item.id })} />)}</View>
        {(line.variants.find(item => item.id === line.variant_id)?.tracking_mode !== 'simple') && <>
          <Text style={styles.label}>Batch required</Text><View style={styles.row}>{line.batches.map(item =>
            <Choice key={item.id} label={`${item.lot_code}${item.expires_on ? ` · ${item.expires_on}` : ''}`}
              selected={line.batch_id === item.id} onPress={() => updateLine(line.key, { batch_id: item.id })} />)}</View>
          <Field label="New batch identifier" value={line.newLot} onChangeText={value => updateLine(line.key, { newLot: value })} />
          {line.variants.find(item => item.id === line.variant_id)?.tracking_mode === 'expiry' &&
            <Field label="Expiry YYYY-MM-DD" value={line.newExpiry} onChangeText={value => updateLine(line.key, { newExpiry: value })} />}
          <Action label="Create batch" icon="batch" secondary onPress={() => void createLineBatch(line)} /></>}
      </>}
      <Field label="Quantity" value={line.quantity} onChangeText={value => updateLine(line.key, { quantity: value })} keyboardType="decimal-pad" />
      <Field label="Cost per selected unit ৳" value={line.unit_cost} onChangeText={value => updateLine(line.key, { unit_cost: value })} keyboardType="decimal-pad" />
      {lines.length > 1 && <Action label="Remove line" icon="minus" secondary onPress={() => setLines(current => current.filter(item => item.key !== line.key))} />}
    </View>)}
    <Action label="Add another product" icon="plus" secondary onPress={() => setLines(current => [...current, emptyLine()])} />
    <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
    <ErrorText value={error} /><Action label={busy ? 'Saving…' : 'Save draft'} icon="default" disabled={busy} onPress={() => void save()} />
  </Screen>;
}

export function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [purchase, setPurchase] = useState<PurchaseRecord | null>(null);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [paid, setPaid] = useState('0');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const completionCommand = useRef(command());
  const cancellationCommand = useRef(command());
  const load = useCallback(async () => {
    if (!session?.account || !id) return;
    try {
      const [record, money] = await Promise.all([api.purchase(session.token, session.account.business.id, id),
        api.moneyAccounts(session.token, session.account.business.id)]);
      setPurchase(record.purchase); setAccounts(money.accounts);
      setAccountId(current => current || money.accounts.find(item => item.is_default)?.id || ''); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function complete() {
    if (!session?.account || !purchase) return;
    setBusy(true); setError('');
    try {
      const result = await api.completePurchase(session.token, session.account.business.id, purchase.id,
        { paid, ...(Number(paid) > 0 && { account_id: accountId }) }, completionCommand.current);
      setPurchase(result.purchase); completionCommand.current = command();
    } catch (cause) { setError(`Purchase was not confirmed: ${message(cause)}. Check this draft before retrying.`); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!session?.account || !purchase) return;
    setBusy(true); setError('');
    try {
      const result = await api.cancelPurchase(session.token, session.account.business.id, purchase.id, reason, cancellationCommand.current);
      setPurchase(result.purchase); cancellationCommand.current = command();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={purchase?.number || 'Purchase draft'} backTo="/purchases"><ErrorText value={error} />
    {purchase && <><Text style={styles.heading}>{purchase.supplier_name}</Text>
      <Text style={styles.muted}>{purchase.status} · {purchase.created_at.slice(0, 10)}</Text>
      <Text style={styles.muted}>Received at {purchase.location_name}</Text>
      <Text style={styles.heading}>Total ৳{purchase.total}</Text><Text>Paid ৳{purchase.paid} · Due ৳{purchase.due}</Text>
      {purchase.lines?.map(line => <View key={line.id} style={styles.card}>
        <Text style={styles.heading}>{line.product_name}{line.variant_name ? ` · ${line.variant_name}` : ''}</Text>
        <Text>{line.quantity} {line.unit_name || 'unit'} × ৳{line.unit_cost} = ৳{line.line_total}</Text>
        {!!line.lot_code && <Text style={styles.muted}>Batch {line.lot_code}</Text>}
      </View>)}
      {purchase.status === 'draft' && <>
        <Action label="Edit draft" icon="edit" secondary onPress={() => router.push(`/purchases/${purchase.id}/edit` as Href)} />
        <Field label="Pay now ৳" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" />
        {Number(paid) > 0 && <View style={styles.row}>{accounts.filter(item => item.is_active).map(item =>
          <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => setAccountId(item.id)} />)}</View>}
        <Text style={styles.muted}>Completing requires an online confirmation before stock and বাকি are posted.</Text>
        <Action label={busy ? 'Completing…' : 'Complete purchase online'} icon="default" disabled={busy} onPress={() => void complete()} />
      </>}
      {purchase.status === 'completed' && <Action label="Supplier account and payments" secondary
        onPress={() => router.push(`/suppliers/${purchase.supplier_id}` as Href)} />}
      {purchase.status !== 'cancelled' && <>
        {purchase.status === 'completed' && <Field label="Cancellation reason" value={reason} onChangeText={setReason} />}
        <Action label={busy ? 'Working…' : 'Cancel purchase'} secondary disabled={busy} onPress={() => void cancel()} />
      </>}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, scroll: { alignItems: 'center', padding: 18, paddingBottom: 80 },
  headerShell: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2EAE4', alignItems: 'center' },
  header: { width: '100%', maxWidth: 636, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18 },
  backButton: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E0F3EA' },
  headerIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E0F3EA' },
  content: { width: '100%', maxWidth: 600, gap: 12 }, title: { flex: 1, fontSize: 22, fontWeight: '700', color: '#15211F' },
  heading: { fontSize: 17, fontWeight: '700', color: '#15211F' }, muted: { color: '#52635E', fontSize: 13 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#344943' }, field: { gap: 6 },
  input: { backgroundColor: '#FFFFFF', borderColor: '#DCE5DF', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: '#15211F', fontSize: 16 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2EAE4', borderRadius: 16, padding: 16, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { borderWidth: 1, borderColor: '#DCE5DF',
    backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  chosen: { borderColor: '#006D64', backgroundColor: '#E0F3EA' }, choiceText: { color: '#15211F', fontSize: 13 },
  action: { backgroundColor: '#006D64', borderRadius: 12, minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 10 },
  secondary: { backgroundColor: '#E0F3EA' }, actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  error: { color: '#A62925', backgroundColor: '#FCEBE9', padding: 12, borderRadius: 10 },
});
