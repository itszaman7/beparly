import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type symbols } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { Entrance } from '@/components/motion';
import { appFontFamily, elevation, palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, LocationInput, StockLocation } from '@/services/api';

type LocationState = { location: StockLocation; canManage: boolean };

function useLocation() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const businessId = session?.account?.business.id;
  const token = session?.token;
  const locationId = Number(id);
  const [state, setState] = useState<LocationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!token || !businessId || !Number.isSafeInteger(locationId) || locationId < 1) {
      setError('Location not found.'); setLoading(false); return;
    }
    setState(null); setLoading(true); setError('');
    try {
      const result = await api.location(token, businessId, locationId);
      setState({ location: result.location, canManage: result.can_manage_locations });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load location.');
    } finally { setLoading(false); }
  }, [token, businessId, locationId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { session, businessId, token, locationId, state, loading, error, setError, refresh };
}

function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace(title === 'My Locations' ? '/' : '/stock' as Href)} style={styles.back}>
          <AppSymbol name="chevron" size={18} color={palette.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Entrance><Text style={styles.eyebrow}>STOCK</Text><Text style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</Entrance>
        <View style={styles.body}>{children}</View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function Message({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{title}</Text>
    {detail && <Text style={styles.muted}>{detail}</Text>}
    {retry && <Pressable accessibilityRole="button" onPress={retry} style={styles.textButton}><Text style={styles.link}>Try again</Text></Pressable>}
  </View>;
}

function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, disabled && styles.actionDisabled, pressed && styles.pressed]}>
    <Text style={[styles.actionText, secondary && styles.actionTextSecondary, disabled && styles.disabledText]}>{label}</Text>
  </Pressable>;
}

function DetailAction({ label, icon, onPress, disabled = false, tone = 'outline', color = palette.primary, background = palette.primarySoft }: {
  label: string;
  icon: keyof typeof symbols;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'outline' | 'danger';
  color?: string;
  background?: string;
}) {
  const iconColor = disabled ? palette.muted : tone === 'danger' ? palette.rose : color;
  const iconBackground = tone === 'danger' ? palette.roseSoft : background;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.detailAction, tone === 'danger' && styles.detailActionDanger, disabled && styles.detailActionDisabled, pressed && styles.pressed]}>
    <View style={[styles.detailActionIcon, { backgroundColor: iconBackground }]}><AppSymbol name={icon} size={19} color={iconColor} /></View>
    <Text style={[styles.detailActionText, tone === 'danger' && styles.detailActionDangerText]} numberOfLines={2}>{label}</Text>
  </Pressable>;
}

