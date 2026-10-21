import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { PressScale } from '@/components/motion';
import { appFontFamily, elevation, palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';

export function BusinessCreateForm({ onCreated }: { onCreated?: () => void }) {
  const { createBusiness } = useAuth();
  const [name, setName] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim()) {
      setError('Enter a business name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createBusiness(name.trim(), openingCash.trim() || undefined);
      setName('');
      setOpeningCash('');
      onCreated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create business.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Add a business</Text>
      <Text style={styles.formHint}>Each business keeps its own products, stock, and team.</Text>
      <Text style={styles.label}>Business name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Rahman Traders"
        placeholderTextColor="#93A29C"
        maxLength={160}
        autoCapitalize="words"
        returnKeyType="next"
        accessibilityLabel="Business name"
      />
      <Text style={styles.label}>Opening cash (optional)</Text>
      <Text style={styles.formHint}>Cash already in the business when you start. Add later money through a recorded activity.</Text>
      <TextInput
        style={styles.input}
        value={openingCash}
        onChangeText={setOpeningCash}
        placeholder="৳ 0.00"
        placeholderTextColor="#93A29C"
        keyboardType="decimal-pad"
        accessibilityLabel="Opening cash balance"
      />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <PressScale onPress={submit} disabled={busy} accessibilityRole="button" accessibilityLabel="Create business profile">
        <View style={[styles.createButton, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createText}>Create business</Text>}
        </View>
      </PressScale>
    </View>
  );
}

export function BusinessPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, selectBusiness } = useAuth();
  if (!session) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close business picker" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeading}>
            <View><Text style={styles.title}>Your businesses</Text><Text style={styles.subtitle}>Choose where you want to work.</Text></View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            {session.businesses.map((business) => (
              <PressScale
                key={business.id}
                onPress={() => { selectBusiness(business.id); onClose(); }}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${business.name}`}>
                <View style={[styles.businessRow, session.account?.business.id === business.id && styles.selectedRow]}>
                  <View style={styles.businessAvatar}><Text style={styles.businessInitial}>{business.name.charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.businessCopy}>
                    <Text style={styles.businessName} numberOfLines={1}>{business.name}</Text>
                    <Text style={styles.businessRole}>{business.role === 'owner' ? 'Owner' : 'Employee'}{session.account?.business.id === business.id ? ' · Current' : ''}</Text>
                  </View>
                  <AppSymbol name="chevron" color={palette.muted} size={20} />
                </View>
              </PressScale>
            ))}
            <BusinessCreateForm onCreated={onClose} />
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(11, 35, 31, 0.45)' },
  sheet: { backgroundColor: palette.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '85%', ...elevation.hero },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.border, alignSelf: 'center', marginTop: spacing.sm },
  sheetHeading: { padding: spacing.xl, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  title: { color: palette.ink, fontSize: 21, fontWeight: '700' },
  subtitle: { color: palette.muted, fontSize: 13, marginTop: spacing.xs },
  close: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  closeText: { color: palette.primaryDeep, fontSize: 13, fontWeight: '600' },
  sheetContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  businessRow: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 68 },
  selectedRow: { borderColor: palette.primary, backgroundColor: '#F5FCFA' },
  businessAvatar: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  businessInitial: { color: palette.primaryDeep, fontSize: 18, fontWeight: '700' },
  businessCopy: { flex: 1, gap: spacing.xs },
  businessName: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  businessRole: { color: palette.muted, fontSize: 12 },
  form: { marginTop: spacing.md, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.xl, gap: spacing.md },
  formTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  formHint: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  label: { color: palette.secondary, fontSize: 13, fontWeight: '600' },
  input: { height: 50, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: palette.ink, fontSize: 15, fontFamily: appFontFamily, backgroundColor: palette.surface },
  error: { color: '#A62925', fontSize: 13 },
  createButton: { height: 50, borderRadius: radius.sm, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
