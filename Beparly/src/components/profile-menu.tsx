import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { elevation, palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';

type ProfileMenuProps = {
  visible: boolean;
  onClose: () => void;
  onSwitchBusiness?: () => void;
};

export function ProfileMenu({ visible, onClose, onSwitchBusiness }: ProfileMenuProps) {
  const { session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  if (!session) return null;

  const name = session.user.name || (session.account?.role === 'owner' ? 'Owner' : 'User');
  const open = (path: '/explore' | '/more') => {
    onClose();
    router.push(path);
  };

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close account menu" />
        <View style={[styles.anchor, { paddingTop: insets.top + 78 }]} pointerEvents="box-none">
          <View style={styles.card}>
            <View style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.phone}>{session.user.phone}</Text>
              {session.account && <Text style={styles.business} numberOfLines={1}>{session.account.business.name} · {session.account.role}</Text>}
            </View>
            <MenuItem label="Account & team" icon="account" onPress={() => open('/explore')} />
            {onSwitchBusiness && <MenuItem label="Switch business" icon="down" onPress={() => {
              onClose();
              onSwitchBusiness();
            }} />}
            <MenuItem label="Settings" icon="edit" onPress={() => open('/more')} />
            <View style={styles.divider} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <MenuItem label={signingOut ? 'Signing out…' : 'Sign out'} icon="deactivate" danger disabled={signingOut} onPress={() => void logout()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ label, icon, onPress, danger = false, disabled = false }: {
  label: string;
  icon: AppSymbolName;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const color = danger ? '#A62925' : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.item}>
    <AppSymbol name={icon} size={20} color={color} />
    <Text style={[styles.itemText, { color }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.2)' },
  anchor: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'flex-end', paddingHorizontal: spacing.lg },
  card: { width: 264, maxWidth: '100%', backgroundColor: palette.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.border, paddingVertical: spacing.xs, ...elevation.card },
  identity: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
  name: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  phone: { color: palette.secondary, fontSize: 13 },
  business: { color: palette.muted, fontSize: 12 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: spacing.xs },
  item: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  itemText: { fontSize: 14, fontWeight: '600' },
  error: { color: '#A62925', fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
});
