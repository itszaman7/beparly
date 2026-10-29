import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';

import { AppSymbol, type symbols } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { Entrance, PressScale } from '@/components/motion';
import { appFontFamily, elevation, palette, radius, spacing, typography } from '@/constants/design-system';
import { TABLET_WIDTH } from '@/constants/responsive';
import { useAuth } from '@/features/auth/auth-context';
import { api, type LocationInput, type LocationMovement, type LocationOverview, type StockLocation } from '@/services/api';
import { formatBdt } from '@/features/products/product-rules';

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

function Page({ title, subtitle, children, floatingAction, root = false, onRefresh }: { title: string; subtitle?: string; children: React.ReactNode; floatingAction?: React.ReactNode; root?: boolean; onRefresh?: () => Promise<unknown> | void }) {
  const { width } = useWindowDimensions();
  const wideRoot = root && width >= TABLET_WIDTH;
  const keyboardVisible = useKeyboardVisible();
  const Scroller = onRefresh ? RefreshableScrollView : ScrollView;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={[styles.pageHeader, wideRoot && styles.widePageHeader]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace(root ? '/' : '/stock' as Href)} style={styles.back}>
        <AppSymbol name="back" size={24} color={palette.primary} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
    <Scroller onRefresh={onRefresh!} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll}>
      <View style={[styles.content, wideRoot && styles.wideContent]}>
        {subtitle && <Entrance><Text style={styles.subtitle}>{subtitle}</Text></Entrance>}
        <View style={styles.body}>{children}</View>
      </View>
    </Scroller>
    {floatingAction && !keyboardVisible && <View style={[styles.floatingWrap, wideRoot && styles.wideFloatingWrap]}>{floatingAction}</View>}
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
  return <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.detailAction, disabled && styles.detailActionDisabled]}>
    <View style={styles.detailActionCell}>
      <View style={[styles.detailActionIcon, { backgroundColor: iconBackground }]}><AppSymbol name={icon} size={24} color={iconColor} /></View>
      <Text style={styles.detailActionText} numberOfLines={2}>{label}</Text>
    </View>
  </PressScale>;
}

function LocationCard({ location }: { location: StockLocation }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={`Open ${location.name}`} onPress={() => router.push(`/stock/${location.id}` as Href)}
    style={styles.locationPress}><View style={[styles.card, styles.locationCard]}>
    <View style={[styles.icon, location.type === 'warehouse' && { backgroundColor: palette.purpleSoft }]}><AppSymbol name={location.type === 'warehouse' ? 'stock' : 'home'} color={location.type === 'warehouse' ? palette.purple : palette.primary} size={24} /></View>
    <View style={styles.locationCopy}>
      <Text style={styles.cardTitle}>{location.name}</Text>
      <Text style={styles.muted}>{location.type === 'warehouse' ? 'Warehouse' : 'Shop'}{location.address ? ` · ${location.address}` : ''}</Text>
      {(location.is_default || !location.is_active) && <View style={[styles.badge, !location.is_active && styles.inactiveBadge]}><Text style={[styles.badgeText, !location.is_active && styles.inactiveBadgeText]}>{location.is_default ? 'Default' : 'Inactive'}</Text></View>}
    </View>
    <AppSymbol name="chevron" size={19} color={palette.muted} />
  </View></PressScale>;
}

function LocationKpi({ label, value, icon, color, background, compact }: { label: string; value: number; icon: keyof typeof symbols; color: string; background: string; compact: boolean }) {
  return <View style={[styles.kpiCard, compact ? styles.kpiCardCompact : styles.kpiCardWide]}>
    <View style={[styles.kpiIcon, { backgroundColor: background }]}><AppSymbol name={icon} size={21} color={color} /></View>
    <View style={styles.kpiBottom}><Text style={styles.kpiLabel} numberOfLines={1} adjustsFontSizeToFit>{label}</Text><Text style={styles.kpiValue}>{value}</Text></View>
  </View>;
}

