import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';

const colors = [
  { background: '#DDF3EF', foreground: '#006D64' },
  { background: '#E7ECFF', foreground: '#3653A8' },
  { background: '#FFF0DB', foreground: '#9A5A13' },
  { background: '#F3E8FA', foreground: '#704293' },
];

export function PartyAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const color = colors[(name.charCodeAt(0) || 0) % colors.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color.background }]}>
    <Text style={{ color: color.foreground, fontSize: size * 0.32, fontWeight: '800' }}>{initials}</Text>
  </View>;
}

export function PartyMetric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'due' | 'positive' }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label.toUpperCase()}</Text>
    <Text style={[styles.metricValue, tone === 'due' && styles.due, tone === 'positive' && styles.positive]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
  </View>;
}

export function PartyButton({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, primary && styles.primary]}>
    <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

export function PartyInfo({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || 'Not provided'}</Text></View>;
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  metric: { flexGrow: 1, flexBasis: '23%', minWidth: 145, minHeight: 88, padding: 15, gap: 9, borderWidth: 1, borderColor: '#E2EAE4', borderRadius: 15, backgroundColor: 'white' },
  metricLabel: { color: '#67766F', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  metricValue: { color: '#15211F', fontSize: 20, fontWeight: '800' },
  due: { color: '#A9630F' },
  positive: { color: '#006D64' },
  button: { minHeight: 42, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#C9DED5', backgroundColor: 'white' },
  primary: { backgroundColor: '#006D64', borderColor: '#006D64' },
  buttonText: { color: '#006D64', fontSize: 12, fontWeight: '800' },
  primaryText: { color: 'white' },
  infoRow: { minHeight: 35, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  infoLabel: { color: '#67766F', fontSize: 12 },
  infoValue: { maxWidth: '70%', color: '#15211F', fontSize: 12, fontWeight: '600', textAlign: 'right' },
});
