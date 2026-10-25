import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { BusinessCreateForm } from '@/components/business-picker';
import { PressScale } from '@/components/motion';
import { palette, spacing } from '@/constants/design-system';

export default function NewBusinessScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <PressScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
            <AppSymbol name="back" color={palette.ink} size={22} />
            <Text style={styles.backText}>Back</Text>
          </PressScale>
          <Text style={styles.eyebrow}>BEPARLY</Text>
          <Text style={styles.title}>New business</Text>
          <Text style={styles.subtitle}>Create a separate space for this business and its team.</Text>
          <BusinessCreateForm onCreated={() => router.replace('/')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  scroll: { flexGrow: 1, alignItems: 'center', paddingBottom: spacing.xxl },
  content: { width: '100%', maxWidth: 480, padding: spacing.xl },
  back: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxl },
  backText: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: palette.primaryDeep, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.sm },
  title: { color: palette.ink, fontSize: 28, fontWeight: '700' },
  subtitle: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
});
