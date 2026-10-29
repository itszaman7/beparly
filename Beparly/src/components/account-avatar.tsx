import { Image, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/components/app-text';
import { palette } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { resolveAssetUrl } from '@/services/api';

export function AccountAvatar({ size = 40 }: { size?: number }) {
  const { session } = useAuth();
  const name = session?.user.name || session?.user.phone || 'U';
  const imageUrl = resolveAssetUrl(session?.user.avatar_url);
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
    {imageUrl ? <Image source={{ uri: imageUrl }} style={[styles.image, { borderRadius: size / 2 }]} />
      : <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{name.charAt(0).toUpperCase()}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: palette.primarySoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  initial: { color: palette.primaryDeep, fontWeight: '800' },
});
