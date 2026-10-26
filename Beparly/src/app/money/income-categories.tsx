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

export default function IncomeCategoriesScreen() {
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { if (!token || !businessId) return; setLoading(true); try { const result = await api.incomeCategories(token, businessId); setCategories(result.categories); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load income categories.'); } finally { setLoading(false); } }, [token, businessId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  async function add() {
    if (!token || !businessId || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.createFinancialCategory(token, businessId, 'income', name.trim());
      setCategories((current) => [...current, result.category]); setName('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add income category.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
    <XStack alignItems="center" gap={10} padding={16} backgroundColor={palette.surface}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/more' as Href)} style={{ width: 42, height: 42, justifyContent: 'center' }}><AppSymbol name="back" size={23} color={palette.primaryDeep} /></Pressable>
      <Text color={palette.ink} fontSize={22} fontWeight="800">Income categories</Text>
    </XStack>
    <RefreshableScrollView onRefresh={load} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, alignItems: 'center' }}>
      <YStack width="100%" maxWidth={560} gap={14}>
        <Text color={palette.secondary} fontSize={13}>Sales uses its own category. Money In uses categories for receipts outside a product sale.</Text>
        {loading ? <ActivityIndicator color={palette.primaryDeep} /> : categories.map((item) => <YStack key={item.id} backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={14} padding={16}><Text color={palette.ink} fontWeight="700">{item.name}{item.name.toLowerCase() === 'sales' ? ' · Used by Sales' : ''}</Text></YStack>)}
        <YStack backgroundColor={palette.surface} borderWidth={1} borderColor={palette.border} borderRadius={18} padding={17} gap={10}>
          <Text color={palette.ink} fontWeight="800">Add a category</Text>
          <Input value={name} onChangeText={setName} placeholder="e.g. Delivery income" height={52} borderColor={palette.border} backgroundColor={palette.surface} color={palette.ink} style={{ borderRadius: 12 }} />
          {error ? <Text accessibilityRole="alert" color="#A62925">{error}</Text> : null}
          <Button backgroundColor={palette.primaryDeep} height={50} disabled={busy || !name.trim()} onPress={() => void add()}><Text color="white" fontWeight="700">{busy ? 'Saving…' : 'Add category'}</Text></Button>
        </YStack>
      </YStack>
    </RefreshableScrollView>
  </SafeAreaView>;
}
