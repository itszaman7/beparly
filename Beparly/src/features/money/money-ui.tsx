import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, XStack, YStack } from 'tamagui';

import { AppSymbol } from '@/components/app-symbol';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { elevation, palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { currencySymbol, formatBdt } from '@/features/products/product-rules';
import { api, type Contact, type MoneyAccount, type MoneyTransaction } from '@/services/api';
import { blurWebFocus } from '@/utils/web-focus';

const ink = '#15211F';
const muted = '#52635E';
const green = '#006D64';
const border = '#E5ECE9';
const background = '#F6F8F7';

const id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});

const bdt = (value: string | number) => formatBdt(String(value));

function Page({ title, children, onRefresh }: { title: string; children: React.ReactNode; onRefresh?: () => Promise<unknown> | void }) {
  const Scroller = onRefresh ? RefreshableScrollView : ScrollView;
  return <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor="white">
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { blurWebFocus(); if (router.canGoBack()) router.back(); else router.replace('/more' as Href); }} style={{ width: 42, height: 42, justifyContent: 'center' }}>
        <AppSymbol name="back" size={23} color={green} />
      </Pressable>
      <Text color={ink} fontSize={22} fontWeight="700">{title}</Text>
    </XStack>
    <Scroller onRefresh={onRefresh!} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: 110, alignItems: 'center' }}>
      <YStack width="100%" maxWidth={560} gap={14}>{children}</YStack>
    </Scroller>
  </SafeAreaView>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <YStack backgroundColor="white" borderWidth={1} borderColor={border} borderRadius={18} padding={17} gap={10}>{children}</YStack>;
}