export function LocationsScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const locationType = type === 'shop' || type === 'warehouse' ? type : null;
  const { width } = useWindowDimensions();
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
  const shops = locations.filter((location) => location.type === 'shop').length;
  const warehouses = locations.filter((location) => location.type === 'warehouse').length;
  const inactive = locations.filter((location) => !location.is_active).length;
  const visibleLocations = locationType ? locations.filter((location) => location.type === locationType) : locations;
  const compactKpis = width < 480;
  return <Page title={locationType === 'shop' ? 'Shops' : locationType === 'warehouse' ? 'Warehouses' : 'My storage units'} root onRefresh={refresh} floatingAction={canManage && !loading && !error ?
    <PressScale accessibilityRole="button" accessibilityLabel="Add storage unit" onPress={() => router.push('/stock/new')} style={styles.floatingAdd}>
      <View style={styles.floatingFace}><AppSymbol name="plus" size={27} color={palette.surface} /></View>
    </PressScale> : null}>
    {loading ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.muted}>Loading storage units…</Text></View> :
      error ? <Message title="Storage units unavailable" detail={error} retry={() => void refresh()} /> : <>
        <View style={styles.kpiGrid}>
          <LocationKpi label="Total" value={locations.length} icon="stock" color={palette.primaryDeep} background={palette.primarySoft} compact={compactKpis} />
          <LocationKpi label="Shops" value={shops} icon="home" color={palette.blue} background={palette.blueSoft} compact={compactKpis} />
          <LocationKpi label="Warehouses" value={warehouses} icon="products" color={palette.purple} background={palette.purpleSoft} compact={compactKpis} />
          <LocationKpi label="Inactive" value={inactive} icon="deactivate" color={palette.rose} background={palette.roseSoft} compact={compactKpis} />
        </View>
        <View style={styles.sectionHeading}><Text style={styles.listTitle}>{locationType === 'shop' ? 'Shops' : locationType === 'warehouse' ? 'Warehouses' : 'Shops & warehouses'}</Text><Text style={styles.listCount}>{visibleLocations.length}</Text></View>
        {visibleLocations.length ? visibleLocations.map((location) => <LocationCard key={location.id} location={location} />) :
          <Message title={locationType ? `No ${locationType === 'shop' ? 'shops' : 'warehouses'} yet` : 'No storage units yet'} detail="Add a shop or warehouse to start tracking stock by location." />}
      </>}
  </Page>;
}

const trimQuantity = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

function InventoryCell({ value, width, strong = false }: { value: string; width: number; strong?: boolean }) {
  return <View style={[styles.inventoryCell, { width }]}><Text style={strong ? styles.inventoryStrong : styles.inventoryText}>{value}</Text></View>;
}

function InventoryCard({ item }: { item: LocationOverview['inventory'][number] }) {
  return <View style={styles.compactCard}><View style={styles.compactCardHeading}><View style={styles.compactProduct}><Text style={styles.compactCardName} numberOfLines={2}>{item.name}</Text><Text style={styles.compactSku}>{item.sku || 'No SKU'}</Text></View><Text style={styles.compactQuantity}>{trimQuantity(item.available_quantity)} {item.unit}</Text></View><View style={styles.compactDetails}><Detail label="Returning" value={item.returning_quantity ?? '—'} /><Detail label="Stock value" value={item.stock_value === null ? '—' : formatBdt(item.stock_value)} /><Detail label="Purchase cost" value={formatBdt(item.purchase_cost)} /><Detail label="Shortage" value={item.shortage_quantity ?? '—'} /></View></View>;
}

function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.compactDetail}><Text style={styles.compactDetailLabel}>{label}</Text><Text style={styles.compactDetailValue}>{value}</Text></View>; }

