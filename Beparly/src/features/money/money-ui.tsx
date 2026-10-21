import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, XStack, YStack } from 'tamagui';

import { AppSymbol } from '@/components/app-symbol';
import { elevation, palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { api, type BusinessAsset, type Contact, type MoneyAccount, type MoneyTransaction } from '@/services/api';

const ink = '#15211F';
const muted = '#52635E';
const green = '#006D64';
const border = '#E5ECE9';
const background = '#F6F8F7';

const id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});

const bdt = (value: string | number) => formatBdt(String(value));

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor="white">
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/more' as Href)} style={{ width: 42, height: 42, justifyContent: 'center' }}>
        <AppSymbol name="back" size={23} color={green} />
      </Pressable>
      <Text color={ink} fontSize={22} fontWeight="700">{title}</Text>
    </XStack>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: 110, alignItems: 'center' }}>
      <YStack width="100%" maxWidth={560} gap={14}>{children}</YStack>
    </ScrollView>
  </SafeAreaView>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <YStack backgroundColor="white" borderWidth={1} borderColor={border} borderRadius={18} padding={17} gap={10}>{children}</YStack>;
}

function Field({ label, value, onChangeText, placeholder, numeric = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; numeric?: boolean }) {
  return <YStack gap={6}>
    <Text color={ink} fontSize={13} fontWeight="700">{label}</Text>
    <Input value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={numeric ? 'decimal-pad' : 'default'}
      height={52} backgroundColor="white" borderColor={border} color={ink} style={{ borderRadius: 12 }} />
  </YStack>;
}

function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: selected ? green : border, backgroundColor: selected ? '#E5F8F4' : 'white' }}>
    <Text color={selected ? green : ink} fontSize={13} fontWeight={selected ? '700' : '500'}>{label}</Text>
  </Pressable>;
}

function ErrorText({ message }: { message: string }) {
  return message ? <Text accessibilityRole="alert" color="#A62925" fontSize={13}>{message}</Text> : null;
}

function useBusiness() {
  const { session } = useAuth();
  return { token: session?.token, businessId: session?.account?.business.id, owner: session?.account?.role === 'owner' };
}