function LocationCard({ location }: { location: StockLocation }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${location.name}`} onPress={() => router.push(`/stock/${location.id}` as Href)}
    style={({ pressed }) => [styles.card, styles.locationCard, pressed && styles.pressed]}>
    <View style={[styles.icon, location.type === 'warehouse' && { backgroundColor: palette.purpleSoft }]}><AppSymbol name={location.type === 'warehouse' ? 'stock' : 'home'} color={location.type === 'warehouse' ? palette.purple : palette.primary} size={24} /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.cardTitle}>{location.name}</Text>
      <Text style={styles.muted}>{location.type === 'warehouse' ? 'Warehouse' : 'Shop'}{location.address ? ` · ${location.address}` : ''}</Text>
      {(location.is_default || !location.is_active) && <Text style={styles.badge}>{location.is_default ? 'Default' : 'Inactive'}</Text>}
    </View>
    <AppSymbol name="chevron" size={19} color={palette.muted} />
  </Pressable>;
}

export function LocationsScreen() {
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const token = session?.token;
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!token || !businessId) { setError('Select a business from Home first.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const result = await api.locations(token, businessId);
      setLocations(result.locations); setCanManage(result.can_manage_locations);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load locations.'); }
    finally { setLoading(false); }
  }, [token, businessId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <Page title="My Locations" subtitle={session?.account?.business.name}>
    {canManage && <Action label="+ Add location" onPress={() => router.push('/stock/new')} />}
    {loading ? <ActivityIndicator color={palette.primary} /> : error ? <Message title="Locations unavailable" detail={error} retry={() => void refresh()} /> :
      locations.length ? locations.map((location) => <LocationCard key={location.id} location={location} />) :
        <Message title="No locations yet" detail="Add a shop or warehouse to get started." />}
  </Page>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

export function LocationDetailsScreen() {
  const { state, loading, error, refresh, token, businessId, locationId, setError } = useLocation();
  const [busy, setBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const location = state?.location;
  async function change(action: 'default' | 'active') {
    if (!token || !businessId || !location) return;
    setBusy(true); setError('');
    try {
      if (action === 'default') await api.setDefaultLocation(token, businessId, locationId);
      else await api.updateLocation(token, businessId, locationId, { is_active: !location.is_active });
      setConfirmDeactivate(false); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update location.'); }
    finally { setBusy(false); }
  }
  return <Page title={location?.name ?? 'Location Details'} subtitle="Shop & warehouse management">
    {loading ? <ActivityIndicator color={palette.primary} /> : error && !location ? <Message title="Location unavailable" detail={error} retry={() => void refresh()} /> : location && <>
      <View style={styles.card}>
        <Info label="Type" value={location.type === 'warehouse' ? 'Warehouse' : 'Shop'} />
        <Info label="Address" value={location.address || 'No address added'} />
        <Info label="Status" value={location.is_active ? 'Active' : 'Inactive'} />
        <Info label="Default" value={location.is_default ? 'Yes' : 'No'} />
      </View>
      <Text style={styles.section}>View stock</Text>
      <View style={styles.detailActionGrid}>
        <DetailAction label="Location stock" icon="products" color={palette.purple} background={palette.purpleSoft} onPress={() => router.push({ pathname: '/stock/[id]/location-stock', params: { id: String(locationId) } })} />
        <DetailAction label="Movements" icon="movements" color={palette.blue} background={palette.blueSoft} onPress={() => router.push({ pathname: '/stock/[id]/movements', params: { id: String(locationId) } })} />
      </View>
      <Text style={styles.section}>Stock actions</Text>
      <View style={styles.detailActionGrid}>
        {(['transfer', 'adjustment', 'waste'] as const).map((action) =>
          <DetailAction key={action} icon={action} label={action === 'transfer' ? 'Transfer stock' : action === 'adjustment' ? 'Adjust stock' : 'Record waste'}
            color={action === 'transfer' ? palette.orange : action === 'adjustment' ? palette.amber : palette.rose}
            background={action === 'transfer' ? palette.orangeSoft : action === 'adjustment' ? palette.amberSoft : palette.roseSoft}
            onPress={() => router.push({ pathname: `/stock/[id]/${action}`, params: { id: String(locationId) } })} />)}
      </View>
      {state.canManage && <>
        <Text style={styles.section}>Manage location</Text>
        <View style={styles.detailActionGrid}>
          <DetailAction label="Edit location" icon="edit" color={palette.blue} background={palette.blueSoft} onPress={() => router.push({ pathname: '/stock/[id]/edit', params: { id: String(locationId) } })} />
          {!location.is_default && location.is_active && <DetailAction label={busy ? 'Updating…' : 'Set as Default'} icon="default" disabled={busy} onPress={() => void change('default')} />}
          {!location.is_default && !confirmDeactivate && <DetailAction label={location.is_active ? 'Deactivate' : 'Reactivate'} icon={location.is_active ? 'deactivate' : 'activate'} tone={location.is_active ? 'danger' : 'outline'} disabled={busy} onPress={() => location.is_active ? setConfirmDeactivate(true) : void change('active')} />}
        </View>
        {!location.is_default && confirmDeactivate && <View style={styles.card}>
          <Text style={styles.muted}>Deactivate {location.name}? Its location record will remain available.</Text>
          <View style={styles.detailActionGrid}>
            <DetailAction label={busy ? 'Updating…' : 'Confirm'} icon="deactivate" tone="danger" disabled={busy} onPress={() => void change('active')} />
            <DetailAction label="Cancel" icon="close" onPress={() => setConfirmDeactivate(false)} />
          </View>
        </View>}
      </>}
      {!!error && <Message title="Could not update location" detail={error} />}
    </>}
  </Page>;
}

export function LocationFormScreen({ editing = false }: { editing?: boolean }) {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const locationId = Number(id);
  const businessId = session?.account?.business.id;
  const token = session?.token;
  const [name, setName] = useState('');
  const [type, setType] = useState<LocationInput['type']>('shop');
  const [address, setAddress] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) { setError('Select a business first.'); setLoading(false); return; }
    let active = true;
    setLoading(true);
    void (editing ? api.location(token, businessId, locationId) : api.locations(token, businessId)).then((result) => {
      if (!active) return;
      setCanManage(result.can_manage_locations);
      if ('location' in result) { setName(result.location.name); setType(result.location.type); setAddress(result.location.address); }
      setError('');
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load location.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, businessId, editing, locationId]));
  async function save() {
    if (!token || !businessId || !canManage) return;
    if (!name.trim()) { setError('Enter a location name.'); return; }
    setBusy(true); setError('');
    try {
      const data = { name: name.trim(), type, address: address.trim() };
      const result = editing ? await api.updateLocation(token, businessId, locationId, data) : await api.createLocation(token, businessId, data);
      router.replace(`/stock/${result.location.id}` as Href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save location.'); }
    finally { setBusy(false); }
  }
  return <Page title={editing ? 'Edit Location' : 'Add Location'} subtitle={session?.account?.business.name}>
    {loading ? <ActivityIndicator color={palette.primary} /> : error && !canManage ? <Message title="Location unavailable" detail={error} /> : !canManage ? <Message title="Access unavailable" detail="Ask the business owner for location management access." /> : <>
      <Text style={styles.label}>Location name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Main Warehouse" placeholderTextColor={palette.muted} maxLength={160} />
      <Text style={styles.label}>Type</Text>
      <View style={styles.typeRow}>{(['shop', 'warehouse'] as const).map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: type === option }} onPress={() => setType(option)} style={[styles.typeButton, type === option && styles.typeSelected]}><Text style={styles.typeText}>{option === 'shop' ? 'Shop' : 'Warehouse'}</Text></Pressable>)}</View>
      <Text style={styles.label}>Address (optional)</Text>
      <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Area, city" placeholderTextColor={palette.muted} maxLength={255} />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Action label={busy ? 'Saving…' : 'Save location'} disabled={busy} onPress={() => void save()} />
    </>}
  </Page>;
}

const pendingCopy = {
  'location-stock': ['Location Stock', 'Product balances will appear after the Products app is connected.'],
  movements: ['Movements', 'Stock movement history will appear after the Products app is connected.'],
  transfer: ['Transfer Stock', 'Transfers require products and recorded balances.'],
  adjustment: ['Adjust Stock', 'Adjustments require products and recorded balances.'],
  waste: ['Record Waste', 'Waste records require products and recorded balances.'],
} as const;

export function PendingStockScreen({ kind }: { kind: keyof typeof pendingCopy }) {
  const { state, loading, error, refresh } = useLocation();
  const [title, detail] = pendingCopy[kind];
  return <Page title={title} subtitle={state?.location.name}>
    {loading ? <ActivityIndicator color={palette.primary} /> : error ? <Message title="Location unavailable" detail={error} retry={() => void refresh()} /> : <>
      <Message title={kind === 'location-stock' || kind === 'movements' ? 'No stock records yet' : 'This action is not available yet'} detail={detail} />
      {kind !== 'location-stock' && kind !== 'movements' && <Action label="Confirm" disabled onPress={() => {}} />}
    </>}
  </Page>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 560 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, marginTop: 8, marginBottom: 20 },
  backText: { color: palette.primary, fontSize: 15, fontWeight: '700' },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.7, marginBottom: 7 },
  title: { color: palette.ink, fontSize: 28, fontWeight: '700' },
  subtitle: { color: palette.secondary, fontSize: 14, marginTop: 5 },
  body: { gap: 11, marginTop: 26 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: spacing.lg, gap: 8, ...elevation.card },
  locationCard: { flexDirection: 'row', alignItems: 'center', minHeight: 88, gap: 14 },
  icon: { width: 50, height: 50, borderRadius: 15, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  muted: { color: palette.secondary, fontSize: 13, lineHeight: 20 },
  badge: { color: palette.primary, fontSize: 11, fontWeight: '700', marginTop: 3 },
  action: { minHeight: 52, backgroundColor: palette.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 15 },
  actionSecondary: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  actionDisabled: { backgroundColor: '#DDE5E1' },
  actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  actionTextSecondary: { color: palette.primary },
  disabledText: { color: palette.muted },
  detailActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailAction: { width: '48%', minHeight: 54, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 8 },
  detailActionDanger: { borderColor: '#F1D5D1', backgroundColor: '#FFF8F7' },
  detailActionDisabled: { opacity: 0.55 },
  detailActionIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  detailActionText: { color: palette.ink, fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  detailActionDangerText: { color: palette.rose },
  pressed: { opacity: 0.76 },
  section: { color: palette.ink, fontSize: 17, fontWeight: '700', marginTop: 17 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, minHeight: 36, alignItems: 'center' },
  infoLabel: { color: palette.muted, fontSize: 13 },
  infoValue: { color: palette.ink, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  label: { color: palette.ink, fontSize: 13, fontWeight: '700', marginTop: 4 },
  input: { fontFamily: appFontFamily, color: palette.ink, fontSize: 15, minHeight: 52, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: 15, backgroundColor: palette.surface },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeButton: { flex: 1, minHeight: 52, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  typeSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  typeText: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  error: { color: '#A62925', fontSize: 13 },
  textButton: { minHeight: 44, justifyContent: 'center' },
  link: { color: palette.primary, fontSize: 14, fontWeight: '700' },
});