function Field({ label, value, onChangeText, placeholder, numeric = false, flex }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; numeric?: boolean; flex?: number }) {
  return <YStack flex={flex} gap={6}>
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
  const [ledgerAccounts, setLedgerAccounts] = useState<{ id: string; code?: string; name: string; type: string; system_managed?: boolean; balance: string }[]>([]);
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
      setAccounts(money.accounts); setLedgerAccounts(money.ledger_accounts); setAvailable(money.available_money); setTransactions(history.transactions);
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
  const visibleAccounts = accounts.slice(0, 5);
  const visibleLedgerAccounts = ledgerAccounts.filter((account) => !account.system_managed && !accounts.some((money) => money.name === account.name) || account.code === 'SALES').slice(0, Math.max(0, 5 - visibleAccounts.length));
  return <Page title="Money" onRefresh={refresh}>
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
      <XStack justifyContent="space-between" alignItems="center"><Text color={ink} fontSize={18} fontWeight="700">Accounts</Text><Button borderWidth={1} borderColor={palette.primary} backgroundColor="white" onPress={() => router.push('/money/accounts' as Href)}><AppSymbol name="plus" size={16} color={green} /><Text color={green} fontWeight="700">Add money account</Text></Button></XStack>
      {visibleAccounts.map((account) => <Pressable key={account.id} onPress={() => router.push(`/money/account/${account.id}` as Href)}><Card><XStack justifyContent="space-between"><Text color={ink} fontWeight="700">{account.name}</Text><Text color={Number(account.balance) < 0 ? '#A62925' : ink} fontWeight="700">{bdt(account.balance)}</Text></XStack><Text color={muted} fontSize={12}>{account.kind === 'wallet' ? 'Mobile wallet' : account.kind}{Number(account.balance) < 0 ? ' · Below zero' : ''}</Text></Card></Pressable>)}
      {visibleLedgerAccounts.map((account) => <Pressable key={`ledger-${account.id}`} onPress={() => router.push(`/money/account/${account.id}` as Href)}><Card><XStack justifyContent="space-between"><Text color={ink} fontWeight="700">{account.name}</Text><Text color={ink} fontWeight="700">{bdt(account.balance)}</Text></XStack><Text color={muted} fontSize={12}>{account.type === 'income' ? 'Income' : account.type === 'expense' ? 'Expense' : account.type === 'asset' ? 'Asset' : account.type === 'liability' ? 'Liability' : 'Equity'} account</Text></Card></Pressable>)}
      <Button height={48} borderWidth={1} borderColor={palette.primary} backgroundColor="white" onPress={() => router.push('/money/accounts-list' as Href)}><Text color={green} fontWeight="700">View all money accounts</Text><AppSymbol name="chevron" size={18} color={green} /></Button>
      <Text color={ink} fontSize={18} fontWeight="700" marginTop={8}>Recent transactions</Text>
      <XStack flexWrap="wrap" gap={7}>{(['all', 'in', 'out', 'transfer', 'expense'] as const).map((value) => <Choice key={value} label={value === 'all' ? 'All' : value === 'expense' ? 'Expenses' : value === 'transfer' ? 'Transfers' : value === 'in' ? 'Money In' : 'Money Out'} selected={historyFilter === value} onPress={() => setHistoryFilter(value)} />)}</XStack>
      {visibleTransactions.length ? visibleTransactions.slice(0, 5).map((item) => <Card key={item.id}><XStack justifyContent="space-between"><YStack flex={1}><Text color={ink} fontWeight="700">{item.kind.replaceAll('_', ' ')}</Text><Text color={muted} fontSize={12}>{item.event_date}{item.reversed ? ' · Reversed' : ''}</Text></YStack><Text color={ink} fontWeight="700">{bdt(item.amount)}</Text></XStack>
        {item.kind === 'expense' && <Button backgroundColor={palette.primarySoft} onPress={() => router.push(`/money/expense/${item.id}` as Href)}><Text color={green}>View expense and documents</Text></Button>}
        {!item.reversed && !item.kind.startsWith('asset_') && !item.kind.endsWith('_reversal') && <Button backgroundColor="#FFF5E1" onPress={() => { setReverseId(item.id); setReverseReason(''); setReverseCommand(id()); }}><Text color="#8B5E15">Correct this transaction</Text></Button>}
      </Card>) : <Card><Text color={muted}>No money movements yet.</Text></Card>}
      <Modal visible={Boolean(reverseId)} transparent animationType="fade" onRequestClose={() => setReverseId('')}>
        <Pressable style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(15, 25, 22, 0.48)' }} onPress={() => setReverseId('')}>
          <Pressable onPress={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: 480, alignSelf: 'center' }}>
            <YStack backgroundColor="white" borderRadius={20} padding={20} gap={14}>
              <View style={{ width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1F0' }}><AppSymbol name="waste" size={23} color="#A62925" /></View>
              <YStack gap={5}><Text color={ink} fontSize={20} fontWeight="800">Reverse this transaction?</Text><Text color={muted} fontSize={13} lineHeight={19}>This will create an equal opposite entry and correct the balance. It cannot be silently undone.</Text></YStack>
              <Field label="Reason for correction" value={reverseReason} onChangeText={(value) => { setReverseReason(value); setReverseCommand(id()); }} placeholder="e.g. Recorded against the wrong account" />
              <XStack gap={9}><Button flex={1} height={48} backgroundColor="#F6F8F7" onPress={() => setReverseId('')}><Text color={ink} fontWeight="700">Keep transaction</Text></Button><Button flex={1} height={48} backgroundColor="#A62925" disabled={reversing || !reverseReason.trim()} onPress={() => void submitReversal()}><Text color="white" fontWeight="700">{reversing ? 'Reversing…' : 'Yes, reverse'}</Text></Button></XStack>
            </YStack>
          </Pressable>
        </Pressable>
      </Modal>
    </>}
  </Page>;
}
export function MoneyAccountForm() {
  const { token, businessId } = useBusiness();
  const [name, setName] = useState(''); const [kind, setKind] = useState<MoneyAccount['kind']>('bank');
  const [reference, setReference] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [showAccountInfo, setShowAccountInfo] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [createCommand, setCreateCommand] = useState(id());
  async function save() {
    if (!token || !businessId || busy) return;
    setBusy(true); setError('');
    try {
      await api.createMoneyAccount(token, businessId, { name: name.trim(), kind, masked_reference: reference.trim(), opening_balance: openingBalance.trim() || '0' }, createCommand);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save account.'); }
    finally { setBusy(false); }
  }
  return <Page title="Add money account"><XStack alignItems="center" gap={6}><Text color={ink} fontSize={13} fontWeight="700">Account setup</Text><Pressable accessibilityRole="button" accessibilityLabel="Account setup information" onPress={() => setShowAccountInfo((open) => !open)}><AppSymbol name="info" size={18} color={green} /></Pressable></XStack>{showAccountInfo && <Card><Text color={muted}>Cash, bank and wallets each have their own balance. Move existing money with Transfer.</Text></Card>}
      <Field label="Account name" value={name} onChangeText={(value) => { setName(value); setCreateCommand(id()); }} placeholder="Enter a name for this account" />
      <Text color={ink} fontSize={13} fontWeight="700">Account type</Text><XStack flexWrap="wrap" gap={8}>{(['cash', 'bank', 'wallet', 'other'] as const).map((option) => <Choice key={option} label={option === 'wallet' ? 'Mobile wallet' : option === 'cash' ? 'Cash' : option === 'bank' ? 'Bank' : 'Other'} selected={kind === option} onPress={() => { setKind(option); setCreateCommand(id()); }} />)}</XStack>
      <Field label="Masked reference (optional)" value={reference} onChangeText={(value) => { setReference(value); setCreateCommand(id()); }} placeholder="Last four digits" />
      <Field label="Opening balance (optional)" value={openingBalance} onChangeText={(value) => { setOpeningBalance(value); setCreateCommand(id()); }} placeholder="0.00" numeric />
    <ErrorText message={error} /><Button backgroundColor={green} height={52} disabled={busy} onPress={() => void save()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : 'Save account'}</Text></Button>
  </Page>;
}

export function MoneyAccountsList() {
  const { token, businessId, owner } = useBusiness();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<{ id: string; code?: string; name: string; type: string; system_managed?: boolean; balance: string }[]>([]);
  const [partyAccounts, setPartyAccounts] = useState<{ id: string; name: string; balance: string; contact_id: string; contact_name: string; party_type: 'customer' | 'supplier' }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!token || !businessId || !owner) { setLoading(false); return; }
    setLoading(true);
    try { const result = await api.moneyAccounts(token, businessId); setAccounts(result.accounts); setLedgerAccounts(result.ledger_accounts); setPartyAccounts(result.party_accounts); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load accounts.'); }
    finally { setLoading(false); }
  }, [token, businessId, owner]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <Page title="All accounts" onRefresh={refresh}>
    {!owner ? <Card><Text color={muted}>Only the business owner can view money accounts.</Text></Card> : <>
      <Button height={50} backgroundColor={green} onPress={() => router.push('/money/accounts' as Href)}><AppSymbol name="plus" size={18} color="white" /><Text color="white" fontWeight="700">Add account</Text></Button>
      <ErrorText message={error} />
      {partyAccounts.map((account) => <Pressable key={`party-${account.id}`} onPress={() => router.push(`/money/account/${account.id}` as Href)}><Card><XStack justifyContent="space-between" alignItems="center" gap={12}><YStack flex={1} gap={4}><Text color={ink} fontSize={16} fontWeight="700">{account.contact_name}</Text><Text color={muted} fontSize={12}>{account.party_type === 'customer' ? 'Customer' : 'Supplier'} · Tap to view ledger</Text></YStack><YStack alignItems="flex-end" gap={3}><Text color={Number(account.balance) > 0 ? '#A62925' : ink} fontWeight="700">{bdt(account.balance)}</Text><Text color={muted} fontSize={11}>{Number(account.balance) <= 0 ? 'No amount due' : account.party_type === 'customer' ? 'Customer owes you' : 'You owe supplier'}</Text></YStack></XStack></Card></Pressable>)}
      {loading ? <ActivityIndicator color={green} /> : accounts.map((account) =>
        <Pressable key={account.id} onPress={() => router.push(`/money/account/${account.id}` as Href)}><Card><XStack justifyContent="space-between" alignItems="center" gap={12}>
          <YStack flex={1} gap={4}><Text color={ink} fontSize={16} fontWeight="700">{account.name}</Text><Text color={muted} fontSize={12}>{account.kind === 'wallet' ? 'Mobile wallet' : account.kind}{account.is_default ? ' · Default' : ''}{account.masked_reference ? ` · ${account.masked_reference}` : ''}</Text></YStack>
          <Text color={Number(account.balance) < 0 ? '#A62925' : ink} fontWeight="700">{bdt(account.balance)}</Text>
        </XStack></Card></Pressable>)}
      {ledgerAccounts.filter((item) => (!item.system_managed && !accounts.some((account) => account.name === item.name)) || item.code === 'SALES').map((account) => <Pressable key={`ledger-${account.id}`} onPress={() => router.push(`/money/account/${account.id}` as Href)}><Card><XStack justifyContent="space-between" alignItems="center" gap={12}><YStack flex={1} gap={4}><Text color={ink} fontSize={16} fontWeight="700">{account.name}</Text><Text color={muted} fontSize={12}>{account.code === 'SALES' ? 'Revenue account' : account.type === 'income' ? 'Income category' : account.type === 'expense' ? 'Expense category' : `${account.type} account`}</Text></YStack><Text color={ink} fontWeight="700">{bdt(account.balance)}</Text></XStack></Card></Pressable>)}
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
  const { flow = 'in', reason } = useLocalSearchParams<{ flow: string; reason?: string }>();
  const mode = flow in reasons ? flow as keyof typeof reasons : 'in';
  const { token, businessId } = useBusiness();
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]); const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<{ id: number; name: string }[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [kind, setKind] = useState<string>(mode === 'in' && reason === 'other_income' ? 'other_income' : reasons[mode][0][0]); const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(''); const [destinationId, setDestinationId] = useState('');
  const [contactId, setContactId] = useState(''); const [categoryId, setCategoryId] = useState<number | null>(null);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [command, setCommand] = useState(id());
  const [reviewing, setReviewing] = useState(false);
  const refreshChoices = useCallback(async () => {
    if (!token || !businessId) return;
    try { const [money, parties, expenses, incomes] = await Promise.all([api.moneyAccounts(token, businessId), api.contacts(token, businessId), api.expenseCategories(token, businessId), api.incomeCategories(token, businessId)]);
      setAccounts(money.accounts.filter((item) => item.is_active)); setContacts(parties.contacts); setCategories(expenses.categories); setIncomeCategories(incomes.categories);
      setAccountId((current) => money.accounts.some((item) => item.is_active && item.id === current) ? current : money.accounts.find((item) => item.is_active)?.id || '');
      setCategoryId((current) => (reason === 'other_income' ? incomes.categories : expenses.categories).some((item) => item.id === current) ? current : (reason === 'other_income' ? incomes.categories[0]?.id : expenses.categories[0]?.id) ?? null);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load form choices.'); }
  }, [token, businessId, reason]);
  useFocusEffect(useCallback(() => { void refreshChoices(); }, [refreshChoices]));
  function changed(update: () => void) { update(); setCommand(id()); setReviewing(false); }
  async function addCategory(type: 'expense' | 'income') {
    if (!token || !businessId || !newCategory.trim()) return;
    try {
      const { category } = await api.createFinancialCategory(token, businessId, type, newCategory.trim());
      if (type === 'expense') { setCategories((items) => [...items, category]); setCategoryId(category.id); }
      else { setIncomeCategories((items) => [...items, category]); setCategoryId(category.id); }
      setNewCategory(''); setCommand(id()); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create category.'); }
  }
  async function submit() {
    if (!token || !businessId || busy) return;
    if (kind === 'other_income' && (!accountId || !incomeCategories.some((item) => item.id === categoryId))) {
      setError('Choose where the money was received and an income account to credit.');
      return;
    }
    setBusy(true); setError('');
    try {
      await api.postMoneyTransaction(token, businessId, { kind, amount, account_id: accountId,
        ...(kind === 'transfer' ? { destination_id: destinationId } : {}),
        ...(kind.includes('advance') ? { contact_id: contactId } : {}),
        ...((kind === 'expense' || kind === 'other_income') && categoryId ? { category_id: categoryId } : {}),
        ...(kind === 'expense' ? { event_date: eventDate } : {}), note }, command);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save transaction.'); }
    finally { setBusy(false); }
  }
  const selectedMoneyAccount = accounts.find((item) => item.id === accountId);
  const selectedIncomeAccount = incomeCategories.find((item) => item.id === categoryId);
  return <Page title={kind === 'other_income' ? 'Other income' : mode === 'in' ? 'Money In' : mode === 'out' ? 'Money Out' : mode === 'transfer' ? 'Transfer money' : 'Expense'} onRefresh={refreshChoices}>
    <Text color={muted} fontSize={13}>The amount is confirmed by the server before it changes your balance.</Text>
    <Field label={`Amount${currencySymbol() ? ` (${currencySymbol()})` : ''}`} value={amount} onChangeText={(value) => changed(() => setAmount(value))} numeric />
    <Text color={ink} fontWeight="700">Reason</Text><XStack flexWrap="wrap" gap={8}>{reasons[mode].map(([value, label]) => <Choice key={value} label={label} selected={kind === value} onPress={() => changed(() => { setKind(value); if (value === 'expense') setCategoryId(categories[0]?.id ?? null); if (value === 'other_income') setCategoryId(incomeCategories[0]?.id ?? null); })} />)}</XStack>
    <Text color={ink} fontWeight="700">{mode === 'in' ? 'Received into' : 'Paid from'}</Text><XStack flexWrap="wrap" gap={8}>{accounts.map((item) => <Choice key={item.id} label={item.name} selected={accountId === item.id} onPress={() => changed(() => setAccountId(item.id))} />)}</XStack>
    {kind === 'transfer' && <><Text color={ink} fontWeight="700">Transfer to</Text><XStack flexWrap="wrap" gap={8}>{accounts.filter((item) => item.id !== accountId).map((item) => <Choice key={item.id} label={item.name} selected={destinationId === item.id} onPress={() => changed(() => setDestinationId(item.id))} />)}</XStack></>}
    {kind.includes('advance') && <><Text color={ink} fontWeight="700">{kind.startsWith('customer') ? 'Customer' : 'Supplier'}</Text><XStack flexWrap="wrap" gap={8}>{contacts.filter((item) => kind.startsWith('customer') ? item.is_customer : item.is_supplier).map((item) => <Choice key={item.id} label={item.name} selected={contactId === item.id} onPress={() => changed(() => setContactId(item.id))} />)}</XStack><Button backgroundColor="#E5F8F4" onPress={() => router.push('/contacts' as Href)}><Text color={green}>+ Add contact</Text></Button></>}
    {(kind === 'expense' || kind === 'other_income') && <>
      <Text color={ink} fontWeight="700">{kind === 'expense' ? 'Expense category' : 'Credit to (income account)'}</Text>
      {(kind === 'expense' ? categories : incomeCategories).length === 0 && <Text color={muted}>Create {kind === 'expense' ? 'an expense category' : 'an income account to credit'} before recording this {kind === 'expense' ? 'expense' : 'income'}.</Text>}
      <XStack flexWrap="wrap" gap={8}>{(kind === 'expense' ? categories : incomeCategories).map((item) => <Choice key={item.id} label={item.name} selected={categoryId === item.id} onPress={() => changed(() => setCategoryId(item.id))} />)}</XStack>
      <XStack gap={8}><Field flex={1} label={kind === 'expense' ? 'New category' : 'New income account'} value={newCategory} onChangeText={setNewCategory} placeholder={kind === 'expense' ? 'e.g. Shop rent' : 'e.g. Delivery income'} /><Button alignSelf="flex-end" backgroundColor="#E5F8F4" onPress={() => void addCategory(kind === 'expense' ? 'expense' : 'income')}><Text color={green}>Add</Text></Button></XStack>
    </>}
    {kind === 'other_income' && <Card><Text color={ink} fontWeight="700">Entry preview</Text>
      <Text color={ink}>Dr {selectedMoneyAccount?.name ?? 'Choose receiving account'} {bdt(amount || '0')}</Text>
      <Text color={ink}>Cr {selectedIncomeAccount?.name ?? 'Choose income account'} {bdt(amount || '0')}</Text>
    </Card>}
    {kind === 'expense' && <Field label="Expense date (YYYY-MM-DD)" value={eventDate} onChangeText={(value) => changed(() => setEventDate(value))} />}
    <Field label="Note (optional)" value={note} onChangeText={(value) => changed(() => setNote(value))} />
    {mode === 'transfer' && reviewing && <Card><Text color={ink} fontWeight="700">Review transfer</Text><Text color={ink}>{accounts.find((item) => item.id === accountId)?.name} → {accounts.find((item) => item.id === destinationId)?.name}</Text><Text color={ink}>{bdt(amount || '0')}</Text></Card>}
    <ErrorText message={error} /><Button backgroundColor={green} height={54} disabled={busy || kind === 'other_income' && (!selectedMoneyAccount || !selectedIncomeAccount)} onPress={() => mode === 'transfer' && !reviewing ? setReviewing(true) : void submit()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : mode === 'transfer' && !reviewing ? 'Review transfer' : 'Confirm'}</Text></Button>
  </Page>;
}
