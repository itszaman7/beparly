import { router, type Href } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { useAuth } from '@/features/auth/auth-context';

export default function More() {
  const { session } = useAuth();
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F8F7' }}><ScrollView contentContainerStyle={{ alignItems: 'center', padding: 20 }}>
    <YStack width="100%" maxWidth={560} gap={12}>
      <Text color="#15211F" fontSize={27} fontWeight="700">More</Text>
      <Text color="#52635E" fontSize={13}>{session?.account?.business.name}</Text>
      {([...(session?.account?.role === 'owner' ? [['Money', '/money', 'receive'], ['Contacts', '/contacts', 'parties'], ['My assets', '/assets', 'products']] as const : []), ['Account & team', '/explore', 'account']] as const).map(([label, href, icon]) =>
        <Button key={href} height={62} justifyContent="flex-start" paddingHorizontal={18} backgroundColor="white" borderWidth={1} borderColor="#E5ECE9" borderRadius={15} onPress={() => router.push(href as Href)}>
          <AppSymbol name={icon as AppSymbolName} size={22} color="#006D64" /><Text color="#15211F" fontSize={16} fontWeight="700">{label}</Text>
        </Button>)}
    </YStack>
  </ScrollView></SafeAreaView>;
}
