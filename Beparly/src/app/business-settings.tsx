import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { useAuth } from '@/features/auth/auth-context';
import { api, resolveAssetUrl } from '@/services/api';
import { blurWebFocus } from '@/utils/web-focus';

export default function BusinessSettings() {
  const { session, refreshBusinesses } = useAuth();
  const id = session?.account?.business.id;
  const owner = session?.account?.role === 'owner';
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [showSymbol, setShowSymbol] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState({ phone: '', address: '', showSymbol: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!session || !id) return;
    try { const { business } = await api.businessProfile(session.token, id);
      const next = { phone: business.phone ?? '', address: business.address ?? '', showSymbol: business.show_currency_symbol ?? true };
      setPhone(next.phone); setAddress(next.address); setShowSymbol(next.showSymbol); setSaved(next);
      setLogoUrl(resolveAssetUrl(business.logo_url)); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load business settings.'); }
  }, [session, id]);
  useEffect(() => { const timeout = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timeout); }, [load]);

  async function chooseLogo() {
    if (!session || !id || busy) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      setBusy(true);
      setMessage('');
      const uploaded = await api.uploadBusinessLogo(session.token, id, result.assets[0].uri);
      setLogoUrl(resolveAssetUrl(uploaded.logo_url));
      await refreshBusinesses();
      setMessage('Shop logo saved. It will appear on invoices and receipts.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the shop logo.');
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!session || !id || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.removeBusinessLogo(session.token, id);
      setLogoUrl(null);
      await refreshBusinesses();
      setMessage('Shop logo removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove the shop logo.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!session || !id || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.updateBusinessProfile(session.token, id, { phone, address, show_currency_symbol: showSymbol });
      setSaved({ phone, address, showSymbol });
      await refreshBusinesses();
      setMessage('Business settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><RefreshableScrollView onRefresh={() => { if (phone !== saved.phone || address !== saved.address || showSymbol !== saved.showSymbol) { setMessage('Save or discard your changes before refreshing.'); return; } return load(); }} contentContainerStyle={styles.screen}>
    <Pressable onPress={() => { blurWebFocus(); router.back(); }}><Text style={styles.back}>‹ Back</Text></Pressable>
    <Text style={styles.title}>Business settings</Text>
    <Text style={styles.muted}>These details appear on sales invoices and receipts. Currency display applies to everyone in this business.</Text>
    <View style={styles.logoCard}>
      {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" /> : <View style={styles.logoPlaceholder}><Text style={styles.logoPlaceholderText}>No logo</Text></View>}
      <View style={styles.logoActions}>
        <Text style={styles.logoTitle}>Shop logo</Text>
        <Text style={styles.muted}>Shown on invoices and receipts. JPG, PNG or WebP, up to 5 MB.</Text>
        {owner && <View style={styles.logoButtons}>
          <Pressable onPress={() => void chooseLogo()} disabled={busy} style={styles.secondary}><Text style={styles.secondaryText}>{logoUrl ? 'Change logo' : 'Add logo'}</Text></Pressable>
          {logoUrl && <Pressable onPress={() => void removeLogo()} disabled={busy} style={styles.secondary}><Text style={styles.removeText}>Remove</Text></Pressable>}
        </View>}
      </View>
    </View>
    <Text style={styles.label}>Business phone</Text>
    <TextInput value={phone} onChangeText={setPhone} editable={owner && !busy} style={styles.input} keyboardType="phone-pad" />
    <Text style={styles.label}>Business address</Text>
    <TextInput value={address} onChangeText={setAddress} editable={owner && !busy} style={[styles.input, styles.address]} multiline />
    <View style={styles.setting}><View style={styles.settingText}><Text style={styles.label}>Show ৳ currency symbol</Text><Text style={styles.muted}>Hides only the symbol; amounts remain in BDT.</Text></View><Switch value={showSymbol} onValueChange={setShowSymbol} disabled={!owner || busy} /></View>
    {owner && <Pressable onPress={() => void save()} disabled={busy} style={[styles.save, busy && styles.disabled]}><Text style={styles.saveText}>{busy ? 'Saving…' : 'Save changes'}</Text></Pressable>}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </RefreshableScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' },
  screen: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, gap: 12, paddingBottom: 40 },
  back: { color: '#006D64', fontWeight: '700' },
  title: { color: '#15211F', fontSize: 25, fontWeight: '800' },
  muted: { color: '#52635E', fontSize: 13 },
  label: { color: '#52635E', fontSize: 12, fontWeight: '700', marginTop: 8 },
  logoCard: { flexDirection: 'row', gap: 15, padding: 14, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 14, backgroundColor: 'white', alignItems: 'center' },
  logo: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#F6F8F7' },
  logoPlaceholder: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#F0F4F2', alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderText: { color: '#73837C', fontSize: 12 },
  logoActions: { flex: 1, gap: 6 },
  logoTitle: { color: '#15211F', fontSize: 15, fontWeight: '700' },
  logoButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  secondary: { borderWidth: 1, borderColor: '#B7D5CC', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { color: '#006D64', fontWeight: '700' },
  removeText: { color: '#A62925', fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 12, backgroundColor: 'white', paddingHorizontal: 12, color: '#15211F' },
  address: { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 },
  setting: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  settingText: { flex: 1 },
  save: { minHeight: 50, borderRadius: 14, backgroundColor: '#006D64', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  disabled: { opacity: 0.5 },
  saveText: { color: 'white', fontWeight: '800' },
  message: { color: '#006D64', fontWeight: '700' },
});
