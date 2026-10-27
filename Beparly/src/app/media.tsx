import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api, type MediaImage } from '@/services/api';

export default function MediaLibrary() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const owner = session?.account?.role === 'owner';
  const [images, setImages] = useState<MediaImage[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [details, setDetails] = useState<MediaImage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async (page = 1) => {
    if (!session || !businessId) return;
    setBusy(true); setMessage('');
    try {
      const result = await api.media(session.token, businessId, page);
      setImages((current) => page === 1 ? result.images : [...current, ...result.images]);
      setNext(result.next_page);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not load photos.'); }
    finally { setBusy(false); }
  }, [session, businessId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  async function openDetails(id: string) {
    if (!session || !businessId) return;
    try { setDetails((await api.mediaDetail(session.token, businessId, id)).image); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not load photo details.'); }
  }
  async function copyLinks() {
    if (!session || !businessId || !selected.length) return;
    setBusy(true);
    try {
      const links = await Promise.all(selected.map(async (id) => (await api.mediaDetail(session.token, businessId, id)).image.image_url));
      const copied = await Clipboard.setStringAsync(links.join('\n'));
      setMessage(copied ? `Copied ${links.length} link${links.length === 1 ? '' : 's'}. Links expire in about one hour.` : 'Could not copy links.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not copy links.'); }
    finally { setBusy(false); }
  }
  async function removeSelected() {
    if (!session || !businessId || !selected.length) return;
    setBusy(true); setConfirmDelete(false);
    try {
      await api.deleteMedia(session.token, businessId, selected);
      setSelected([]); setSelecting(false); setDetails(null);
      await load(); setMessage('Photos deleted and removed from attached records.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not delete photos.'); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!session || !businessId || !owner) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (picked.canceled || !picked.assets[0]) return;
      setBusy(true);
      await api.uploadMedia(session.token, businessId, picked.assets[0].uri);
      await load(); setMessage('Photo added to the library.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not add photo.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>‹ Back</Text></Pressable>
      <Text style={styles.title}>Media library</Text>
      <Pressable onPress={() => { setSelecting(!selecting); setSelected([]); }}><Text style={styles.link}>{selecting ? 'Done' : 'Select'}</Text></Pressable>
    </View>
    <Text style={styles.hint}>Hold a photo to select several. Photos can be reused across products and suppliers.</Text>
    {owner && <Pressable disabled={busy} onPress={() => void upload()} style={styles.primary}><Text style={styles.primaryText}>Add photo</Text></Pressable>}
    {!!selected.length && <View style={styles.toolbar}>
      <Text style={styles.count}>{selected.length} selected</Text>
      <Pressable disabled={busy} onPress={() => void copyLinks()}><Text style={styles.link}>Copy links</Text></Pressable>
      {selected.length === 1 && <Pressable onPress={() => void openDetails(selected[0])}><Text style={styles.link}>Details</Text></Pressable>}
      {owner && <Pressable onPress={() => setConfirmDelete(true)}><Text style={styles.danger}>Delete</Text></Pressable>}
    </View>}
    {!!message && <Text style={styles.message}>{message}</Text>}
    <FlatList data={images} keyExtractor={(item) => item.id} numColumns={2} onRefresh={() => void load()} refreshing={busy && !next}
      contentContainerStyle={styles.grid} renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={`${item.name}${selected.includes(item.id) ? ', selected' : ''}`}
        onLongPress={() => { setSelecting(true); if (!selected.includes(item.id)) toggle(item.id); }}
        onPress={() => selecting ? toggle(item.id) : void openDetails(item.id)}
        style={[styles.tile, selected.includes(item.id) && styles.selected]}>
        <Image source={{ uri: item.image_url }} style={styles.image} contentFit="cover" />
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {selected.includes(item.id) && <Text style={styles.check}>✓ Selected</Text>}
      </Pressable>}
      ListEmptyComponent={!busy ? <Text style={styles.empty}>No photos yet. {owner ? 'Add one to reuse it later.' : ''}</Text> : undefined}
      ListFooterComponent={busy ? <ActivityIndicator /> : next ? <Pressable onPress={() => void load(next)}><Text style={styles.link}>Load more</Text></Pressable> : undefined} />
    <Modal visible={!!details} transparent animationType="fade" onRequestClose={() => setDetails(null)}>
      <View style={styles.overlay}><View style={styles.dialog}>
        <Text style={styles.title}>Photo details</Text>
        {details && <><Image source={{ uri: details.image_url }} style={styles.detailImage} contentFit="contain" />
          <Text>{details.name}</Text><Text>{(details.size / 1024).toFixed(0)} KB · {new Date(details.created_at).toLocaleDateString()}</Text>
          <Text style={styles.hint}>Products: {details.used_by?.products.map((item) => item.name).join(', ') || 'None'}</Text>
          <Text style={styles.hint}>Suppliers: {details.used_by?.suppliers.map((item) => item.name).join(', ') || 'None'}</Text>
          {details.used_by?.business_logo && <Text style={styles.hint}>Used as shop logo</Text>}
          <Pressable onPress={() => void copyDetailLink(details.id)}><Text style={styles.link}>Copy link</Text></Pressable></>}
        <Pressable onPress={() => setDetails(null)}><Text style={styles.link}>Close</Text></Pressable>
      </View></View>
    </Modal>
    {confirmDelete && <View style={styles.confirm}><Text style={styles.count}>Delete {selected.length} photo{selected.length === 1 ? '' : 's'}? Attached products, suppliers, and the shop logo will lose them.</Text>
      <View style={styles.toolbar}><Pressable onPress={() => setConfirmDelete(false)}><Text style={styles.link}>Cancel</Text></Pressable><Pressable onPress={() => void removeSelected()}><Text style={styles.danger}>Delete photos</Text></Pressable></View>
    </View>}
  </SafeAreaView>;

  async function copyDetailLink(id: string) {
    if (!session || !businessId) return;
    try { const { image } = await api.mediaDetail(session.token, businessId, id); await Clipboard.setStringAsync(image.image_url); setMessage('Link copied. It expires in about one hour.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not copy link.'); }
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  title: { color: '#15211F', fontSize: 22, fontWeight: '800' }, link: { color: '#006D64', fontWeight: '700', padding: 6 },
  hint: { color: '#52635E', fontSize: 13, marginHorizontal: 18, marginBottom: 10 },
  primary: { backgroundColor: '#006D64', borderRadius: 12, marginHorizontal: 18, padding: 14, alignItems: 'center' }, primaryText: { color: 'white', fontWeight: '700' },
  toolbar: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10, flexWrap: 'wrap' }, count: { color: '#15211F', fontWeight: '700' },
  danger: { color: '#A62925', fontWeight: '700', padding: 6 }, message: { color: '#006D64', marginHorizontal: 18, marginVertical: 8 },
  grid: { padding: 12, gap: 12 }, tile: { backgroundColor: 'white', borderRadius: 12, padding: 8, width: '48%', marginRight: '2%', borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: '#006D64' }, image: { width: '100%', aspectRatio: 1, borderRadius: 8 }, name: { color: '#15211F', marginTop: 6 }, check: { color: '#006D64', fontWeight: '700' },
  empty: { color: '#52635E', margin: 18 }, overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: 'white', padding: 20, borderRadius: 16, gap: 10 }, detailImage: { width: '100%', height: 220 },
  confirm: { backgroundColor: 'white', borderTopWidth: 1, borderColor: '#DCE6E2', padding: 18 },
});
