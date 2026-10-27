import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api, type MediaImage } from '@/services/api';

export function MediaPicker({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (image: MediaImage) => void;
}) {
  const { session } = useAuth();
  const [images, setImages] = useState<MediaImage[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (page: number) => {
    if (!session?.account) return;
    setBusy(true); setError('');
    try {
      const result = await api.media(session.token, session.account.business.id, page);
      setImages((current) => page === 1 ? result.images : [...current, ...result.images]);
      setNext(result.next_page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load photos.'); }
    finally { setBusy(false); }
  }, [session]);
  useEffect(() => { if (visible) void Promise.resolve().then(() => load(1)); }, [visible, load]);

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.screen}>
      <View style={styles.header}><Text style={styles.title}>Choose from media library</Text><Pressable onPress={onClose}><Text style={styles.action}>Close</Text></Pressable></View>
      {error ? <Pressable onPress={() => void load(1)}><Text style={styles.error}>{error} Tap to retry.</Text></Pressable> : null}
      <FlatList data={images} keyExtractor={(item) => item.id} numColumns={2} contentContainerStyle={styles.grid}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Use ${item.name}`} onPress={() => { onSelect(item); onClose(); }} style={styles.tile}>
          <Image source={{ uri: item.image_url }} style={styles.image} /><Text numberOfLines={1} style={styles.name}>{item.name}</Text>
        </Pressable>}
        ListEmptyComponent={!busy ? <Text style={styles.empty}>No photos in the library yet.</Text> : undefined}
        ListFooterComponent={busy ? <ActivityIndicator /> : next ? <Pressable onPress={() => void load(next)}><Text style={styles.action}>Load more</Text></Pressable> : undefined} />
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F7', padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: '#15211F', fontSize: 19, fontWeight: '700' }, action: { color: '#006D64', fontWeight: '700', padding: 10 },
  grid: { gap: 12 }, tile: { width: '48%', marginRight: '2%', backgroundColor: 'white', padding: 8, borderRadius: 12 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 8 }, name: { color: '#15211F', marginTop: 6 },
  empty: { color: '#52635E', marginTop: 28 }, error: { color: '#A62925', marginBottom: 12 },
});
