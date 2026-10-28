import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, XStack, YStack } from 'tamagui';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { formatBdt } from '@/features/products/product-rules';
import { api, type Contact, type MoneyAccount } from '@/services/api';
import { blurWebFocus } from '@/utils/web-focus';

type Reason = 'other_income' | 'owner_contribution' | 'customer_advance';
type Picker = 'reason' | 'account' | 'category' | 'customer' | null;
type Category = { id: number; name: string };

const reasons: { id: Reason; label: string; detail: string; icon: AppSymbolName }[] = [
  { id: 'other_income', label: 'Other business income', detail: 'Income outside a product sale', icon: 'receive' },
  { id: 'owner_contribution', label: 'Owner added money', detail: 'Money put into the business by its owner', icon: 'account' },
  { id: 'customer_advance', label: 'Customer advance', detail: 'Money received before a sale', icon: 'parties' },
];

const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
  const digit = Math.floor(Math.random() * 16);
  return (character === 'x' ? digit : (digit & 3) | 8).toString(16);
});

function PickerRow({ label, value, icon, onPress }: { label: string; value: string; icon: AppSymbolName; onPress: () => void }) {
  return <YStack gap={7}>
    <Text color={palette.secondary} fontSize={12} fontWeight="700">{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 58, borderWidth: 1, borderColor: pressed ? palette.primaryDeep : palette.border,
        borderRadius: 14, backgroundColor: palette.surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 })}>
      <View style={{ width: 35, height: 35, borderRadius: 11, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <AppSymbol name={icon} size={19} color={palette.primaryDeep} />
      </View>
      <Text flex={1} color={palette.ink} fontSize={15} fontWeight="700">{value}</Text>
      <AppSymbol name="down" size={19} color={palette.secondary} />
    </Pressable>
  </YStack>;
}

export function MoneyInScreen() {
  const keyboardVisible = useKeyboardVisible();
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<Reason>('other_income');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountKind, setNewAccountKind] = useState<MoneyAccount['kind']>('cash');
  const [newAccountReference, setNewAccountReference] = useState('');
  const [newAccountOpening, setNewAccountOpening] = useState('');
  const [accountCommand, setAccountCommand] = useState(commandId());
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [focused, setFocused] = useState<'amount' | 'note' | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [command, setCommand] = useState(commandId());
  const [refreshCount, setRefreshCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    let active = true;
    setLoading(true);
    void Promise.all([api.moneyAccounts(token, businessId), api.incomeCategories(token, businessId), api.contacts(token, businessId)])
      .then(([money, income, parties]) => {
        if (!active) return;
        const available = money.accounts.filter((item) => item.is_active);
        const otherIncome = income.categories.filter((item) => item.name.toLowerCase() !== 'sales');
        setAccounts(available);
        setCategories(otherIncome);
        setCustomers(parties.contacts.filter((item) => item.is_customer));
        setAccountId((current) => available.some((item) => item.id === current) ? current : (available.find((item) => item.is_default) ?? available[0])?.id ?? '');
        setCategoryId((current) => otherIncome.some((item) => item.id === current) ? current : (otherIncome.find((item) => item.name === 'Miscellaneous income') ?? otherIncome[0])?.id ?? null);
        setError('');
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Money In.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Reload available choices while preserving the entered receipt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, businessId, refreshCount]));

  function change(update: () => void) { update(); setCommand(commandId()); setError(''); }
  function closePicker() {
    if (categoryBusy || accountBusy) return;
    setPicker(null); setAddingCategory(false); setCategoryError('');
    setAddingAccount(false); setAccountError('');
  }
  const selectedReason = reasons.find((item) => item.id === reason) ?? reasons[0];
  const selectedAccount = accounts.find((item) => item.id === accountId);
  const selectedCategory = categories.find((item) => item.id === categoryId);
  const selectedCustomer = customers.find((item) => item.id === customerId);
  const validAmount = /^\d+(?:\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  const canSubmit = validAmount && Boolean(selectedAccount) && (reason !== 'other_income' || Boolean(selectedCategory)) &&
    (reason !== 'customer_advance' || Boolean(selectedCustomer));

  async function submit() {
    if (!token || !businessId || busy || !canSubmit) return;
    setBusy(true); setError('');
    try {
      await api.postMoneyTransaction(token, businessId, {
        kind: reason, amount: amount.trim(), account_id: accountId,
        ...(reason === 'other_income' && categoryId ? { category_id: categoryId } : {}),
        ...(reason === 'customer_advance' ? { contact_id: customerId } : {}),
        note: note.trim(),
      }, command);
      router.replace('/money' as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record money received.'); }
    finally { setBusy(false); }
  }

  async function addReceivingAccount() {
    if (!token || !businessId || !newAccountName.trim() || accountBusy) return;
    setAccountBusy(true); setAccountError('');
    try {
      const result = await api.createMoneyAccount(token, businessId, {
        name: newAccountName.trim(), kind: newAccountKind, masked_reference: newAccountReference.trim(),
        opening_balance: newAccountOpening.trim() || '0',
      }, accountCommand);
      setAccounts((current) => current.some((item) => item.id === result.account.id) ? current : [...current, result.account]);
      setAccountId(result.account.id);
      setCommand(commandId());
      setNewAccountName(''); setNewAccountKind('cash'); setNewAccountReference(''); setNewAccountOpening('');
      setAccountCommand(commandId()); setAddingAccount(false); setPicker(null);
    } catch (cause) { setAccountError(cause instanceof Error ? cause.message : 'Could not add receiving account.'); }
    finally { setAccountBusy(false); }
  }

  async function addIncomeCategory() {
    if (!token || !businessId || !newCategoryName.trim() || categoryBusy) return;
    setCategoryBusy(true); setCategoryError('');
    try {
      const result = await api.createFinancialCategory(token, businessId, 'income', newCategoryName.trim());
      setCategories((current) => current.some((item) => item.id === result.category.id) ? current : [...current, result.category]);
      change(() => setCategoryId(result.category.id));
      setNewCategoryName(''); setAddingCategory(false); setPicker(null);
    } catch (cause) { setCategoryError(cause instanceof Error ? cause.message : 'Could not add income category.'); }
    finally { setCategoryBusy(false); }
  }

  const pickerTitle = picker === 'reason' ? 'Why did you receive this money?' : picker === 'account' ? addingAccount ? 'Add receiving account' : 'Received into' :
    picker === 'category' ? 'What was this income from?' : 'Customer';
  const choices = picker === 'reason' ? reasons.map((item) => ({ id: item.id, label: item.label, detail: item.detail, icon: item.icon })) :
    picker === 'account' ? accounts.map((item) => ({ id: item.id, label: item.name, detail: item.kind === 'wallet' ? 'Mobile wallet' : item.kind, icon: 'money' as AppSymbolName })) :
    picker === 'category' ? categories.map((item) => ({ id: String(item.id), label: item.name, detail: '', icon: 'category' as AppSymbolName })) :
    customers.map((item) => ({ id: item.id, label: item.name, detail: item.phone, icon: 'parties' as AppSymbolName }));

  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor={palette.surface}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => { blurWebFocus(); if (router.canGoBack()) router.back(); else router.replace('/money' as Href); }} style={{ width: 42, height: 42, justifyContent: 'center' }}>
        <AppSymbol name="back" size={23} color={palette.primaryDeep} />
      </Pressable>
      <Text color={palette.ink} fontSize={22} fontWeight="800">Money In</Text>
    </XStack>
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 18, paddingBottom: 28, alignItems: 'center' }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setRefreshCount((count) => count + 1)} />}>
      <YStack width="100%" maxWidth={560} gap={18}>
        <YStack gap={8}>
          <Text color={palette.ink} fontSize={15} fontWeight="800">Amount received (৳) *</Text>
          <XStack alignItems="center" gap={10} height={66} paddingHorizontal={16} borderWidth={2}
            borderColor={focused === 'amount' ? palette.primaryDeep : palette.border} borderRadius={14} backgroundColor={palette.surface}>
            <Text color={palette.primaryDeep} fontSize={24} fontWeight="800">৳</Text>
            <Input flex={1} value={amount} onChangeText={(value) => change(() => setAmount(value))}
              onFocus={() => setFocused('amount')} onBlur={() => setFocused(null)}
              keyboardType="decimal-pad" placeholder="Enter amount, e.g. 500.00" aria-label="Amount received in taka"
              backgroundColor="transparent" borderWidth={0} color={palette.ink} fontSize={18} height={56}
              style={{ paddingHorizontal: 0 }} />
          </XStack>
          <Text color={palette.secondary} fontSize={12}>Tap the box to enter the money you received.</Text>
        </YStack>
        {loading ? <ActivityIndicator color={palette.primaryDeep} /> : <>
          <PickerRow label="Why did you receive this money?" value={selectedReason.label} icon={selectedReason.icon} onPress={() => setPicker('reason')} />
          <PickerRow label="Received into" value={selectedAccount?.name ?? 'Choose an account'} icon="money" onPress={() => setPicker('account')} />
          {reason === 'other_income' && <YStack gap={7}>
            <PickerRow label="What was this income from?" value={selectedCategory?.name ?? 'Choose an income type'} icon="category" onPress={() => setPicker('category')} />
            <Text color={palette.secondary} fontSize={12} lineHeight={18}>Choose a type for money earned outside product sales, such as commission or a service fee. This keeps it separate from sales in reports.</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/money/income-categories' as Href)} style={{ minHeight: 44, justifyContent: 'center' }}><Text color={palette.primaryDeep} fontWeight="700">Add or rename income types</Text></Pressable>
          </YStack>}
          {reason === 'customer_advance' && <PickerRow label="Customer" value={selectedCustomer?.name ?? 'Choose a customer'} icon="parties" onPress={() => setPicker('customer')} />}
          <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Note (optional)</Text>
            <Input value={note} onChangeText={(value) => change(() => setNote(value))} placeholder="Add a short note"
              onFocus={() => setFocused('note')} onBlur={() => setFocused(null)}
              backgroundColor={palette.surface} borderColor={focused === 'note' ? palette.primaryDeep : palette.border} color={palette.ink} height={54} style={{ borderRadius: 14, paddingHorizontal: 14 }} />
          </YStack>
          <YStack backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={18} padding={17} gap={9}>
            <Text color={palette.ink} fontSize={15} fontWeight="800">Review</Text>
            <XStack justifyContent="space-between"><Text color={palette.secondary}>Amount</Text><Text color={palette.ink} fontWeight="700">{formatBdt(amount || '0')}</Text></XStack>
            <XStack justifyContent="space-between"><Text color={palette.secondary}>Into</Text><Text color={palette.ink} fontWeight="700">{selectedAccount?.name ?? 'Choose account'}</Text></XStack>
            <XStack justifyContent="space-between"><Text color={palette.secondary}>Reason</Text><Text color={palette.ink} fontWeight="700">{selectedReason.label}</Text></XStack>
          </YStack>
          <Pressable accessibilityRole="link" onPress={() => router.push('/dues' as Href)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text color={palette.primaryDeep} fontWeight="700">Collecting an existing customer due? Open Dues</Text>
          </Pressable>
        </>}
      </YStack>
    </ScrollView>
    {!keyboardVisible && <YStack backgroundColor={palette.surface} borderTopWidth={1} borderColor={palette.border} paddingHorizontal={18} paddingTop={12} paddingBottom={10} alignItems="center">
      <YStack width="100%" maxWidth={560} gap={8}>
        {error ? <Text role="alert" color="#A62925" fontSize={13}>{error}</Text> : null}
        <Button height={54} backgroundColor={palette.primaryDeep} borderRadius={15} disabled={!canSubmit || busy || loading} onPress={() => void submit()}>
          <Text color="white" fontWeight="800" fontSize={16}>{busy ? 'Recording…' : 'Record Money In'}</Text>
        </Button>
      </YStack>
    </YStack>}
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={closePicker}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable onPress={closePicker} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 25, 22, 0.42)' }}>
        <Pressable onPress={(event) => event.stopPropagation()} style={{ backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%', minHeight: 0, padding: 20 }}>
          <XStack justifyContent="space-between" alignItems="center" marginBottom={14}>
            <Text color={palette.ink} fontSize={20} fontWeight="800">{pickerTitle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close choices" onPress={closePicker} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}><AppSymbol name="close" size={20} color={palette.secondary} /></Pressable>
          </XStack>
          <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {addingCategory && picker === 'category' ? <YStack gap={14} paddingBottom={12}>
              <Text color={palette.secondary} fontSize={13}>Name the money earned outside product sales.</Text>
              <Input value={newCategoryName} onChangeText={(value) => { setNewCategoryName(value); setCategoryError(''); }}
                autoFocus maxLength={100} placeholder="e.g. Commission" aria-label="New income category name"
                height={52} backgroundColor={palette.surface} borderColor={palette.border} color={palette.ink}
                style={{ borderRadius: 12, paddingHorizontal: 14 }} />
              {categoryError ? <Text role="alert" color="#A62925" fontSize={13}>{categoryError}</Text> : null}
              <Button height={52} backgroundColor={palette.primaryDeep} disabled={categoryBusy || !newCategoryName.trim()} onPress={() => void addIncomeCategory()}>
                <Text color="white" fontWeight="800">{categoryBusy ? 'Saving…' : 'Save and select category'}</Text>
              </Button>
              <Button height={44} backgroundColor={palette.background} disabled={categoryBusy} onPress={() => { setAddingCategory(false); setCategoryError(''); }}>
                <Text color={palette.primaryDeep} fontWeight="700">Back to categories</Text>
              </Button>
            </YStack> : addingAccount && picker === 'account' ? <YStack gap={16} paddingBottom={10}>
              <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Account name</Text>
                <Input value={newAccountName} onChangeText={(value) => { setNewAccountName(value); setAccountCommand(commandId()); setAccountError(''); }}
                  placeholder="e.g. bKash or City Bank" aria-label="Account name" height={52} backgroundColor={palette.surface}
                  borderColor={palette.border} color={palette.ink} style={{ borderRadius: 12, paddingHorizontal: 14 }} />
              </YStack>
              <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Account type</Text>
                <XStack flexWrap="wrap" gap={8}>{(['cash', 'bank', 'wallet', 'other'] as const).map((kind) => <Pressable key={kind}
                  accessibilityRole="button" accessibilityState={{ selected: newAccountKind === kind }}
                  onPress={() => { setNewAccountKind(kind); setAccountCommand(commandId()); setAccountError(''); }}
                  style={{ minHeight: 44, minWidth: 108, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: newAccountKind === kind ? palette.primaryDeep : palette.border,
                    backgroundColor: newAccountKind === kind ? palette.primarySoft : palette.surface, borderRadius: 12 }}>
                  <Text color={newAccountKind === kind ? palette.primaryDeep : palette.ink} fontWeight="700">{kind === 'wallet' ? 'Mobile wallet' : kind === 'cash' ? 'Cash' : kind === 'bank' ? 'Bank' : 'Other'}</Text>
                </Pressable>)}</XStack>
              </YStack>
              <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Reference (optional)</Text>
                <Input value={newAccountReference} onChangeText={(value) => { setNewAccountReference(value); setAccountCommand(commandId()); setAccountError(''); }}
                  placeholder="Last four digits" aria-label="Account reference" height={52} backgroundColor={palette.surface}
                  borderColor={palette.border} color={palette.ink} style={{ borderRadius: 12, paddingHorizontal: 14 }} />
              </YStack>
              <YStack gap={7}><Text color={palette.secondary} fontSize={12} fontWeight="700">Opening balance (optional)</Text>
                <Input value={newAccountOpening} onChangeText={(value) => { setNewAccountOpening(value); setAccountCommand(commandId()); setAccountError(''); }}
                  keyboardType="decimal-pad" placeholder="0.00" aria-label="Opening balance" height={52} backgroundColor={palette.surface}
                  borderColor={palette.border} color={palette.ink} style={{ borderRadius: 12, paddingHorizontal: 14 }} />
              </YStack>
              {accountError ? <Text role="alert" color="#A62925" fontSize={13}>{accountError}</Text> : null}
              <Button height={52} backgroundColor={palette.primaryDeep} disabled={accountBusy || !newAccountName.trim()} onPress={() => void addReceivingAccount()}>
                <Text color="white" fontWeight="800">{accountBusy ? 'Saving…' : 'Save and select account'}</Text>
              </Button>
              <Button height={44} backgroundColor={palette.background} disabled={accountBusy} onPress={() => { setAddingAccount(false); setAccountError(''); }}>
                <Text color={palette.primaryDeep} fontWeight="700">Back to accounts</Text>
              </Button>
            </YStack> : <>
            {choices.length ? choices.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => {
              change(() => { if (picker === 'reason') setReason(item.id as Reason); else if (picker === 'account') setAccountId(item.id);
                else if (picker === 'category') setCategoryId(Number(item.id)); else setCustomerId(item.id); });
              setPicker(null);
            }} style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: palette.border }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }}><AppSymbol name={item.icon} size={20} color={palette.primaryDeep} /></View>
              <YStack flex={1}><Text color={palette.ink} fontSize={15} fontWeight="700">{item.label}</Text>{item.detail ? <Text color={palette.secondary} fontSize={12}>{item.detail}</Text> : null}</YStack>
            </Pressable>) : <Text color={palette.secondary}>No choices available yet.</Text>}
            {picker === 'account' && <Pressable accessibilityRole="button" onPress={() => { setAddingAccount(true); setAccountError(''); }}
              style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }}><AppSymbol name="plus" size={20} color={palette.primaryDeep} /></View>
              <Text color={palette.primaryDeep} fontSize={15} fontWeight="800">Add receiving account</Text>
            </Pressable>}
            {picker === 'category' && <Pressable accessibilityRole="button" onPress={() => { setAddingCategory(true); setNewCategoryName(''); setCategoryError(''); }}
              style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }}><AppSymbol name="plus" size={20} color={palette.primaryDeep} /></View>
              <Text color={palette.primaryDeep} fontSize={15} fontWeight="800">Add new income category</Text>
            </Pressable>}
            </>}
          </ScrollView>
        </Pressable>
      </Pressable></KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}
