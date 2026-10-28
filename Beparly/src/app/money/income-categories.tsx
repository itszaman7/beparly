import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, Text, XStack, YStack } from 'tamagui';

import { AppSymbol } from '@/components/app-symbol';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/services/api';

type IncomeCategory = { id: number; name: string; can_edit: boolean };

export default function IncomeCategoriesScreen() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const owner = session?.account?.role === 'owner';
  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { if (!token || !businessId || !owner) { setLoading(false); return; } setLoading(true); try { const result = await api.incomeCategories(token, businessId); setCategories(result.categories); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load income categories.'); } finally { setLoading(false); } }, [token, businessId, owner]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function add() {
    if (!token || !businessId || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.createFinancialCategory(token, businessId, 'income', name.trim());
      setCategories((current) => [...current, { ...result.category, can_edit: true }]); setName('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add income category.'); }
    finally { setBusy(false); }
  }
  async function rename() {
    if (!token || !businessId || editingId === null || !editingName.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.renameIncomeCategory(token, businessId, editingId, editingName.trim());
      setCategories((current) => current.map((item) => item.id === editingId ? { ...item, name: result.category.name } : item));
      setEditingId(null); setEditingName('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename income category.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor={palette.surface}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/more' as Href)} style={{ width: 42, height: 42, justifyContent: 'center' }}><AppSymbol name="back" size={23} color={palette.primaryDeep} /></Pressable>
      <Text color={palette.ink} fontSize={22} fontWeight="800">Income categories</Text>
    </XStack>
    <RefreshableScrollView onRefresh={load} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 18, alignItems: 'center' }}>
      <YStack width="100%" maxWidth={560} gap={14}>
        <Text color={palette.secondary} fontSize={13} lineHeight={19}>A category describes where income outside product sales came from, such as commission or service fees. It helps group that income in reports. Product sales are recorded separately.</Text>
        <Text color={palette.secondary} fontSize={12}>Sales and Miscellaneous income are built-in. Add your own category to use a different name.</Text>
        {!owner && <Text role="alert" color="#A62925">Only the business owner can add or rename income categories.</Text>}
        {loading ? <ActivityIndicator color={palette.primaryDeep} /> : categories.map((item) => <YStack key={item.id} backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={14} padding={16} gap={10}>
          <XStack alignItems="center" justifyContent="space-between" gap={10}>
            <Text flex={1} color={palette.ink} fontWeight="700">{item.name}{item.name.toLowerCase() === 'sales' ? ' · Used by Sales' : ''}</Text>
            {item.can_edit && editingId !== item.id && <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${item.name}`} onPress={() => { setEditingId(item.id); setEditingName(item.name); setError(''); }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text color={palette.primaryDeep} fontWeight="700">Rename</Text></Pressable>}
            {!item.can_edit && <Text color={palette.secondary} fontSize={11}>Built-in</Text>}
          </XStack>
          {editingId === item.id && <YStack gap={9}>
            <Input value={editingName} onChangeText={setEditingName} maxLength={100} autoFocus aria-label="New income category name" height={52} borderColor={palette.border} backgroundColor={palette.surface} color={palette.ink} style={{ borderRadius: 12 }} />
            <Text color={palette.secondary} fontSize={12}>Past reports will display the new name. Amounts stay the same.</Text>
            {error ? <Text role="alert" color="#A62925">{error}</Text> : null}
            <XStack gap={8}>
              <Button flex={1} height={46} backgroundColor={palette.primaryDeep} disabled={busy || !editingName.trim()} onPress={() => void rename()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : 'Save name'}</Text></Button>
              <Button flex={1} height={46} backgroundColor={palette.background} disabled={busy} onPress={() => { setEditingId(null); setError(''); }}><Text color={palette.primaryDeep} fontWeight="700">Cancel</Text></Button>
            </XStack>
          </YStack>}
        </YStack>)}
        {owner && <YStack backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={18} padding={17} gap={10}>
          <Text color={palette.ink} fontWeight="800">Add a category</Text>
          <Input value={name} onChangeText={setName} placeholder="e.g. Commission" aria-label="New income category name" maxLength={100} height={52} borderColor={palette.border} backgroundColor={palette.surface} color={palette.ink} style={{ borderRadius: 12 }} />
          {error && editingId === null ? <Text role="alert" color="#A62925">{error}</Text> : null}
          <Button backgroundColor={palette.primaryDeep} height={50} disabled={busy || !name.trim()} onPress={() => void add()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : 'Add category'}</Text></Button>
        </YStack>}
      </YStack>
    </RefreshableScrollView>
  </SafeAreaView>;
}