export function MoneyHome() {
  const { token, businessId, owner } = useBusiness();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [transactions, setTransactions] = useState<MoneyTransaction[]>([]);
  const [available, setAvailable] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reverseId, setReverseId] = useState(''); const [reverseReason, setReverseReason] = useState('');
  const [reverseCommand, setReverseCommand] = useState(id()); const [reversing, setReversing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'in' | 'out' | 'transfer' | 'expense'>('all');
  const refresh = useCallback(async () => {
    if (!token || !businessId || !owner) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [money, history] = await Promise.all([api.moneyAccounts(token, businessId), api.moneyTransactions(token, businessId)]);
      setAccounts(money.accounts); setAvailable(money.available_money); setTransactions(history.transactions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load money.'); }
    finally { setLoading(false); }
  }, [token, businessId, owner]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function submitReversal() {
    if (!token || !businessId || !reverseId || !reverseReason.trim()) { setError('Enter a correction reason.'); return; }
    setReversing(true); setError('');
    try { await api.reverseMoneyTransaction(token, businessId, reverseId, reverseReason.trim(), reverseCommand);
      setReverseId(''); setReverseReason(''); setReverseCommand(id()); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reverse transaction.'); }
    finally { setReversing(false); }
  }
  const visibleTransactions = transactions.filter((item) => {
    if (historyFilter === 'all') return true;
    if (historyFilter === 'transfer') return item.kind === 'transfer';
    if (historyFilter === 'expense') return item.kind === 'expense';
    const incoming = ['owner_contribution', 'other_income', 'customer_advance', 'supplier_advance_refund', 'asset_sale'];
    const outgoing = ['owner_drawing', 'supplier_advance', 'customer_advance_refund', 'asset_purchase'];
    return historyFilter === 'in' ? incoming.includes(item.kind) : outgoing.includes(item.kind);
  });
  return <Page title="Money">
    {!owner ? <Card><Text color={muted}>Only the business owner can manage money right now.</Text></Card> : loading ? <ActivityIndicator color={green} /> : <>
      <ErrorText message={error} />
      <Card><Text color={muted} fontSize={13}>Available money · Across your money accounts</Text><Text color={Number(available) < 0 ? '#A62925' : ink} fontSize={32} fontWeight="700">{bdt(available)}</Text>{Number(available) < 0 && <Text color="#A62925" fontSize={12}>Below zero</Text>}</Card>
      <XStack flexWrap="wrap" gap={9}>
        {([
          { label: 'Money In', kind: 'in', icon: 'receive', color: palette.primaryDeep, soft: palette.primarySoft },
          { label: 'Money Out', kind: 'out', icon: 'purchase', color: palette.orange, soft: palette.orangeSoft },
          { label: 'Transfer', kind: 'transfer', icon: 'transfer', color: palette.blue, soft: palette.blueSoft },
          { label: 'Expenses', kind: 'expense', icon: 'expense', color: palette.purple, soft: palette.purpleSoft },
        ] as const).map((action) =>
          <Pressable key={action.kind} accessibilityRole="button" accessibilityLabel={action.label}
            onPress={() => router.push(`/money/new?flow=${action.kind}` as Href)}
            style={({ pressed }) => ({ width: '48%', flexGrow: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 8,
              borderRadius: 16, borderWidth: 1, borderColor: pressed ? action.color : border,
              backgroundColor: 'white', opacity: pressed ? 0.75 : 1, ...elevation.card })}>
            <YStack width={43} height={43} borderRadius={13} alignItems="center" justifyContent="center" backgroundColor={action.soft}>
              <AppSymbol name={action.icon} size={24} color={action.color} />
            </YStack>
            <Text color={ink} fontSize={14} fontWeight="700">{action.label}</Text>
          </Pressable>)}
      </XStack>
      <XStack justifyContent="space-between" alignItems="center"><Text color={ink} fontSize={18} fontWeight="700">My accounts</Text><Button borderWidth={1} borderColor={palette.primary} backgroundColor="white" onPress={() => router.push('/money/accounts' as Href)}><AppSymbol name="plus" size={16} color={green} /><Text color={green} fontWeight="700">Add</Text></Button></XStack>
      {accounts.slice(0, 5).map((account) => <Card key={account.id}><XStack justifyContent="space-between"><Text color={ink} fontWeight="700">{account.name}</Text><Text color={Number(account.balance) < 0 ? '#A62925' : ink} fontWeight="700">{bdt(account.balance)}</Text></XStack><Text color={muted} fontSize={12}>{account.kind === 'wallet' ? 'Mobile wallet' : account.kind}{Number(account.balance) < 0 ? ' · Below zero' : ''}</Text></Card>)}
      <Button height={48} borderWidth={1} borderColor={palette.primary} backgroundColor="white" onPress={() => router.push('/money/accounts-list' as Href)}><Text color={green} fontWeight="700">View all accounts</Text><AppSymbol name="chevron" size={18} color={green} /></Button>
      <Text color={ink} fontSize={18} fontWeight="700" marginTop={8}>Recent transactions</Text>
      <XStack flexWrap="wrap" gap={7}>{(['all', 'in', 'out', 'transfer', 'expense'] as const).map((value) => <Choice key={value} label={value === 'all' ? 'All' : value === 'expense' ? 'Expenses' : value === 'transfer' ? 'Transfers' : value === 'in' ? 'Money In' : 'Money Out'} selected={historyFilter === value} onPress={() => setHistoryFilter(value)} />)}</XStack>
      {visibleTransactions.length ? visibleTransactions.map((item) => <Card key={item.id}><XStack justifyContent="space-between"><YStack flex={1}><Text color={ink} fontWeight="700">{item.kind.replaceAll('_', ' ')}</Text><Text color={muted} fontSize={12}>{item.event_date}{item.reversed ? ' · Reversed' : ''}</Text></YStack><Text color={ink} fontWeight="700">{bdt(item.amount)}</Text></XStack>
        {!item.reversed && !item.kind.startsWith('asset_') && !item.kind.endsWith('_reversal') && <Button backgroundColor="#FFF5E1" onPress={() => { setReverseId(item.id); setReverseReason(''); setReverseCommand(id()); }}><Text color="#8B5E15">Correct this transaction</Text></Button>}
        {reverseId === item.id && <><Field label="Why is this being reversed?" value={reverseReason} onChangeText={(value) => { setReverseReason(value); setReverseCommand(id()); }} />
          <XStack gap={8}><Button flex={1} backgroundColor="#E5F8F4" onPress={() => setReverseId('')}><Text color={green}>Cancel</Text></Button><Button flex={1} backgroundColor="#A62925" disabled={reversing} onPress={() => void submitReversal()}><Text color="white">{reversing ? 'Saving…' : 'Confirm reversal'}</Text></Button></XStack></>}
      </Card>) : <Card><Text color={muted}>No money movements yet.</Text></Card>}
    </>}
  </Page>;
}

export function MoneyAccountForm() {
  const { token, businessId } = useBusiness();
  const [name, setName] = useState(''); const [kind, setKind] = useState<MoneyAccount['kind']>('bank');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [createCommand] = useState(id());
  async function save() {
    if (!token || !businessId || busy) return;
    setBusy(true); setError('');
    try {
      await api.createMoneyAccount(token, businessId, { name: name.trim(), kind, masked_reference: reference.trim() }, createCommand);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save account.'); }
    finally { setBusy(false); }
  }
  return <Page title="Add money account"><Card><Text color={muted}>Cash, bank and wallets each have their own balance. Move existing money with Transfer.</Text></Card>
      <Field label="Account name" value={name} onChangeText={setName} placeholder="e.g. BRAC Bank or bKash" />
      <XStack flexWrap="wrap" gap={8}>{(['cash', 'bank', 'wallet', 'other'] as const).map((option) => <Choice key={option} label={option === 'wallet' ? 'Mobile wallet' : option} selected={kind === option} onPress={() => setKind(option)} />)}</XStack>
      <Field label="Masked reference (optional)" value={reference} onChangeText={setReference} placeholder="Last four digits" />
    <ErrorText message={error} /><Button backgroundColor={green} height={52} disabled={busy} onPress={() => void save()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : 'Save account'}</Text></Button>
  </Page>;
}

export function MoneyAccountsList() {
  const { token, businessId, owner } = useBusiness();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    if (!token || !businessId || !owner) { setLoading(false); return; }
    setLoading(true);
    void api.moneyAccounts(token, businessId).then((result) => { setAccounts(result.accounts); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load accounts.'))
      .finally(() => setLoading(false));
  }, [token, businessId, owner]));
  return <Page title="My accounts">
    {!owner ? <Card><Text color={muted}>Only the business owner can view money accounts.</Text></Card> : <>
      <Button height={50} backgroundColor={green} onPress={() => router.push('/money/accounts' as Href)}><AppSymbol name="plus" size={18} color="white" /><Text color="white" fontWeight="700">Add account</Text></Button>
      <ErrorText message={error} />
      {loading ? <ActivityIndicator color={green} /> : accounts.map((account) =>
        <Card key={account.id}><XStack justifyContent="space-between" alignItems="center" gap={12}>
          <YStack flex={1} gap={4}><Text color={ink} fontSize={16} fontWeight="700">{account.name}</Text><Text color={muted} fontSize={12}>{account.kind === 'wallet' ? 'Mobile wallet' : account.kind}{account.is_default ? ' · Default' : ''}{account.masked_reference ? ` · ${account.masked_reference}` : ''}</Text></YStack>
          <Text color={Number(account.balance) < 0 ? '#A62925' : ink} fontWeight="700">{bdt(account.balance)}</Text>
        </XStack></Card>)}
    </>}
  </Page>;
}

const reasons = {
  in: [['owner_contribution', 'Owner added money'], ['other_income', 'Other income'], ['customer_advance', 'Customer advance'], ['supplier_advance_refund', 'Supplier returned advance']],
  out: [['owner_drawing', 'Owner withdrawal'], ['supplier_advance', 'Supplier advance'], ['customer_advance_refund', 'Refund customer advance']],
  transfer: [['transfer', 'Transfer between accounts']],
  expense: [['expense', 'Business expense']],
} as const;

export function MoneyForm() {
  const { flow = 'in' } = useLocalSearchParams<{ flow: string }>();
  const mode = flow in reasons ? flow as keyof typeof reasons : 'in';
  const { token, businessId } = useBusiness();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]); const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [kind, setKind] = useState<string>(reasons[mode][0][0]); const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(''); const [destinationId, setDestinationId] = useState('');
  const [contactId, setContactId] = useState(''); const [categoryId, setCategoryId] = useState<number | null>(null);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [command, setCommand] = useState(id());
  const [reviewing, setReviewing] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    void Promise.all([api.moneyAccounts(token, businessId), api.contacts(token, businessId), api.expenseCategories(token, businessId)])
      .then(([money, parties, expenses]) => { setAccounts(money.accounts.filter((item) => item.is_active)); setContacts(parties.contacts); setCategories(expenses.categories);
        setAccountId((current) => current || money.accounts[0]?.id || ''); setCategoryId((current) => current ?? expenses.categories[0]?.id ?? null); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load form choices.'));
  }, [token, businessId]));
  function changed(update: () => void) { update(); setCommand(id()); setReviewing(false); }
  async function submit() {
    if (!token || !businessId || busy) return;
    setBusy(true); setError('');
    try {
      await api.postMoneyTransaction(token, businessId, { kind, amount, account_id: accountId,
        ...(kind === 'transfer' ? { destination_id: destinationId } : {}),
        ...(kind.includes('advance') ? { contact_id: contactId } : {}),
        ...(kind === 'expense' && categoryId ? { category_id: categoryId, event_date: eventDate } : {}), note }, command);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save transaction.'); }
    finally { setBusy(false); }
  }
  return <Page title={mode === 'in' ? 'Money In' : mode === 'out' ? 'Money Out' : mode === 'transfer' ? 'Transfer money' : 'Expense'}>
    <Text color={muted} fontSize={13}>The amount is confirmed by the server before it changes your balance.</Text>
    <Field label="Amount (৳)" value={amount} onChangeText={(value) => changed(() => setAmount(value))} numeric />
    <Text color={ink} fontWeight="700">Reason</Text><XStack flexWrap="wrap" gap={8}>{reasons[mode].map(([value, label]) => <Choice key={value} label={label} selected={kind === value} onPress={() => changed(() => setKind(value))} />)}</XStack>
    <Text color={ink} fontWeight="700">{mode === 'in' ? 'Received into' : 'Paid from'}</Text><XStack flexWrap="wrap" gap={8}>{accounts.map((item) => <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => changed(() => setAccountId(item.id))} />)}</XStack>
    {kind === 'transfer' && <><Text color={ink} fontWeight="700">Transfer to</Text><XStack flexWrap="wrap" gap={8}>{accounts.filter((item) => item.id !== accountId).map((item) => <Choice key={item.id} label={item.name} selected={destinationId === item.id} onPress={() => changed(() => setDestinationId(item.id))} />)}</XStack></>}
    {kind.includes('advance') && <><Text color={ink} fontWeight="700">{kind.startsWith('customer') ? 'Customer' : 'Supplier'}</Text><XStack flexWrap="wrap" gap={8}>{contacts.filter((item) => kind.startsWith('customer') ? item.is_customer : item.is_supplier).map((item) => <Choice key={item.id} label={item.name} selected={contactId === item.id} onPress={() => changed(() => setContactId(item.id))} />)}</XStack><Button backgroundColor="#E5F8F4" onPress={() => router.push('/contacts' as Href)}><Text color={green}>+ Add contact</Text></Button></>}
    {kind === 'expense' && <><Text color={ink} fontWeight="700">Category</Text><XStack flexWrap="wrap" gap={8}>{categories.map((item) => <Choice key={item.id} label={item.name} selected={categoryId === item.id} onPress={() => changed(() => setCategoryId(item.id))} />)}</XStack></>}
    {kind === 'expense' && <Field label="Expense date (YYYY-MM-DD)" value={eventDate} onChangeText={(value) => changed(() => setEventDate(value))} />}
    <Field label="Note (optional)" value={note} onChangeText={(value) => changed(() => setNote(value))} />
    {mode === 'transfer' && reviewing && <Card><Text color={ink} fontWeight="700">Review transfer</Text><Text color={ink}>{accounts.find((item) => item.id === accountId)?.name} → {accounts.find((item) => item.id === destinationId)?.name}</Text><Text color={ink}>{bdt(amount || '0')}</Text></Card>}
    <ErrorText message={error} /><Button backgroundColor={green} height={54} disabled={busy} onPress={() => mode === 'transfer' && !reviewing ? setReviewing(true) : void submit()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : mode === 'transfer' && !reviewing ? 'Review transfer' : 'Confirm'}</Text></Button>
  </Page>;
}

