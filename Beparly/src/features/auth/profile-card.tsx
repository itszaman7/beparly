import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AccountAvatar } from '@/components/account-avatar';
import { AppText as Text } from '@/components/app-text';
import { palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/services/api';

export function ProfileCard({ role }: { role?: string }) {
  const { session, refreshBusinesses } = useAuth();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!session) return null;

  async function saveName() {
    if (!session || busy) return;
    setBusy(true); setMessage('');
    try {
      await api.updateAccountProfile(session.token, name.trim());
      await refreshBusinesses();
      setEditing(false);
      setMessage('Name saved.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not save your name.'); }
    finally { setBusy(false); }
  }

  async function choosePhoto() {
    if (!session || busy) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      setBusy(true); setMessage('');
      await api.uploadAccountAvatar(session.token, result.assets[0].uri);
      await refreshBusinesses();
      setMessage('Profile photo saved.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not save your photo.'); }
    finally { setBusy(false); }
  }

  async function removePhoto() {
    if (!session || busy) return;
    setBusy(true); setMessage('');
    try {
      await api.removeAccountAvatar(session.token);
      await refreshBusinesses();
      setMessage('Profile photo removed.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not remove your photo.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.card}>
    <View style={styles.identity}>
      <AccountAvatar size={64} />
      <View style={styles.identityCopy}>
        <Text style={styles.name}>{session.user.name || session.user.phone}</Text>
        <Text style={styles.role}>{role || 'Personal account'}</Text>
      </View>
    </View>
    <View style={styles.actions}>
      <Pressable onPress={() => void choosePhoto()} disabled={busy} accessibilityRole="button" style={styles.action}><Text style={styles.actionText}>Upload photo</Text></Pressable>
      {session.user.avatar_url && <Pressable onPress={() => void removePhoto()} disabled={busy} accessibilityRole="button" style={styles.action}><Text style={styles.actionText}>Remove photo</Text></Pressable>}
    </View>
    <View style={styles.divider} />
    <Text style={styles.label}>Name</Text>
    {editing ? <View style={styles.editRow}>
      <TextInput accessibilityLabel="Account name" style={styles.input} value={name} onChangeText={setName} maxLength={150} autoCapitalize="words" />
      <Pressable onPress={() => void saveName()} disabled={busy || !name.trim()} accessibilityRole="button" style={[styles.save, (busy || !name.trim()) && styles.disabled]}><Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
      <Pressable onPress={() => { setName(session.user.name); setEditing(false); setMessage(''); }} disabled={busy} accessibilityRole="button" style={styles.cancel}><Text style={styles.actionText}>Cancel</Text></Pressable>
    </View> : <Pressable onPress={() => { setName(session.user.name); setEditing(true); }} accessibilityRole="button" style={styles.fieldRow}><Text style={styles.value}>{session.user.name || 'Add your name'}</Text><Text style={styles.actionText}>Edit</Text></Pressable>}
    <Text style={styles.label}>Phone number</Text>
    <Text style={styles.value}>{session.user.phone}</Text>
    {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.xl, gap: spacing.sm },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, identityCopy: { flex: 1, minWidth: 0 },
  name: { color: palette.ink, fontSize: 18, fontWeight: '700' }, role: { color: palette.muted, fontSize: 13, marginTop: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  action: { minHeight: 42, justifyContent: 'center' }, actionText: { color: palette.primaryDeep, fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.sm }, label: { color: palette.muted, fontSize: 13 },
  value: { color: palette.ink, fontSize: 16, fontWeight: '600' }, fieldRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  editRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  input: { flex: 1, minWidth: 160, minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: palette.ink },
  save: { minHeight: 44, paddingHorizontal: spacing.md, backgroundColor: palette.primaryDeep, borderRadius: radius.sm, justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, cancel: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  disabled: { opacity: 0.5 }, message: { color: palette.secondary, fontSize: 13, marginTop: spacing.sm },
});
