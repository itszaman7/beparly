import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { useAuth } from '@/features/auth/auth-context';

export default function More() {
  const { session, refreshBusinesses, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const items = [
    ['Quotations', '/sales/quotations', 'duplicate'] as const,
    ['Business settings', '/business-settings', 'edit'] as const,
    ['Media library', '/media', 'products'] as const,
    ['Print settings', '/print-settings', 'reports'] as const,
    ...(session?.account?.role === 'owner' ? [['Income categories', '/money/income-categories', 'category'] as const] : []),
    ['Account & team', '/explore', 'account'] as const,
  ];

  return <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F8F7' }}><RefreshableScrollView onRefresh={refreshBusinesses} contentContainerStyle={{ alignItems: 'center', padding: 20 }}>
    <YStack width="100%" maxWidth={560} gap={12}>
      <Text color="#15211F" fontSize={27} fontWeight="700">Settings</Text>
      <Text color="#52635E" fontSize={13}>{session?.account?.business.name}</Text>
      {items.map(([label, href, icon]) =>
        <Button key={href} height={62} justifyContent="flex-start" paddingHorizontal={18} backgroundColor="white" borderWidth={1} borderColor="#E5ECE9" borderRadius={15} onPress={() => router.push(href as Href)}>
          <AppSymbol name={icon as AppSymbolName} size={22} color="#006D64" /><Text color="#15211F" fontSize={16} fontWeight="700">{label}</Text>
        </Button>)}
      {!!signOutError && <Text color="#A62925" fontSize={13}>{signOutError}</Text>}
      <Button height={54} marginTop={8} backgroundColor="white" borderWidth={1} borderColor="#E5ECE9" borderRadius={15}
        disabled={signingOut} accessibilityLabel="Sign out" onPress={async () => {
          if (signingOut) return;
          setSigningOut(true);
          setSignOutError('');
          try { await signOut(); }
          catch (cause) { setSignOutError(cause instanceof Error ? cause.message : 'Could not sign out.'); }
          finally { setSigningOut(false); }
        }}>
        <Text color="#A62925" fontSize={16} fontWeight="700">{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Button>
    </YStack>
  </RefreshableScrollView></SafeAreaView>;
}