export function LocationDetailsScreen() {
  const { session } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const compactTable = viewportWidth < 600;
  const { state, loading, error, refresh, token, businessId, locationId, setError } = useLocation();
  const [busy, setBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [overview, setOverview] = useState<LocationOverview | null>(null);
  const [movements, setMovements] = useState<LocationMovement[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [dataError, setDataError] = useState('');
  const [dataLoading, setDataLoading] = useState(true);
  const requestId = useRef(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [inventoryHelpOpen, setInventoryHelpOpen] = useState(false);
  const location = state?.location;
  const loadOverview = useCallback(async () => {
    if (!token || !businessId || !Number.isSafeInteger(locationId) || locationId < 1) return;
    const currentRequest = ++requestId.current;
    setDataLoading(true);
    try {
      const [overviewResult, movementResult] = await Promise.all([
        api.locationOverview(token, businessId, locationId), api.locationRecentMovements(token, businessId, locationId, 1),
      ]);
      if (currentRequest !== requestId.current) return;
      setOverview(overviewResult); setMovements(movementResult.movements); setNextPage(movementResult.next_page); setDataError('');
    } catch (cause) { if (currentRequest === requestId.current) setDataError(cause instanceof Error ? cause.message : 'Could not load inventory.'); }
    finally { if (currentRequest === requestId.current) setDataLoading(false); }
  }, [token, businessId, locationId]);
  useFocusEffect(useCallback(() => { void loadOverview(); return () => { requestId.current += 1; }; }, [loadOverview]));
  async function viewMore() {
    if (!token || !businessId || !nextPage || moreBusy) return;
    setMoreBusy(true);
    try { const result = await api.locationRecentMovements(token, businessId, locationId, nextPage);
      setMovements((current) => [...current, ...result.movements.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextPage(result.next_page); setDataError(''); }
    catch (cause) { setDataError(cause instanceof Error ? cause.message : 'Could not load more logs.'); }
    finally { setMoreBusy(false); }
  }
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
  return <Page title={location?.name ?? 'Storage unit'} onRefresh={async () => { await Promise.all([refresh(), loadOverview()]); }}>
    {loading ? <ActivityIndicator color={palette.primary} /> : error && !location ? <Message title="Location unavailable" detail={error} retry={() => void refresh()} /> : location && <>
      <View style={styles.locationIdentity}>
        <View style={[styles.icon, location.type === 'warehouse' && { backgroundColor: palette.purpleSoft }]}><AppSymbol name={location.type === 'warehouse' ? 'stock' : 'home'} size={24} color={location.type === 'warehouse' ? palette.purple : palette.primary} /></View>
        <Text style={styles.identityType}>{location.type === 'warehouse' ? 'Warehouse' : 'Shop'}</Text>
        <View style={styles.identityStatus}><View style={[styles.statusDot, !location.is_active && styles.inactiveDot]} /><Text style={styles.identityStatusText}>{location.is_active ? 'Active' : 'Inactive'}</Text></View>
        {location.is_default && <View style={styles.defaultMark}><AppSymbol name="default" size={17} color={palette.amber} /><Text style={styles.defaultText}>Default</Text></View>}
      </View>
      {dataLoading && !overview ? <View style={styles.loading}><ActivityIndicator color={palette.primary} /><Text style={styles.muted}>Loading inventory…</Text></View> :
        overview && <View style={styles.locationKpiGrid}>
          <View style={styles.locationKpi}><View style={[styles.kpiIcon, { backgroundColor: palette.primarySoft }]}><AppSymbol name="price" size={21} color={palette.primaryDeep} /></View><Text style={styles.locationKpiValue}>{formatBdt(overview.summary.inventory_value)}</Text><Text style={styles.locationKpiLabel}>Inventory cost value</Text></View>
          <View style={styles.locationKpi}><View style={[styles.kpiIcon, { backgroundColor: palette.blueSoft }]}><AppSymbol name="products" size={21} color={palette.blue} /></View><Text style={styles.locationKpiValue}>{overview.summary.sku_count}</Text><Text style={styles.locationKpiLabel}>SKUs</Text></View>
          <View style={styles.locationKpi}><View style={[styles.kpiIcon, { backgroundColor: palette.amberSoft }]}><AppSymbol name="warning" size={21} color={palette.amber} /></View><Text style={styles.locationKpiValue}>{overview.summary.low_stock_count}</Text><Text style={styles.locationKpiLabel}>Low stock variants</Text></View>
          <View style={styles.locationKpi}><View style={[styles.kpiIcon, { backgroundColor: palette.roseSoft }]}><AppSymbol name="batch" size={21} color={palette.rose} /></View><Text style={styles.locationKpiValue}>{overview.summary.expiring_soon_count}</Text><Text style={styles.locationKpiLabel}>Nearing expiry</Text></View>
        </View>}
      <View style={styles.detailActionGrid}>
        {(session?.account?.role === 'owner' || session?.account?.can_manage_purchases) &&
          <DetailAction label="Purchase from Supplier" icon="purchase" color={palette.orange} background={palette.orangeSoft}
            onPress={() => router.push(`/purchases/new?locationId=${locationId}` as Href)} />}
        {(['transfer', 'adjustment', 'waste'] as const).map((action) =>
          <DetailAction key={action} icon={action} label={action === 'transfer' ? 'Transfer stock' : action === 'adjustment' ? 'Adjust stock' : 'Record waste'}
            color={action === 'transfer' ? palette.orange : action === 'adjustment' ? palette.amber : palette.rose}
            background={action === 'transfer' ? palette.orangeSoft : action === 'adjustment' ? palette.amberSoft : palette.roseSoft}
            onPress={() => router.push({ pathname: `/stock/[id]/${action}`, params: { id: String(locationId) } })} />)}
      </View>
      {state.canManage && <>
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
      {overview && <View style={styles.inventoryPanel}>
          <View style={styles.inventoryHeading}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${location.type === 'warehouse' ? 'Warehouse' : 'Shop'} inventory`} accessibilityState={{ expanded: inventoryOpen }} onPress={() => setInventoryOpen(!inventoryOpen)} style={styles.inventoryToggle}>
              <AppSymbol name="products" size={20} color={palette.primaryDeep} /><Text style={styles.inventoryTitle}>{location.type === 'warehouse' ? 'Warehouse' : 'Shop'} inventory</Text><Text style={styles.listCount}>{overview.inventory.length}</Text>
              <AppSymbol name={inventoryOpen ? 'up' : 'down'} size={22} color={palette.secondary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="About inventory columns" accessibilityState={{ expanded: inventoryHelpOpen }} onPress={() => setInventoryHelpOpen(!inventoryHelpOpen)} style={styles.inventoryHelpButton}><AppSymbol name="info" size={21} color={palette.secondary} /></Pressable>
          </View>
          {inventoryHelpOpen && <View style={styles.inventoryHelp}><Text style={styles.inventoryHelpText}>{compactTable ? 'Mobile view presents every stock field in a compact card. “—” means unavailable.' : 'Swipe sideways for all columns. Stock value uses the current selling price; purchase cost uses remaining cost layers. “—” means unavailable.'}</Text></View>}
          {inventoryOpen && (overview.inventory.length ? <>
            {compactTable ? <View style={styles.compactCards}>{overview.inventory.map((item) => <InventoryCard key={item.variant_id} item={item} />)}</View> : <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles.inventoryScroll} contentContainerStyle={styles.inventoryTable}><View style={styles.inventoryTableContent}><View style={styles.inventoryHeaderRow}><InventoryCell value="SKU" width={110} strong /><InventoryCell value="Product name" width={250} strong /><InventoryCell value="Available qty" width={145} strong /><InventoryCell value="Returning stock" width={140} strong /><InventoryCell value="Stock value" width={150} strong /><InventoryCell value="Purchase cost" width={150} strong /><InventoryCell value="Shortage qty" width={130} strong /></View>{overview.inventory.map((item) => <View key={item.variant_id} style={styles.inventoryRow}><InventoryCell value={item.sku} width={110} strong /><InventoryCell value={item.name} width={250} /><InventoryCell value={`${trimQuantity(item.available_quantity)} ${item.unit}`} width={145} /><InventoryCell value={item.returning_quantity ?? '—'} width={140} /><InventoryCell value={item.stock_value === null ? '—' : formatBdt(item.stock_value)} width={150} /><InventoryCell value={formatBdt(item.purchase_cost)} width={150} /><InventoryCell value={item.shortage_quantity ?? '—'} width={130} /></View>)}</View></ScrollView>}
          </> : <Text style={styles.emptyInventory}>No products stocked here yet.</Text>)}
        </View>}
      {!!error && <Message title="Could not update storage unit" detail={error} />}
      <View style={styles.logsPanel}><Text style={styles.logsTitle}>Recent stock logs</Text>
        {movements.length ? movements.map((movement) => <View key={movement.id} style={styles.logRow}>
          <View style={styles.logIcon}><AppSymbol name="movements" size={19} color={palette.blue} /></View>
          <View style={styles.logCopy}><Text style={styles.logType}>{movement.type.replace(/_/g, ' ')}</Text>
            <Text style={styles.logName}>{movement.name}{movement.variant_label ? ` · ${movement.variant_label}` : ''}</Text>
            <Text style={styles.logDate}>{movement.sku} · {new Date(movement.created_at).toLocaleString()}</Text></View>
          <Text style={styles.logQuantity}>{Number(movement.quantity_change) > 0 ? '+' : ''}{trimQuantity(movement.quantity_change)} {movement.unit}</Text>
        </View>) : !dataLoading && !dataError && <Text style={styles.emptyInventory}>No stock logs yet.</Text>}
        {nextPage && <Pressable accessibilityRole="button" disabled={moreBusy} onPress={() => void viewMore()} style={styles.moreLogs}><Text style={styles.moreLogsText}>{moreBusy ? 'Loading…' : 'View 10 more logs'}</Text><AppSymbol name="down" size={18} color={palette.primaryDeep} /></Pressable>}
      </View>
      {!!dataError && <Message title="Inventory unavailable" detail={dataError} retry={() => void loadOverview()} />}
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
    if (type === 'shop' && !address.trim()) { setError('Add the shop billing address. Sales cannot be completed without it.'); return; }
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
      <Text style={styles.label}>Address {type === 'shop' ? '*' : '(optional)'}</Text>
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
  return <Page title={title} subtitle={state?.location.name} onRefresh={refresh}>
    {loading ? <ActivityIndicator color={palette.primary} /> : error ? <Message title="Location unavailable" detail={error} retry={() => void refresh()} /> : <>
      <Message title={kind === 'location-stock' || kind === 'movements' ? 'No stock records yet' : 'This action is not available yet'} detail={detail} />
      {kind !== 'location-stock' && kind !== 'movements' && <Action label="Confirm" disabled onPress={() => {}} />}
    </>}
  </Page>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  pageHeader: { minHeight: 76, width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg, backgroundColor: palette.surface },
  widePageHeader: { maxWidth: 1100 },
  headerTitle: { color: palette.ink, fontSize: 22, fontWeight: '700' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: 112 },
  content: { width: '100%', maxWidth: 560 },
  wideContent: { maxWidth: 1040 },
  back: { width: 44, height: 44, justifyContent: 'center' },
  subtitle: { color: palette.secondary, fontSize: 14, marginTop: 5 },
  body: { gap: 12, marginTop: 20 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiCard: { minHeight: 78, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, ...elevation.card },
  kpiCardCompact: { width: '48%' },
  kpiCardWide: { width: '23%' },
  kpiIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  kpiBottom: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  kpiValue: { color: palette.ink, fontSize: 21, fontWeight: '700' },
  kpiLabel: { flex: 1, color: palette.secondary, fontSize: 13, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: 2 },
  listTitle: { color: palette.ink, fontSize: typography.section, fontWeight: '700' },
  listCount: { color: palette.secondary, fontSize: typography.caption, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: palette.border },
  floatingWrap: { position: 'absolute', bottom: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 560, paddingHorizontal: spacing.lg, alignItems: 'flex-end' },
  wideFloatingWrap: { maxWidth: 1040 },
  floatingAdd: { width: 56, height: 56 },
  floatingFace: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primary, ...elevation.hero },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, padding: spacing.lg, gap: 8, ...elevation.card },
  locationPress: { width: '100%' },
  locationCard: { flexDirection: 'row', alignItems: 'center', minHeight: 94, gap: 14 },
  locationCopy: { flex: 1, alignItems: 'flex-start', gap: 4 },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  muted: { color: palette.secondary, fontSize: 13, lineHeight: 20 },
  badge: { borderRadius: 10, backgroundColor: palette.primarySoft, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: palette.primaryDeep, fontSize: 11, fontWeight: '700' },
  inactiveBadge: { backgroundColor: palette.border },
  inactiveBadgeText: { color: palette.secondary },
  action: { minHeight: 52, backgroundColor: palette.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 15 },
  actionSecondary: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  actionDisabled: { backgroundColor: '#DDE5E1' },
  actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  actionTextSecondary: { color: palette.primary },
  disabledText: { color: palette.muted },
  locationIdentity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 2 },
  identityType: { color: palette.ink, fontSize: 16, fontWeight: '700', marginRight: 4 },
  identityStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: palette.primarySoft },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.primary, shadowColor: palette.primary, shadowOpacity: 0.7, shadowRadius: 5, elevation: 3 },
  inactiveDot: { backgroundColor: palette.muted, shadowOpacity: 0, elevation: 0 },
  identityStatusText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' },
  defaultMark: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: palette.amberSoft },
  defaultText: { color: palette.amber, fontSize: 12, fontWeight: '700' },
  locationKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  locationKpi: { width: '47%', flexGrow: 1, minHeight: 112, gap: 4, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, ...elevation.card },
  locationKpiValue: { color: palette.ink, fontSize: 21, fontWeight: '700' },
  locationKpiLabel: { color: palette.secondary, fontSize: 12, fontWeight: '600' },
  inventoryPanel: { overflow: 'hidden', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, ...elevation.card },
  inventoryHeading: { minHeight: 60, paddingLeft: 14, paddingRight: 6, flexDirection: 'row', alignItems: 'center' },
  inventoryToggle: { flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inventoryTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  inventoryHelpButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  inventoryHelp: { marginHorizontal: 14, marginBottom: 12, padding: 12, borderRadius: radius.sm, backgroundColor: palette.blueSoft },
  inventoryHelpText: { color: palette.secondary, fontSize: 12, lineHeight: 18 },
  inventoryScroll: { width: '100%', flexGrow: 0 },
  inventoryTable: { paddingBottom: 4 }, inventoryTableContent: { minWidth: 1075 },
  compactInventoryTable: { width: '100%' }, compactInventoryHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.primarySoft, paddingHorizontal: 10, gap: 8 }, compactInventoryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 10, gap: 8 }, compactProductColumn: { flex: 1, minWidth: 0, textAlign: 'left' }, compactNumberColumn: { width: 92, textAlign: 'right' }, compactSku: { color: palette.muted, fontSize: 10, marginTop: 2 },
  compactCards: { gap: 8, padding: 10 }, compactCard: { padding: 12, gap: 10, borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, compactCardHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }, compactProduct: { flex: 1, minWidth: 0 }, compactCardName: { color: palette.ink, fontSize: 13, lineHeight: 18, fontWeight: '700' }, compactQuantity: { color: palette.primaryDeep, fontSize: 13, fontWeight: '800', textAlign: 'right' }, compactDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: palette.border }, compactDetail: { width: '48%', gap: 2 }, compactDetailLabel: { color: palette.muted, fontSize: 10 }, compactDetailValue: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  inventoryHeaderRow: { flexDirection: 'row', minHeight: 48, alignItems: 'center', backgroundColor: palette.primarySoft },
  inventoryRow: { flexDirection: 'row', minHeight: 58, alignItems: 'center', borderTopWidth: 1, borderTopColor: palette.border },
  inventoryCell: { paddingHorizontal: 10, paddingVertical: 8 },
  inventoryStrong: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  inventoryText: { color: palette.ink, fontSize: 12, lineHeight: 18 },
  emptyInventory: { color: palette.secondary, fontSize: 13, lineHeight: 20, padding: 16 },
  logsPanel: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, paddingHorizontal: 14, ...elevation.card },
  logsTitle: { color: palette.ink, fontSize: 17, fontWeight: '700', paddingVertical: 16 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.border },
  logIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blueSoft },
  logCopy: { flex: 1, gap: 3 },
  logType: { color: palette.ink, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  logName: { color: palette.secondary, fontSize: 12 },
  logDate: { color: palette.muted, fontSize: 11 },
  logQuantity: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  moreLogs: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderTopWidth: 1, borderTopColor: palette.border },
  moreLogsText: { color: palette.primaryDeep, fontSize: 13, fontWeight: '700' },
  detailActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detailAction: { width: '22%' },
  detailActionCell: { minHeight: 99, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, ...elevation.card },
  detailActionDisabled: { opacity: 0.55 },
  detailActionIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  detailActionText: { color: palette.ink, fontSize: typography.action, fontWeight: '600', textAlign: 'center' },
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
