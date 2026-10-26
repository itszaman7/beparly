import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, XStack, YStack } from 'tamagui';

import { AppSymbol } from '@/components/app-symbol';
import { RecordAttachments, uploadPendingAttachments } from '@/features/attachments/record-attachments';
import { elevation, palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { formatBdt } from '@/features/products/product-rules';
import { api, type MoneyAccount, type PendingAttachment } from '@/services/api';
import { blurWebFocus } from '@/utils/web-focus';
import { ExpenseDate } from './expense-date';

type Category = { id: number; name: string };
type Picker = 'category' | 'account' | null;
const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
  const digit = Math.floor(Math.random() * 16);
  return (character === 'x' ? digit : (digit & 3) | 8).toString(16);
});
const kindLabel = (kind: MoneyAccount['kind']) => kind === 'wallet' ? 'Mobile wallet' : kind[0].toUpperCase() + kind.slice(1);

function ChoiceField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <YStack gap={7}>
    <Text color={palette.secondary} fontSize={12} fontWeight="700">{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress}
      style={{ minHeight: 58, borderWidth: 1, borderColor: palette.border, borderRadius: 14,
        backgroundColor: palette.surface, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
      <Text flex={1} color={palette.ink} fontSize={15} fontWeight="700">{value}</Text>
      <AppSymbol name="down" size={19} color={palette.secondary} />
    </Pressable>
  </YStack>;
}

export function ExpenseScreen() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const timezone = session?.account?.business.timezone || 'Asia/Dhaka';
  const today = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const [amount, setAmount] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [eventDate, setEventDate] = useState(today);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [postedId, setPostedId] = useState('');
  const [details, setDetails] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<MoneyAccount['kind']>('cash');
  const [newReference, setNewReference] = useState('');
  const [newOpening, setNewOpening] = useState('');
  const [createCommand, setCreateCommand] = useState(commandId);
  const [command, setCommand] = useState(commandId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!token || !businessId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void Promise.all([api.moneyAccounts(token, businessId), api.expenseCategories(token, businessId)])
      .then(([money, expense]) => {
        if (!active) return;
        const available = money.accounts.filter((item) => item.is_active);
        setAccounts(available); setCategories(expense.categories);
        setAccountId((current) => available.some((item) => item.id === current) ? current : (available.find((item) => item.is_default) ?? available[0])?.id ?? '');
        setCategoryId((current) => expense.categories.some((item) => item.id === current) ? current : expense.categories[0]?.id ?? null);
        setError('');
      }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load expense choices.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Reload available choices while preserving the entered expense.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, businessId, refreshCount]));

  const selectedCategory = categories.find((item) => item.id === categoryId);
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const validAmount = /^\d+(?:\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  const canSave = validAmount && Boolean(selectedCategory && selectedAccount && eventDate && eventDate <= today());
  const choices = useMemo(() => (picker === 'category' ? categories.map((item) => ({ id: String(item.id), name: item.name, detail: '' })) :
    accounts.map((item) => ({ id: item.id, name: item.name, detail: `${kindLabel(item.kind)} · ${formatBdt(item.balance)} available` })))
    .filter((item) => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [picker, categories, accounts, search]);

  function change(update: () => void) { update(); setCommand(commandId()); setError(''); }
  function openPicker(value: Picker) { setPicker(value); setSearch(''); setAdding(false); setSheetError(''); }
  function closePicker() { if (creating) return; setPicker(null); setAdding(false); setSearch(''); }

  async function createChoice() {
    if (!token || !businessId || !newName.trim() || creating || !picker) return;
    setCreating(true); setSheetError('');
    try {
      if (picker === 'category') {
        const result = await api.createFinancialCategory(token, businessId, 'expense', newName.trim());
        setCategories((items) => [...items, result.category]);
        change(() => setCategoryId(result.category.id));
      } else {
        const result = await api.createMoneyAccount(token, businessId, {
          name: newName.trim(), kind: newKind, masked_reference: newReference.trim(), opening_balance: newOpening.trim() || '0',
        }, createCommand);
        setAccounts((items) => items.some((item) => item.id === result.account.id) ? items : [...items, result.account]);
        change(() => setAccountId(result.account.id));
      }
      setNewName(''); setNewReference(''); setNewOpening(''); setNewKind('cash'); setCreateCommand(commandId());
      setAdding(false); setPicker(null);
    } catch (cause) { setSheetError(cause instanceof Error ? cause.message : 'Could not create item.'); }
    finally { setCreating(false); }
  }

  async function save() {
    if (!token || !businessId || (!postedId && !canSave) || busy) return;
    setBusy(true); setError('');
    try {
      let expenseId = postedId;
      if (!expenseId) {
        const result = await api.postMoneyTransaction(token, businessId, { kind: 'expense', amount: amount.trim(),
          account_id: accountId, category_id: categoryId!, event_date: eventDate, reference: reference.trim(), note: note.trim() }, command);
        expenseId = result.transaction.id;
        setPostedId(expenseId);
      }
      await uploadPendingAttachments(token, businessId, 'expense', expenseId, attachments);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save expense.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor={palette.surface}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { blurWebFocus(); if (router.canGoBack()) router.back(); else router.replace('/money' as Href); }}
        style={{ width: 42, height: 42, justifyContent: 'center' }}><AppSymbol name="back" size={23} color={palette.primaryDeep} /></Pressable>
      <Text color={palette.ink} fontSize={22} fontWeight="800">Add Expense</Text>
    </XStack>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: 40, alignItems: 'center' }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRefreshCount((count) => count + 1)} />}>
      <YStack width="100%" maxWidth={560} gap={18}>
        {postedId ? <Text color={palette.ink}>Expense saved. Retry the document upload below.</Text> : <YStack backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={20} padding={20} gap={12} {...elevation.card}>
          <Text color={palette.secondary} fontSize={13} fontWeight="700">Amount spent</Text>
          <XStack alignItems="center" gap={9}>
            <Text color={palette.primaryDeep} fontSize={34} fontWeight="800">৳</Text>
            <Input flex={1} value={amount} onChangeText={(value) => change(() => setAmount(value))} keyboardType="decimal-pad"
              placeholder="0.00" aria-label="Expense amount" backgroundColor={palette.surface} borderWidth={0}
              color={palette.ink} fontSize={34} fontWeight="800" height={58} style={{ paddingHorizontal: 0 }} />
          </XStack>
        </YStack>}
        {!postedId && (loading ? <ActivityIndicator color={palette.primaryDeep} /> : <>
          <ChoiceField label="Category" value={selectedCategory?.name ?? 'Choose a category'} onPress={() => openPicker('category')} />
          <ChoiceField label="Paid from" value={selectedAccount ? `${selectedAccount.name} · ${formatBdt(selectedAccount.balance)}` : 'Choose an account'} onPress={() => openPicker('account')} />
          <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Date</Text>
            <ExpenseDate value={eventDate} maximum={today()} onChange={(value) => change(() => setEventDate(value))} />
          </YStack>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails((value) => !value)}
            style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text color={palette.primaryDeep} fontWeight="700">More details & documents</Text><AppSymbol name="down" size={18} color={palette.primaryDeep} />
          </Pressable>
          {details && <YStack gap={15}>
            <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Reference</Text>
              <Input value={reference} onChangeText={(value) => change(() => setReference(value))} placeholder="Receipt or voucher number"
                aria-label="Expense reference" maxLength={80} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} height={52} /></YStack>
            <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Note</Text>
              <Input value={note} onChangeText={(value) => change(() => setNote(value))} placeholder="Add a note"
                aria-label="Expense note" maxLength={240} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} height={52} /></YStack>
            <RecordAttachments kind="expense" pending={attachments} onChange={setAttachments} showUploadButton={false} />
          </YStack>}
        </>)}
        {postedId && <RecordAttachments kind="expense" pending={attachments} onChange={setAttachments}
          recordId={postedId} showUploadButton={false} />}
      </YStack>
    </ScrollView>
    <YStack backgroundColor={palette.surface} borderTopWidth={1} borderColor={palette.border} paddingHorizontal={18} paddingTop={12} paddingBottom={10} alignItems="center">
      <YStack width="100%" maxWidth={560} gap={8}>
        {error ? <Text accessibilityRole="alert" color="#A62925" fontSize={13}>{error}</Text> : null}
        <Button height={54} backgroundColor={palette.primaryDeep} borderRadius={15} disabled={(!postedId && !canSave) || busy || loading} onPress={() => void save()}>
          <Text color="white" fontWeight="800" fontSize={16}>{busy ? 'Saving…' : postedId ? 'Finish document upload' : 'Save Expense'}</Text>
        </Button>
      </YStack>
    </YStack>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={closePicker}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss choices" onPress={closePicker}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 25, 22, 0.42)' }} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: palette.surface, borderTopLeftRadius: 24,
            borderTopRightRadius: 24, maxHeight: '80%', minHeight: 310, padding: 20 }}>
            <XStack justifyContent="space-between" alignItems="center" marginBottom={14}>
              <Text color={palette.ink} fontSize={20} fontWeight="800">{adding ? `Add ${picker === 'category' ? 'Category' : 'Money Account'}` : picker === 'category' ? 'Category' : 'Paid from'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={closePicker}
                style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><AppSymbol name="close" size={20} color={palette.secondary} /></Pressable>
            </XStack>
            {adding ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
              <Input value={newName} onChangeText={(value) => { setNewName(value); setCreateCommand(commandId()); setSheetError(''); }}
                placeholder={picker === 'category' ? 'Category name' : 'Account name'} aria-label={picker === 'category' ? 'Category name' : 'Account name'}
                height={52} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} />
              {picker === 'account' && <>
                <Text color={palette.secondary} fontSize={12} fontWeight="700">Account type</Text>
                <XStack flexWrap="wrap" gap={8}>{(['cash', 'bank', 'wallet', 'other'] as const).map((kind) => <Pressable key={kind}
                  accessibilityRole="button" accessibilityState={{ selected: newKind === kind }} onPress={() => { setNewKind(kind); setCreateCommand(commandId()); }}
                  style={{ minHeight: 44, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: newKind === kind ? palette.primaryDeep : palette.border,
                    backgroundColor: newKind === kind ? palette.primarySoft : palette.surface, justifyContent: 'center' }}>
                  <Text color={newKind === kind ? palette.primaryDeep : palette.ink}>{kindLabel(kind)}</Text></Pressable>)}</XStack>
                <Input value={newReference} onChangeText={(value) => { setNewReference(value); setCreateCommand(commandId()); }}
                  placeholder="Masked reference (optional)" aria-label="Account masked reference" maxLength={40}
                  height={52} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} />
                <Input value={newOpening} onChangeText={(value) => { setNewOpening(value); setCreateCommand(commandId()); }}
                  placeholder="Opening balance (optional)" aria-label="Account opening balance" keyboardType="decimal-pad"
                  height={52} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} />
              </>}
              {sheetError ? <Text accessibilityRole="alert" color="#A62925">{sheetError}</Text> : null}
              <Button height={52} backgroundColor={palette.primaryDeep} disabled={creating || !newName.trim()} onPress={() => void createChoice()}>
                <Text color="white" fontWeight="800">{creating ? 'Saving…' : 'Save and select'}</Text></Button>
              <Button height={44} backgroundColor={palette.background} disabled={creating} onPress={() => setAdding(false)}>
                <Text color={palette.primaryDeep}>Back to choices</Text></Button>
            </ScrollView> : <>
              <Input value={search} onChangeText={setSearch} placeholder={`Search ${picker === 'category' ? 'categories' : 'accounts'}`}
                aria-label="Search choices" height={48} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink} />
              <FlatList data={choices} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
                style={{ flexGrow: 0, maxHeight: 380 }} initialNumToRender={12} windowSize={5}
                ListEmptyComponent={<Text color={palette.secondary} paddingVertical={18}>{search ? 'No matches.' : 'No choices yet.'}</Text>}
                renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}${item.detail ? `, ${item.detail}` : ''}`}
                  onPress={() => { change(() => picker === 'category' ? setCategoryId(Number(item.id)) : setAccountId(item.id)); closePicker(); }}
                  style={{ minHeight: 60, borderBottomWidth: 1, borderBottomColor: palette.border, justifyContent: 'center' }}>
                  <Text color={palette.ink} fontWeight="700" fontSize={15}>{item.name}</Text>
                  {item.detail ? <Text color={palette.secondary} fontSize={12}>{item.detail}</Text> : null}
                </Pressable>} />
              <Pressable accessibilityRole="button" onPress={() => { setNewName(''); setSheetError(''); setAdding(true); }}
                style={{ minHeight: 56, justifyContent: 'center' }}><Text color={palette.primaryDeep} fontWeight="800">+ Add {picker === 'category' ? 'Category' : 'Money Account'}</Text></Pressable>
            </>}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </SafeAreaView>;
}