export function ContactsScreen() {
  const { token, businessId } = useBusiness(); const [items, setItems] = useState<Contact[]>([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState(true); const [supplier, setSupplier] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (token && businessId) try { setItems((await api.contacts(token, businessId)).contacts); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load contacts.'); } }, [token, businessId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function save() { if (!token || !businessId) return; setBusy(true); setError('');
    try { await api.createContact(token, businessId, { name, phone, is_customer: customer, is_supplier: supplier }); setName(''); setPhone(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add contact.'); } finally { setBusy(false); } }
  return <Page title="Contacts"><Card><Text color={ink} fontWeight="700">Add customer or supplier</Text><Field label="Name" value={name} onChangeText={setName} /><Field label="Phone (optional)" value={phone} onChangeText={setPhone} />
    <XStack gap={8}><Choice label="Customer" selected={customer} onPress={() => setCustomer(!customer)} /><Choice label="Supplier" selected={supplier} onPress={() => setSupplier(!supplier)} /></XStack>
    <ErrorText message={error} /><Button backgroundColor={green} disabled={busy} onPress={() => void save()}><Text color="white">{busy ? 'Saving…' : 'Add contact'}</Text></Button></Card>
    {items.map((item) => <Card key={item.id}><Text color={ink} fontWeight="700">{item.name}</Text><Text color={muted} fontSize={12}>{item.is_customer ? 'Customer' : ''}{item.is_customer && item.is_supplier ? ' · ' : ''}{item.is_supplier ? 'Supplier' : ''}</Text>
      {item.is_customer && <Text color={ink}>Customer advance {bdt(item.customer_advance)}</Text>}{item.is_supplier && <Text color={ink}>Supplier advance {bdt(item.supplier_advance)}</Text>}
      <Text color={muted} fontSize={12}>To collect {bdt(item.to_collect)} · To pay {bdt(item.to_pay)}</Text>
      <Button backgroundColor="#E5F8F4" onPress={() => router.push(`/contacts/${item.id}` as Href)}><Text color={green}>View statement</Text></Button></Card>)}
  </Page>;
}

export function ContactDetailsScreen() {
  const { id: contactId } = useLocalSearchParams<{ id: string }>();
  const { token, businessId } = useBusiness();
  const [contact, setContact] = useState<Contact | null>(null);
  const [statement, setStatement] = useState<{ date: string; description: string; kind: string; debit: string; credit: string }[]>([]);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    if (!token || !businessId || !contactId) return;
    void api.contact(token, businessId, contactId).then((result) => { setContact(result.contact); setStatement(result.statement); setError(''); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load statement.'));
  }, [token, businessId, contactId]));
  return <Page title={contact?.name ?? 'Contact statement'}><ErrorText message={error} />
    {contact && <Card><Text color={ink}>To collect {bdt(contact.to_collect)}</Text><Text color={ink}>To pay {bdt(contact.to_pay)}</Text>
      <Text color={ink}>Customer advance {bdt(contact.customer_advance)}</Text><Text color={ink}>Supplier advance {bdt(contact.supplier_advance)}</Text></Card>}
    <Text color={ink} fontWeight="700" fontSize={18}>Transactions</Text>
    {statement.length ? statement.map((row, index) => <Card key={`${row.date}-${index}`}><Text color={ink} fontWeight="700">{row.description}</Text><Text color={muted} fontSize={12}>{row.date}</Text><Text color={ink}>{bdt(Number(row.debit) > 0 ? row.debit : row.credit)}</Text></Card>) : <Card><Text color={muted}>No transactions yet.</Text></Card>}
  </Page>;
}

export function AssetsScreen() {
  const { token, businessId } = useBusiness(); const [items, setItems] = useState<BusinessAsset[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]); const [name, setName] = useState('');
  const [cost, setCost] = useState(''); const [months, setMonths] = useState(''); const [residual, setResidual] = useState('0');
  const [accountId, setAccountId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState(''); const [proceeds, setProceeds] = useState('');
  const [inServiceDate, setInServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseCommand, setPurchaseCommand] = useState(id()); const [saleCommand, setSaleCommand] = useState(id());
  const load = useCallback(async () => { if (!token || !businessId) return; try { const [assets, money] = await Promise.all([api.businessAssets(token, businessId), api.moneyAccounts(token, businessId)]);
      setItems(assets.assets); setAccounts(money.accounts); setAccountId((current) => current || money.accounts[0]?.id || ''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load assets.'); } }, [token, businessId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function buy() { if (!token || !businessId) return; setBusy(true); setError(''); try { await api.purchaseAsset(token, businessId, { name, cost, residual_value: residual, useful_life_months: Number(months), in_service_date: inServiceDate, account_id: accountId }, purchaseCommand);
      setName(''); setCost(''); setMonths(''); setPurchaseCommand(id()); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record asset.'); } finally { setBusy(false); } }
  async function sell() { if (!token || !businessId || !saleId) return; setBusy(true); setError(''); try { await api.sellAsset(token, businessId, saleId, { proceeds, account_id: accountId }, saleCommand); setSaleId(''); setProceeds(''); setSaleCommand(id()); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record sale.'); } finally { setBusy(false); } }
  return <Page title="My assets"><Card><Text color={ink} fontWeight="700">Add business asset</Text><Text color={muted} fontSize={12}>Furniture or equipment used by your business, separate from stock for sale.</Text>
    <Field label="Asset name" value={name} onChangeText={(value) => { setName(value); setPurchaseCommand(id()); }} /><Field label="Purchase cost (৳)" value={cost} onChangeText={(value) => { setCost(value); setPurchaseCommand(id()); }} numeric /><Field label="Useful life (months)" value={months} onChangeText={(value) => { setMonths(value); setPurchaseCommand(id()); }} numeric /><Field label="Residual value (৳)" value={residual} onChangeText={(value) => { setResidual(value); setPurchaseCommand(id()); }} numeric /><Field label="In service date (YYYY-MM-DD)" value={inServiceDate} onChangeText={(value) => { setInServiceDate(value); setPurchaseCommand(id()); }} />
    <Text color={ink} fontWeight="700">Paid from / received into</Text><XStack flexWrap="wrap" gap={8}>{accounts.map((item) => <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => { setAccountId(item.id); setPurchaseCommand(id()); setSaleCommand(id()); }} />)}</XStack>
    <ErrorText message={error} /><Button backgroundColor={green} disabled={busy} onPress={() => void buy()}><Text color="white">{busy ? 'Saving…' : 'Record asset purchase'}</Text></Button></Card>
    {items.map((item) => <Card key={item.id}><Text color={ink} fontWeight="700">{item.name}</Text><Text color={muted} fontSize={12}>{item.sold_on ? `Sold ${item.sold_on}` : 'In use'} · Cost {bdt(item.cost)} · Book value {bdt(item.book_value)}</Text>
      {!item.sold_on && <Button backgroundColor="#E5F8F4" onPress={() => { setSaleId(item.id); setSaleCommand(id()); }}><Text color={green}>Record sale</Text></Button>}
      {saleId === item.id && <><Field label="Sale proceeds (৳)" value={proceeds} onChangeText={(value) => { setProceeds(value); setSaleCommand(id()); }} numeric /><Button backgroundColor={green} disabled={busy} onPress={() => void sell()}><Text color="white">Confirm sale</Text></Button></>}</Card>)}
  </Page>;
}
