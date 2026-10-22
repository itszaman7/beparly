import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useEffect } from 'react';
import { TamaguiProvider } from 'tamagui';
import { Toast } from 'tamagui/toast';

import { AppText } from '@/components/app-text';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tamaguiConfig } from '../../tamagui.config';

export function SuspenseFallback() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#00B8A9" />
    </View>
  );
}

function Navigation() {
  const { session, restoring, restoreError, retryRestore } = useAuth();
  const segments = useSegments();
  const [fontsLoaded, fontError] = useFonts({
    BeparlyRobotoRegular: require('../../assets/fonts/Roboto-Regular.ttf'),
    BeparlyRobotoMedium: require('../../assets/fonts/Roboto-Medium.ttf'),
    BeparlyRobotoBold: require('../../assets/fonts/Roboto-Bold.ttf'),
  });
  const colorScheme = useColorScheme();
  useEffect(() => {
    if (restoring || restoreError) return;
    const authRoute = segments[0] === 'sign-in' || segments[0] === 'register';
    if (!session && !authRoute) void router.replace('/sign-in');
    if (session && authRoute) void router.replace('/');
  }, [restoreError, restoring, session, segments]);
  if ((!fontsLoaded && !fontError) || restoring) return <SuspenseFallback />;
  if (restoreError) return (
    <View style={{ flex: 1, backgroundColor: '#F6F8F7', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <AppText style={{ color: '#15211F', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>Could not reconnect</AppText>
      <AppText style={{ color: '#52635E', fontSize: 14, textAlign: 'center', marginTop: 10 }}>{restoreError}</AppText>
      <Pressable accessibilityRole="button" onPress={() => void retryRestore()} style={{ backgroundColor: '#006D64', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, marginTop: 24 }}>
        <AppText style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Try again</AppText>
      </Pressable>
    </View>
  );
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={colorScheme ?? 'light'}>
      <Toast position="top-center" duration={4000}>
        <Toast.Viewport offset={64}><Toast.List /></Toast.Viewport>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="stock" />
            <Stack.Screen name="products" />
            <Stack.Screen name="money" />
            <Stack.Screen name="sales" />
            <Stack.Screen name="suppliers" />
            <Stack.Screen name="purchases" />
            <Stack.Screen name="contacts" />
            <Stack.Screen name="assets" />
            <Stack.Screen name="business-settings" />
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="register" />
          </Stack>
        </ThemeProvider>
      </Toast>
    </TamaguiProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <Navigation />
    </AuthProvider>
  );
}
