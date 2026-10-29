import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { DateField } from '@/components/date-field';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { RecordAttachments } from '@/features/attachments/record-attachments';
import { PartyAvatar, PartyButton, PartyInfo, PartyMetric } from '@/features/contacts/party-ui';
import { useAuth } from '@/features/auth/auth-context';
import { MediaPicker } from '@/features/media/media-picker';
import { SelectionToolbar, useRecordSelection } from '@/features/documents/record-selection';
import { api, resolveAssetUrl, type PurchasePaymentAccount, type PurchaseRecord, type Supplier, type SupplierAction,
  type PendingAttachment, type RecordAttachment } from '@/services/api';
import { displayDocumentNumber } from '@/utils/document-number';

const command = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const value = Math.floor(Math.random() * 16);
  return (c === 'x' ? value : (value & 3) | 8).toString(16);
});
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not connect. Try again.';
const currency = (value: string | number) => Number(value || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Screen({ title, icon = 'purchase', backTo = '/purchases', wide = false, children, onRefresh }: {
  title: string; icon?: AppSymbolName; backTo?: string; wide?: boolean; children: React.ReactNode; onRefresh?: () => Promise<unknown> | void;
}) {
  const Scroller = onRefresh ? RefreshableScrollView : ScrollView;
  return <SafeAreaView style={styles.safe}>
    <View style={styles.headerShell}><View style={[styles.header, wide && { maxWidth: 1076 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back"
        onPress={() => router.canGoBack() ? router.back() : router.replace(backTo as Href)} style={styles.backButton}>
        <AppSymbol name="back" size={23} color="#006D64" />
      </Pressable>
      <View style={styles.headerIcon}><AppSymbol name={icon} size={22} color="#006D64" /></View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View></View>
    <Scroller onRefresh={onRefresh!} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
      <View style={[styles.content, wide && { maxWidth: 1040 }]}>{children}</View>
    </Scroller>
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
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const timeout = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const load = useCallback(async (next = 1) => {
    if (!session?.account) return;
    const request = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.suppliers(session.token, session.account.business.id, next, appliedSearch);
      if (request !== requestId.current) return;
      setItems(current => next === 1 ? result.suppliers : [...current, ...result.suppliers]);
      setPage(result.next_page);
      setError('');
    } catch (cause) { if (request === requestId.current) setError(message(cause)); }
    finally { if (request === requestId.current) setLoading(false); }
  }, [session, appliedSearch]);
  useFocusEffect(useCallback(() => { void load(1); }, [load]));
  return <Screen title="Suppliers" icon="parties" backTo="/more" wide onRefresh={() => load(1)}>
    <View style={supplierStyles.topRow}><View style={{ flex: 1, minWidth: 180 }}><Text style={supplierStyles.pageHeading}>Supplier directory</Text><Text style={styles.muted}>Check payables, purchases and supplier account history.</Text></View><PartyButton label="+ Add supplier" primary onPress={() => router.push('/suppliers/new')} /></View>
    <TextInput value={search} onChangeText={setSearch} placeholder="Search supplier name or phone" placeholderTextColor="#83918B" style={supplierStyles.search} accessibilityLabel="Search suppliers" />
    <ErrorText value={error} />
    <Text style={supplierStyles.caption}>{items.length} shown{page ? ' · More available' : ''}</Text>
    {loading && !items.length ? <Text style={styles.muted}>Loading suppliers…</Text> : items.length ? items.map(item => <View key={item.id} style={styles.card}>
      <View style={supplierStyles.listRow}>{item.image_url ? <Image source={{ uri: resolveAssetUrl(item.image_url) || '' }} style={supplierStyles.avatar} contentFit="cover" /> : <PartyAvatar name={item.name} />}
        <View style={supplierStyles.listCopy}><Text style={supplierStyles.personName}>{item.name}</Text><Text style={supplierStyles.role}>SUPPLIER</Text><Text style={styles.muted}>{item.phone || 'No phone'}{[item.area, item.district].filter(Boolean).length ? ` · ${[item.area, item.district].filter(Boolean).join(', ')}` : ''}</Text></View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={[supplierStyles.balance, Number(item.to_pay) > 0 && supplierStyles.due]}>To pay ৳{currency(item.to_pay)}</Text><Text style={styles.muted}>Advance ৳{currency(item.supplier_advance)}</Text></View>
      </View>
      <View style={supplierStyles.actions}><PartyButton label="View details" onPress={() => router.push(`/suppliers/${item.id}` as Href)} />
        {session?.account?.role === 'owner' && item.supplier_ledger_id && <PartyButton label="Supplier ledger" onPress={() => router.push(`/money/account/${item.supplier_ledger_id}` as Href)} />}
      </View>
    </View>) : !error ? <View style={styles.card}><Text style={styles.heading}>{search ? 'No matching suppliers' : 'No suppliers yet'}</Text><Text style={styles.muted}>{search ? 'Try another name or phone.' : 'Add a supplier to start recording purchases.'}</Text></View> : null}
    {page && !loading && <Action label="Load more" secondary onPress={() => void load(page)} />}
  </Screen>;
}

export function SupplierFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);
  const { session } = useAuth();
  const [fields, setFields] = useState({ name: '', phone: '', address: '', area: '', district: '', notes: '', payment_terms: '', opening_payable: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [libraryImage, setLibraryImage] = useState<{ id: string; image_url: string } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const commandId = useRef(command());
  useEffect(() => {
    if (!id || !session?.account) return;
    void api.supplier(session.token, session.account.business.id, id).then(({ supplier }) => {
      setFields(current => ({ ...current, name: supplier.name, phone: supplier.phone, address: supplier.address,
        area: supplier.area, district: supplier.district, notes: supplier.notes, payment_terms: supplier.payment_terms }));
      setExistingImage(supplier.image_url);
    })
      .catch(cause => setError(message(cause)));
  }, [id, session]);
  const set = (key: keyof typeof fields) => (value: string) => setFields(current => ({ ...current, [key]: value }));
  async function pickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82 });
      if (!result.canceled && result.assets[0]) { setImageUri(result.assets[0].uri); setLibraryImage(null); setRemoveImage(false); }
    } catch { setError('Could not select a supplier photo.'); }
  }
  async function save() {
    if (!session?.account) return;
    setBusy(true); setError('');
    try {
      const business = session.account.business.id;
      const { opening_payable, ...profile } = fields;
      const result = editing && id ? await api.updateSupplier(session.token, business, id, profile) :
        await api.createSupplier(session.token, business,
          { ...profile, opening_payable: opening_payable.trim() || '0' }, commandId.current);
      if (libraryImage) await api.attachMedia(session.token, business, libraryImage.id, 'supplier', result.supplier.id);
      else if (imageUri) await api.uploadSupplierImage(session.token, business, result.supplier.id, imageUri);
      else if (removeImage && existingImage) await api.removeSupplierImage(session.token, business, result.supplier.id);
      router.replace(`/suppliers/${result.supplier.id}` as Href);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Screen title={editing ? 'Edit supplier' : 'Add supplier'} icon="parties" backTo="/suppliers">
    <MediaPicker visible={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={(item) => {
      setLibraryImage(item); setImageUri(null); setExistingImage(item.image_url); setRemoveImage(false);
    }} />
    {(imageUri || !removeImage && existingImage) && <Image source={{ uri: imageUri || resolveAssetUrl(existingImage) || '' }}
      style={{ width: 84, height: 84, borderRadius: 14 }} contentFit="cover" />}
    <Action label={imageUri || existingImage ? 'Change supplier photo' : 'Add supplier photo (optional)'} icon="edit" secondary onPress={() => void pickImage()} />
    <Action label="Choose from media library" secondary onPress={() => setLibraryOpen(true)} />
    {!!(imageUri || !removeImage && existingImage) && <Action label="Remove photo" secondary onPress={() => { setImageUri(null); setLibraryImage(null); setRemoveImage(true); }} />}
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
  const selection = useRecordSelection();
  const clearSelection = selection.clear;
  const [nextPurchases, setNextPurchases] = useState<number | null>(null);
  const [activity, setActivity] = useState<{ id: number; description: string; account: string; debit: string; credit: string; created_at: string }[]>([]);
  const [nextActivity, setNextActivity] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<PurchasePaymentAccount[]>([]);
  const [kind, setKind] = useState<SupplierAction['kind']>('payment');
  const [target, setTarget] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [detailTab, setDetailTab] = useState<'purchases' | 'activity' | 'money'>('purchases');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const commandId = useRef(command());
  const load = useCallback(async () => {
    if (!session?.account || !id) return;
    const business = session.account.business.id;
    try {
      const [supplierResult, purchaseResult, activityResult, accountResult] = await Promise.all([
        api.supplier(session.token, business, id), api.purchases(session.token, business, 1, id),
        api.supplierActivity(session.token, business, id), api.purchasePaymentAccounts(session.token, business)]);
      setSupplier(supplierResult.supplier); setPurchases(purchaseResult.purchases); setNextPurchases(purchaseResult.next_page);
      setActivity(activityResult.activity); setNextActivity(activityResult.next_page); setAccounts(accountResult.accounts);
      setAccountId(current => current || accountResult.accounts.find(item => item.is_default)?.id || ''); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session, id]);
  useFocusEffect(useCallback(() => { void load(); return clearSelection; }, [load, clearSelection]));
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
  return <Screen title="Supplier details" icon="parties" backTo="/suppliers" wide onRefresh={load}>
    <ErrorText value={error} />
    {supplier ? <>
      <View style={supplierStyles.profileHeader}>
        {supplier.image_url ? <Image source={{ uri: resolveAssetUrl(supplier.image_url) || '' }} style={supplierStyles.profileImage} contentFit="cover" /> : <PartyAvatar name={supplier.name} size={62} />}
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}><Text style={supplierStyles.profileName}>{supplier.name}</Text><Text style={supplierStyles.role}>SUPPLIER</Text></View>
        <View style={supplierStyles.actions}><PartyButton label="Edit supplier" onPress={() => router.push(`/suppliers/${id}/edit` as Href)} /><PartyButton label="New purchase" primary onPress={() => router.push('/purchases/new')} />
          {session?.account?.role === 'owner' && supplier.supplier_ledger_id && <PartyButton label="View supplier ledger" onPress={() => router.push(`/money/account/${supplier.supplier_ledger_id}` as Href)} />}
        </View>
      </View>
      <View style={supplierStyles.metrics}><PartyMetric label="We owe supplier" value={`৳${currency(supplier.to_pay)}`} tone="due" /><PartyMetric label="Supplier advance" value={`৳${currency(supplier.supplier_advance)}`} /><PartyMetric label="Purchases shown" value={String(purchases.length)} /></View>
      <View style={supplierStyles.columns}>
        <View style={supplierStyles.sideColumn}>
          <View style={styles.card}><Text style={styles.heading}>Contact details</Text><PartyInfo label="Phone" value={supplier.phone || ''} /><PartyInfo label="Address" value={[supplier.address, supplier.area, supplier.district].filter(Boolean).join(', ')} /><PartyInfo label="Payment terms" value={supplier.payment_terms || ''} /></View>
          {!!supplier.notes && <View style={styles.card}><Text style={styles.heading}>Notes</Text><Text style={styles.muted}>{supplier.notes}</Text></View>}
        </View>
        <View style={supplierStyles.mainColumn}>
           <View style={supplierStyles.tabs}><Choice label="Purchases" selected={detailTab === 'purchases'} onPress={() => setDetailTab('purchases')} /><Choice label="Activity" selected={detailTab === 'activity'} onPress={() => { selection.clear(); setDetailTab('activity'); }} /><Choice label="Supplier money" selected={detailTab === 'money'} onPress={() => { selection.clear(); setDetailTab('money'); }} /></View>
          {detailTab === 'purchases' && <>
             <SelectionToolbar type="purchase" rows={purchases} {...selection} onChanged={() => void load()} />
             {purchases.length ? purchases.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.number || 'Draft purchase'}, ${item.status}${selection.selecting ? ', tap to select' : ', long press to select'}`} accessibilityState={{ selected: selection.selected.includes(item.id) }} style={[styles.card, selection.selected.includes(item.id) && { borderColor: '#006D64', backgroundColor: '#DDF3EF' }]} onLongPress={() => selection.longPress(item.id)} onPress={() => selection.press(item.id, () => router.push(`/purchases/${item.id}` as Href))}><View style={supplierStyles.purchaseRow}><View style={{ flex: 1 }}><Text style={supplierStyles.link}>{item.number ? displayDocumentNumber(item.number) : 'Draft purchase'}</Text><Text style={styles.muted}>{item.created_at.slice(0, 10)} · {item.status}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={supplierStyles.balance}>৳{currency(item.total)}</Text><Text style={styles.muted}>Due ৳{currency(item.due)}</Text></View></View></Pressable>)
              : <View style={styles.card}><Text style={styles.muted}>No purchases yet.</Text></View>}
            {nextPurchases && <Action label="More purchases" secondary onPress={() => {
              if (!session?.account) return;
              void api.purchases(session.token, session.account.business.id, nextPurchases, supplier.id)
                .then(result => { setPurchases(current => [...current, ...result.purchases]); setNextPurchases(result.next_page); })
                .catch(cause => setError(message(cause)));
            }} />}
          </>}
          {detailTab === 'activity' && <>
            {activity.length ? activity.map(item => <View key={item.id} style={styles.card}><Text style={supplierStyles.balance}>{item.description}</Text><Text style={styles.muted}>{item.created_at.slice(0, 10)} · {item.account}</Text></View>) : <View style={styles.card}><Text style={styles.muted}>No supplier activity yet.</Text></View>}
            {nextActivity && <Action label="More activity" secondary onPress={() => {
              if (!session?.account) return;
              void api.supplierActivity(session.token, session.account.business.id, supplier.id, nextActivity)
                .then(result => { setActivity(current => [...current, ...result.activity]); setNextActivity(result.next_page); })
                .catch(cause => setError(message(cause)));
            }} />}
            {session?.account?.role === 'owner' && supplier.supplier_ledger_id && <PartyButton label="View supplier ledger for amounts" onPress={() => router.push(`/money/account/${supplier.supplier_ledger_id}` as Href)} />}
          </>}
          {detailTab === 'money' && <View style={styles.card}>
            <Text style={styles.heading}>Record supplier money</Text><Text style={styles.muted}>The server checks each amount before posting.</Text>
            <View style={styles.row}>{(['payment', 'advance', 'advance_refund', 'payment_refund', 'apply_advance', 'allocation_reversal'] as const).map(item =>
              <Choice key={item} label={item.replaceAll('_', ' ')} selected={kind === item} onPress={() => { setKind(item); setTarget(''); commandId.current = command(); }} />)}</View>
            {['payment', 'payment_refund', 'apply_advance', 'allocation_reversal'].includes(kind) && <><Text style={styles.label}>Select payable</Text><View style={styles.row}>
              {supplier.opening_payables?.filter(item => Number(item.due) > 0 || ['payment_refund', 'allocation_reversal'].includes(kind)).map(item =>
                <Choice key={item.id} label={`Opening ৳${currency(item.due)}`} selected={target === `opening:${item.id}`} onPress={() => setTarget(`opening:${item.id}`)} />)}
              {purchases.filter(item => item.status === 'completed').map(item =>
                <Choice key={item.id} label={`${displayDocumentNumber(item.number)} · Due ৳${currency(item.due)}`} selected={target === item.id} onPress={() => setTarget(item.id)} />)}
            </View></>}
            {!['apply_advance', 'allocation_reversal'].includes(kind) && <><Text style={styles.label}>Money account</Text><View style={styles.row}>{accounts.filter(item => item.is_active).map(item =>
              <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => setAccountId(item.id)} />)}</View></>}
            <Field label="Amount ৳" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Action label={busy ? 'Saving…' : 'Record supplier action'} disabled={busy} onPress={() => void postAction()} />
          </View>}
        </View>
      </View>
    </> : !error ? <Text style={styles.muted}>Loading supplier…</Text> : null}
  </Screen>;
}

export function PurchasesScreen() {
  const { session } = useAuth();
  const selection = useRecordSelection();
  const clearSelection = selection.clear;
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
  useFocusEffect(useCallback(() => { void load(); return clearSelection; }, [load, clearSelection]));
  return <Screen title="Purchases" backTo="/more" wide onRefresh={() => load()}><Action label="New purchase" icon="plus" onPress={() => router.push('/purchases/new')} />
     <SelectionToolbar type="purchase" rows={rows} {...selection} onChanged={() => void load()} />
     <ErrorText value={error} />{rows.length === 0 && !error && <Text style={styles.muted}>No purchases yet.</Text>}
     {rows.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.number || 'Draft purchase'}, ${item.status}${selection.selecting ? ', tap to select' : ', long press to select'}`} accessibilityState={{ selected: selection.selected.includes(item.id) }} style={[styles.card, selection.selected.includes(item.id) && { borderColor: '#006D64', backgroundColor: '#DDF3EF' }]} onLongPress={() => selection.longPress(item.id)} onPress={() => selection.press(item.id, () => router.push(`/purchases/${item.id}` as Href))}>
      <Text style={styles.heading}>{item.number ? displayDocumentNumber(item.number) : 'Draft purchase'} · {item.supplier_name}</Text>
      <Text>৳{item.total} · Due ৳{item.due} · {item.status}</Text></Pressable>)}
    {next && <Action label="Load more" secondary onPress={() => void load(next)} />}
  </Screen>;
}

export function PurchaseDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const { session } = useAuth();
  const [purchase, setPurchase] = useState<PurchaseRecord | null>(null);
  const [attachments, setAttachments] = useState<RecordAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [accounts, setAccounts] = useState<PurchasePaymentAccount[]>([]);
  const [paid, setPaid] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const completionCommand = useRef(command());
  const cancellationCommand = useRef(command());
  const paymentCommand = useRef(command());
  const load = useCallback(async () => {
    if (!session?.account || !id) return;
    try {
      const [record, money, documents] = await Promise.all([api.purchase(session.token, session.account.business.id, id),
      api.purchasePaymentAccounts(session.token, session.account.business.id),
      api.recordAttachments(session.token, session.account.business.id, 'purchase', id)]);
      setPurchase(record.purchase); setAccounts(money.accounts);
      if (action === 'cancel' && record.purchase.status !== 'cancelled') setCancelOpen(true);
      setAttachments(documents.attachments);
      setAccountId(current => current || money.accounts.find(item => item.is_default)?.id || ''); setError('');
    } catch (cause) { setError(message(cause)); }
  }, [session, id, action]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function complete() {
    if (!session?.account || !purchase) return;
    if (Number(paid) < Number(purchase.total) && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError('Choose a due date.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api.completePurchase(session.token, session.account.business.id, purchase.id,
        { paid, ...(Number(paid) > 0 && { account_id: accountId }),
          ...(Number(paid) < Number(purchase.total) && { due_date: dueDate }) }, completionCommand.current);
      setPurchase(result.purchase); completionCommand.current = command();
    } catch (cause) { setError(`Purchase was not confirmed: ${message(cause)}. Check this draft before retrying.`); }
    finally { setBusy(false); }
  }
  async function cancel(): Promise<boolean> {
    if (!session?.account || !purchase) return false;
    setBusy(true); setError('');
    try {
      const result = await api.cancelPurchase(session.token, session.account.business.id, purchase.id, reason, cancellationCommand.current);
      setPurchase(result.purchase); cancellationCommand.current = command(); return true;
    } catch (cause) { setError(message(cause)); return false; }
    finally { setBusy(false); }
  }
  async function paySupplier() {
    if (!session?.account || !purchase) return;
    const amount = Number(paymentAmount);
    const due = Number(purchase.due);
    if (!Number.isFinite(amount) || amount <= 0 || amount > due) { setError(`Enter an amount from ৳0.01 to ৳${due.toFixed(2)}.`); return; }
    if (!accountId) { setError('Choose the money account used for this payment.'); return; }
    setBusy(true); setError('');
    try {
      await api.supplierAction(session.token, session.account.business.id, purchase.supplier_id,
        { kind: 'payment', amount: amount.toFixed(2), account_id: accountId, purchase_id: purchase.id }, paymentCommand.current);
      paymentCommand.current = command();
      setPaymentOpen(false); setPaymentAmount('');
      await load();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const due = Number(purchase?.due ?? 0);
  const total = Number(purchase?.total ?? 0);
  const amountPaid = Number(purchase?.paid ?? 0);
  const paidPercent = total > 0 ? Math.min(100, Math.max(0, amountPaid / total * 100)) : 0;
  const completed = purchase?.status === 'completed';
  const statusLabel = purchase?.status === 'cancelled' ? 'Cancelled' : completed ? due <= 0 ? 'Paid in full' : amountPaid > 0 ? 'Partially paid' : 'Unpaid' : 'Draft';
  const activeAccounts = accounts.filter(item => item.is_active);
  const selectedAccount = activeAccounts.find(item => item.id === accountId);
  const willGoNegative = !!selectedAccount && Number(paymentAmount) > Number(selectedAccount.balance);

  return <Screen title={purchase?.number ? displayDocumentNumber(purchase.number) : 'Purchase draft'} backTo="/purchases" onRefresh={load}><ErrorText value={error} />
    {purchase && <>
      <View style={detailStyles.metaHeader}>
        <View style={detailStyles.metaCopy}>
          <Text style={detailStyles.date}>{new Date(purchase.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {purchase.location_name}</Text>
          <Text style={detailStyles.supplierLabel}>SUPPLIER</Text>
          <Text style={detailStyles.supplierName}>{purchase.supplier_name}</Text>
        </View>
        {purchase.status !== 'cancelled' && <Pressable style={detailStyles.moreButton} onPress={() => setMoreOpen(true)} accessibilityRole="button" accessibilityLabel="More purchase actions"><Text style={detailStyles.moreGlyph}>•••</Text></Pressable>}
      </View>

      {completed && <View style={detailStyles.paymentCard}>
        <View style={detailStyles.paymentHeader}><Text style={detailStyles.sectionTitle}>Payment Summary</Text><View style={[detailStyles.badge, due <= 0 ? detailStyles.paidBadge : amountPaid > 0 ? detailStyles.partialBadge : detailStyles.unpaidBadge]}><Text style={[detailStyles.badgeText, due <= 0 ? detailStyles.paidBadgeText : amountPaid > 0 ? detailStyles.partialBadgeText : detailStyles.unpaidBadgeText]}>{statusLabel}</Text></View></View>
        <View style={detailStyles.totalLine}><Text style={detailStyles.totalLabel}>Purchase Total</Text><Text style={detailStyles.totalValue}>৳{total.toFixed(2)}</Text></View>
        <View style={detailStyles.duePanel}><Text style={detailStyles.dueCaption}>REMAINING TO PAY</Text><Text style={detailStyles.dueValue}>৳{due.toFixed(2)}</Text></View>
        <View style={detailStyles.progressTrack}><View style={[detailStyles.progress, { width: `${paidPercent}%` }]} /></View>
        <View style={detailStyles.paidLine}><Text style={detailStyles.paidText}>Paid ৳{amountPaid.toFixed(2)}</Text><Text style={detailStyles.paidText}>{paidPercent.toFixed(1)}% paid</Text></View>
        {due > 0 && <Action label="Pay Supplier" icon="receive" onPress={() => { setPaymentAmount(due.toFixed(2)); setPaymentOpen(true); setError(''); }} />}
        <Action label="View Payment History" secondary onPress={() => router.push(`/suppliers/${purchase.supplier_id}` as Href)} />
      </View>}

      {purchase.status === 'draft' && <View style={styles.card}>
        <Text style={detailStyles.sectionTitle}>Purchase Summary</Text>
        <Text style={styles.muted}>Total ৳{purchase.total} · Received at {purchase.location_name}</Text>
        <Action label="Edit draft" icon="edit" secondary onPress={() => router.push(`/purchases/${purchase.id}/edit` as Href)} />
        <Field label="Pay now ৳" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" />
        {Number(paid) < Number(purchase.total) && <View style={styles.field}><Text style={styles.label}>Due date *</Text><DateField label="Supplier due date" value={dueDate} onChange={setDueDate} /></View>}
        {Number(paid) > 0 && <View style={styles.row}>{activeAccounts.map(item => <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => setAccountId(item.id)} />)}</View>}
        <Text style={styles.muted}>Completing confirms the purchase and updates stock and supplier balance.</Text>
        <Action label={busy ? 'Completing…' : 'Complete purchase'} icon="default" disabled={busy} onPress={() => void complete()} />
      </View>}

      <View style={detailStyles.itemsHeader}><Text style={detailStyles.sectionTitle}>Purchased Items</Text><Text style={styles.muted}>{purchase.lines?.length ?? 0} {(purchase.lines?.length ?? 0) === 1 ? 'product' : 'products'}</Text></View>
      {purchase.lines?.map(line => <View key={line.id} style={detailStyles.itemRow}>
        {line.image_url ? <Image source={{ uri: resolveAssetUrl(line.image_url) || '' }} style={detailStyles.itemImage} contentFit="cover" cachePolicy="disk" /> : <View style={detailStyles.itemPlaceholder}><AppSymbol name="products" size={20} color="#75847E" /></View>}
        <View style={detailStyles.itemCopy}><Text style={detailStyles.itemName} numberOfLines={2}>{line.product_name}{line.variant_name ? ` · ${line.variant_name}` : ''}</Text><Text style={detailStyles.itemMeta}>{line.quantity} {line.unit_name || 'unit'} × ৳{line.unit_cost}</Text>{!!line.lot_code && <Text style={styles.muted}>Batch {line.lot_code}</Text>}</View>
        <Text style={detailStyles.itemTotal}>৳{Number(line.line_total).toFixed(2)}</Text>
      </View>)}
      {(purchase.notes || purchase.added_notes?.length) && <View style={styles.card}><Text style={styles.heading}>Notes</Text>{!!purchase.notes && <Text style={styles.muted}>{purchase.notes}</Text>}{purchase.added_notes?.map((item, index) => <View key={`${item.created_at}-${index}`}><Text style={styles.muted}>{new Date(item.created_at).toLocaleString()} · {item.actor}</Text><Text>{item.text}</Text></View>)}</View>}
      <View style={styles.card}><RecordAttachments kind="purchase" pending={pendingAttachments} onChange={setPendingAttachments}
        existing={attachments} token={session?.token} businessId={session?.account?.business.id} recordId={purchase.id}
        onUploaded={() => { void load(); }} /></View>
      {purchase.status === 'cancelled' && <Text style={styles.muted}>This purchase was cancelled.</Text>}
    </>}

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
      <KeyboardAvoidingView style={detailStyles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={detailStyles.sheet} contentContainerStyle={detailStyles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={detailStyles.sheetHeader}><View><Text style={detailStyles.sheetTitle}>Pay Supplier</Text><Text style={styles.muted}>৳{due.toFixed(2)} due · {purchase?.supplier_name}</Text></View><Pressable onPress={() => setPaymentOpen(false)} style={detailStyles.closeButton}><AppSymbol name="close" size={18} color="#52635E" /></Pressable></View>
        <Text style={detailStyles.fieldLabel}>Amount to Pay</Text>
        <Field label="৳" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" />
        <Text style={detailStyles.fieldLabel}>Pay From</Text>
        <View style={styles.row}>{activeAccounts.map(item => <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => setAccountId(item.id)} />)}</View>
        {willGoNegative && <Text style={detailStyles.balanceWarning}>Warning: this payment exceeds {selectedAccount?.name}&apos;s available balance of ৳{currency(selectedAccount?.balance ?? 0)}. The accounting balance will become negative.</Text>}
        <View style={detailStyles.remainingBox}><Text style={styles.muted}>Remaining After Payment</Text><Text style={detailStyles.remainingValue}>৳{Math.max(0, due - (Number(paymentAmount) || 0)).toFixed(2)}</Text></View>
        <Action label={busy ? 'Recording payment…' : 'Confirm Payment'} disabled={busy || activeAccounts.length === 0} onPress={() => void paySupplier()} />
      </ScrollView></KeyboardAvoidingView>
    </Modal>

    <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
      <Pressable style={detailStyles.menuBackdrop} onPress={() => setMoreOpen(false)}><View style={detailStyles.menu}>
        <Pressable style={detailStyles.menuItem} onPress={() => { setMoreOpen(false); setCancelOpen(true); }}><AppSymbol name="close" size={18} color="#A62925" /><Text style={detailStyles.cancelText}>Cancel Purchase</Text></Pressable>
      </View></Pressable>
    </Modal>
    <Modal visible={cancelOpen} transparent animationType="slide" onRequestClose={() => setCancelOpen(false)}>
      <KeyboardAvoidingView style={detailStyles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={detailStyles.sheet} contentContainerStyle={detailStyles.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={detailStyles.sheetHeader}><View><Text style={detailStyles.sheetTitle}>Cancel Purchase</Text><Text style={styles.muted}>This reverses its posted stock and balance effects.</Text></View><Pressable onPress={() => setCancelOpen(false)} style={detailStyles.closeButton}><AppSymbol name="close" size={18} color="#52635E" /></Pressable></View>
        <Field label="Cancellation reason *" value={reason} onChangeText={setReason} multiline />
        <Action label={busy ? 'Cancelling…' : 'Confirm Cancellation'} secondary disabled={busy || !reason.trim()} onPress={() => { void cancel().then(cancelled => { if (cancelled) setCancelOpen(false); }); }} />
      </ScrollView></KeyboardAvoidingView>
    </Modal>
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

const supplierStyles = StyleSheet.create({
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pageHeading: { color: '#15211F', fontSize: 20, fontWeight: '800' },
  search: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: 'white', paddingHorizontal: 14, color: '#15211F' },
  caption: { color: '#67766F', fontSize: 11 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 },
  listCopy: { flex: 1, minWidth: 170, gap: 5 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  personName: { color: '#15211F', fontSize: 16, fontWeight: '800' },
  role: { color: '#9A5A13', fontSize: 10, fontWeight: '800' },
  balance: { color: '#15211F', fontSize: 12, fontWeight: '700' },
  due: { color: '#A9630F' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 13, paddingVertical: 6 },
  profileImage: { width: 62, height: 62, borderRadius: 31 },
  profileName: { color: '#15211F', fontSize: 25, fontWeight: '800' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  sideColumn: { flexGrow: 1, flexBasis: 290, minWidth: 260, gap: 12 },
  mainColumn: { flexGrow: 2, flexBasis: 400, minWidth: 280, gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  purchaseRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  link: { color: '#006D64', fontSize: 13, fontWeight: '800' },
});

const detailStyles = StyleSheet.create({
  metaHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 4 },
  metaCopy: { flex: 1, gap: 5 }, date: { color: '#52635E', fontSize: 12 }, supplierLabel: { color: '#75847E', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 7 }, supplierName: { color: '#15211F', fontSize: 20, fontWeight: '800' },
  moreButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2EAE4', alignItems: 'center', justifyContent: 'center' }, moreGlyph: { color: '#52635E', fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  paymentCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE8E2', borderRadius: 18, padding: 17, gap: 14 }, paymentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, sectionTitle: { color: '#15211F', fontSize: 17, fontWeight: '800' }, badge: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 }, paidBadge: { backgroundColor: '#E5F8F4' }, partialBadge: { backgroundColor: '#FFF5E1' }, unpaidBadge: { backgroundColor: '#FCEBE9' }, badgeText: { fontSize: 10, fontWeight: '800' }, paidBadgeText: { color: '#006D64' }, partialBadgeText: { color: '#AE741B' }, unpaidBadgeText: { color: '#A62925' },
  totalLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, totalLabel: { color: '#52635E', fontSize: 13 }, totalValue: { color: '#15211F', fontSize: 15, fontWeight: '700' }, duePanel: { backgroundColor: '#F6F8F7', borderRadius: 14, padding: 14, gap: 4 }, dueCaption: { color: '#52635E', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 }, dueValue: { color: '#15211F', fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }, progressTrack: { height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: '#E5ECE9' }, progress: { height: '100%', borderRadius: 4, backgroundColor: '#00A18F' }, paidLine: { flexDirection: 'row', justifyContent: 'space-between' }, paidText: { color: '#52635E', fontSize: 12, fontWeight: '600' },
  itemsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 5 }, itemRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2EAE4', borderRadius: 15 }, itemImage: { width: 56, height: 56, borderRadius: 11, backgroundColor: '#F6F8F7' }, itemPlaceholder: { width: 56, height: 56, borderRadius: 11, backgroundColor: '#F1F5F3', alignItems: 'center', justifyContent: 'center' }, itemCopy: { flex: 1, gap: 4, minWidth: 0 }, itemName: { color: '#15211F', fontSize: 13, fontWeight: '700' }, itemMeta: { color: '#52635E', fontSize: 11 }, itemTotal: { color: '#15211F', fontSize: 13, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,25,22,.45)' }, sheet: { width: '100%', maxWidth: 620, maxHeight: '85%', alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#FFFFFF' }, sheetContent: { padding: 20, paddingBottom: 28, gap: 13 }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }, sheetTitle: { color: '#15211F', fontSize: 21, fontWeight: '800', marginBottom: 3 }, closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F3' }, fieldLabel: { color: '#344943', fontSize: 13, fontWeight: '700', marginBottom: -7 }, balanceWarning: { color: '#8A4B08', backgroundColor: '#FFF5E1', borderWidth: 1, borderColor: '#F2D7A0', padding: 11, borderRadius: 11, fontSize: 12, lineHeight: 18 }, remainingBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 13, borderRadius: 12, backgroundColor: '#F6F8F7' }, remainingValue: { color: '#15211F', fontSize: 16, fontWeight: '800' },
  menuBackdrop: { flex: 1, justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 105, paddingHorizontal: 18, backgroundColor: 'rgba(15,25,22,.22)' }, menu: { width: 210, backgroundColor: '#FFFFFF', borderRadius: 13, padding: 6, elevation: 5 }, menuItem: { minHeight: 45, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 }, cancelText: { color: '#A62925', fontSize: 13, fontWeight: '700' },
});
