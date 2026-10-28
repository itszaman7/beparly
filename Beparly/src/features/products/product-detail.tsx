import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from 'tamagui/toast';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { PressScale } from '@/components/motion';
import { appFontFamily, elevation, palette, radius, spacing, typography } from '@/constants/design-system';
import { auditDetails, auditTitle } from '@/features/audit/audit-format';
import { useAuth } from '@/features/auth/auth-context';
import { cacheConfirmedStock } from '@/features/products/product-outbox';
import { formatBdt, validDecimal } from '@/features/products/product-rules';
import { api, type AuditEvent, type Category, type Product, type Variant, type ProductUnit, type StockBatch, type StockLocation, type StockSummary } from '@/services/api';

const quantity = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const trackingLabel = { simple: 'Simple stock', batch: 'Batch tracking', expiry: 'Batch + expiry' };

function HelpButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`About ${label}`} onPress={onPress} style={styles.helpButton}>
    <AppSymbol name="info" size={21} color={palette.secondary} />
  </Pressable>;
}

export function Section({ icon, title, help, onHelp, children }: { icon: AppSymbolName; title: string; help?: string; onHelp: (help: { title: string; message: string }) => void; children: React.ReactNode }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeading}><AppSymbol name={icon} size={20} color={palette.primaryDeep} /><Text style={styles.sectionTitle}>{title}</Text></View>
      {help && <HelpButton label={title} onPress={() => onHelp({ title, message: help })} />}
    </View>
    <View style={styles.sectionBody}>{children}</View>
  </View>;
}

export function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <View style={[styles.info, wide && styles.infoWide]}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue} selectable>{value}</Text></View>;
}

export function NavAction({ icon, label, onPress, danger = false, disabled = false }: { icon: AppSymbolName; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.navAction, disabled && styles.disabled]}>
    <AppSymbol name={icon} size={20} color={danger ? palette.rose : palette.primaryDeep} />
    <Text style={[styles.navActionText, danger && { color: palette.rose }]}>{label}</Text>
    <AppSymbol name="chevron" size={19} color={palette.muted} />
  </Pressable>;
}

type ActionTone = 'teal' | 'blue' | 'purple' | 'amber' | 'rose';
const actionColors = {
  teal: [palette.primarySoft, palette.primaryDeep], blue: [palette.blueSoft, palette.blue],
  purple: [palette.purpleSoft, palette.purple], amber: [palette.amberSoft, palette.amber],
  rose: [palette.roseSoft, palette.rose],
} as const;
export function ActionTile({ icon, label, tone, onPress, disabled = false }: { icon: AppSymbolName; label: string; tone: ActionTone; onPress: () => void; disabled?: boolean }) {
  const [backgroundColor, color] = actionColors[tone];
  return <PressScale accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.actionTile, disabled && styles.disabled]}>
    <View style={styles.actionCell}>
      <View style={[styles.actionIcon, { backgroundColor }]}><AppSymbol name={icon} size={25} color={color} /></View>
      <Text style={styles.actionTileText} numberOfLines={2}>{label}</Text>
    </View>
  </PressScale>;
}

export function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token;
  const businessId = session?.account?.business.id;
  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<{ title: string; message: string } | null>(null);
  const [addingUnit, setAddingUnit] = useState(false);
  const [unitName, setUnitName] = useState('');
  const [unitFactor, setUnitFactor] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const load = useCallback(async () => {
    if (!token || !businessId || !id) return;
    setLoading(true);
    try {
      const result = await api.product(token, businessId, id);
      setProduct(result.product);
      setVariants(result.variants ?? []);
      setStock(result.stock);
      if (result.product.product_type === 'simple') for (const location of result.stock.locations) {
        await cacheConfirmedStock(businessId, id, undefined, location.id, undefined, location.quantity);
      }
      setError('');
      const [categoryResult, locationResult, unitResult, auditResult, batchResult] = await Promise.allSettled([
        api.categories(token, businessId), api.locations(token, businessId),
        result.product.product_type === 'simple' ? api.productUnits(token, businessId, id) : Promise.resolve({ units: [] as ProductUnit[] }),
        api.auditEvents(token, businessId, { productId: id }),
        result.product.product_type === 'variant' || result.product.tracking_mode === 'simple' ? Promise.resolve({ batches: [] as StockBatch[] }) : api.productBatches(token, businessId, id),
      ]);
      if (categoryResult.status === 'fulfilled') setCategories(categoryResult.value.categories);
      if (locationResult.status === 'fulfilled') setLocations(locationResult.value.locations);
      if (unitResult.status === 'fulfilled') setUnits(unitResult.value.units);
      if (auditResult.status === 'fulfilled') setEvents(auditResult.value.events);
      if (batchResult.status === 'fulfilled') {
        setBatches(batchResult.value.batches);
        if (result.product.product_type === 'simple') for (const batch of batchResult.value.batches) if (batch.location_id !== null) {
          await cacheConfirmedStock(businessId, id, undefined, batch.location_id, batch.id, batch.physical);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load product.');
      toast.error('Could not load product.');
    } finally { setLoading(false); }
  }, [token, businessId, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const categoryPath = (() => {
    if (!product?.category) return 'Uncategorized';
    const byId = new Map(categories.map((item) => [item.id, item]));
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null = product.category;
    while (current && byId.has(current) && !seen.has(current)) {
      const category: Category = byId.get(current)!;
      names.unshift(category.name);
      seen.add(current);
      current = category.parent;
    }
    return names.join(' › ') || 'Uncategorized';
  })();

  function stockRoute(kind: 'adjustment' | 'waste' | 'transfer') {
    const locationId = locations.find((item) => item.is_default)?.id ?? stock?.locations[0]?.id;
    if (!locationId) { toast.error('Add a stock location first.'); return; }
    router.push({ pathname: `/stock/[id]/${kind}`, params: { id: String(locationId), productId: id } });
  }

  async function deactivate() {
    if (!token || !businessId || !id || !product || busy) return;
    setBusy(true);
    try {
      setProduct((await api.updateProduct(token, businessId, id, { is_active: !product.is_active })).product);
      toast.success(product.is_active ? 'Product deactivated.' : 'Product reactivated.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update product.'); }
    finally { setBusy(false); }
  }

  async function addUnit() {
    if (!token || !businessId || !id || !unitName.trim() || !validDecimal(unitFactor, 3) || Number(unitFactor) <= 0 || !validDecimal(unitPrice, 2, true)) {
      toast.error('Enter a package name, positive quantity and valid optional price.'); return;
    }
    setBusy(true);
    try {
      const result = await api.createProductUnit(token, businessId, id, { name: unitName.trim(), factor: unitFactor, selling_price: unitPrice || null });
      setUnits((old) => [...old, result.unit]);
      setUnitName(''); setUnitFactor(''); setUnitPrice(''); setAddingUnit(false);
      toast.success('Packaging unit added.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not add package.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><AppSymbol name="back" size={24} color={palette.primary} /></Pressable>
      <Text style={styles.headerTitle}>Product details</Text>
    </View>
    {loading && !product ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.softText}>Loading product…</Text></View> : !product ?
      <View style={styles.center}><Text style={styles.softText}>{error || 'Product not found.'}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable></View> :
      <RefreshableScrollView onRefresh={load} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {product.image_url ? <Image source={{ uri: product.image_url }} style={styles.heroImage} resizeMode="cover" /> :
            <View style={styles.heroImage}><Text style={styles.heroInitials}>{product.name.trim().slice(0, 2).toUpperCase()}</Text><Text style={styles.photoCaption}>No photo</Text></View>}
          <View style={styles.heroCopy}>
            <View style={[styles.status, !product.is_active && styles.inactive]}><View style={[styles.statusDot, !product.is_active && styles.inactiveDot]} /><Text style={[styles.statusText, !product.is_active && styles.inactiveText]}>{product.is_active ? 'Active' : 'Inactive'}</Text></View>
            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.softText}>SKU  {product.sku}</Text>
          </View>
        </View>

        <View style={styles.actionGrid}>
          {product.product_type === 'simple' && <ActionTile icon="plus" label="Add stock" tone="teal" onPress={() => stockRoute('adjustment')} />}
          <ActionTile icon="edit" label="Edit product" tone="blue" onPress={() => router.push(`/products/${id}/edit` as Href)} />
          <ActionTile icon="duplicate" label="Duplicate" tone="purple" onPress={() => router.push({ pathname: '/products/new', params: { duplicateId: id } })} />
          <ActionTile icon="barcode" label="Print barcode label" tone="blue" onPress={() => router.push(`/products/${id}/barcode-label` as Href)} />
          {product.product_type === 'simple' && <>
            <ActionTile icon="transfer" label="Transfer" tone="blue" onPress={() => stockRoute('transfer')} />
            <ActionTile icon="waste" label="Waste" tone="amber" onPress={() => stockRoute('waste')} />
          </>}
          <ActionTile icon={product.is_active ? 'deactivate' : 'activate'} label={product.is_active ? 'Deactivate' : 'Reactivate'} tone={product.is_active ? 'rose' : 'teal'} onPress={() => void deactivate()} disabled={busy} />
        </View>

        {product.product_type === 'variant' ? <>
          <Section icon="products" title="Product overview" onHelp={setHelp} help="This is the shared product. Each variant has its own attributes, prices and stock.">
            <View style={styles.infoGrid}>
              <Info label="Category" value={categoryPath} wide />
              <Info label="Variants" value={String(variants.length)} />
              {product.barcode ? <Info label="Product barcode" value={product.barcode} /> : null}
              {Object.entries(product.specifications ?? {}).map(([label, value]) => <Info key={label} label={label} value={value} />)}
            </View>
            {product.description ? <View style={styles.description}><Text style={styles.infoLabel}>Description</Text><Text style={styles.descriptionText}>{product.description}</Text></View> : null}
          </Section>
          <Section icon="price" title="Prices" onHelp={setHelp} help="Each variant has its own buying, selling and optional wholesale price.">
            <View style={styles.infoGrid}><Info label="Selling price from" value={formatBdt(product.retail_price)} /></View>
          </Section>
          <Section icon="products" title="Variants" onHelp={setHelp} help="Open a variant to see its prices, stock by location, batches, packaging and history.">
            {variants.length ? variants.map((variant) => <Pressable key={variant.id} accessibilityRole="button" onPress={() => router.push(`/products/${id}/variants/${variant.id}` as Href)} style={styles.simpleRow}>
              <View style={{ flex: 1 }}><Text style={styles.rowName}>{variant.label}</Text><Text style={styles.softText}>SKU {variant.sku} · {formatBdt(variant.retail_price)} · {variant.base_unit}</Text></View>
              <AppSymbol name="chevron" size={18} color={palette.primaryDeep} />
            </Pressable>) : <Text style={styles.softText}>No variants added yet.</Text>}
          </Section>
          {stock && <Section icon="stock" title="Inventory snapshot" onHelp={setHelp} help="Stock is grouped by unit. Quantities with different base units cannot be added together.">
            {stock.stock_by_unit?.length ? stock.stock_by_unit.map((item) => <View key={item.unit} style={styles.simpleRow}>
              <Text style={styles.rowName}>{item.unit}</Text><View><Text style={styles.rowValue}>{quantity(item.quantity)} sellable</Text>
                {item.physical && <Text style={styles.softText}>{quantity(item.physical)} physical</Text>}</View>
            </View>) : <Text style={styles.softText}>No stock recorded yet.</Text>}
            <View style={styles.infoGrid}><Info label="Inventory value" value={formatBdt(stock.inventory_value)} /></View>
          </Section>}
          {stock && <Section icon="location" title="Stock by location" onHelp={setHelp} help="Location totals are shown when all variants share one base unit. Open a variant for its own locations.">
            {stock.locations?.length ? stock.locations.map((location) => <View key={location.id} style={styles.simpleRow}>
              <Text style={styles.rowName}>{location.name}</Text><Text style={styles.rowValue}>{quantity(location.quantity)} {variants[0]?.base_unit}</Text>
            </View>) : <Text style={styles.softText}>Open a variant to see stock at each location.</Text>}
          </Section>}
          <Section icon="movements" title="Activity" onHelp={setHelp} help="Catalog and stock changes are recorded with their actor and time.">
            {events.length ? <>{events.slice(0, 5).map((event) => <View key={event.id} style={styles.activityRow}>
              <View style={styles.activityDot} /><View style={{ flex: 1 }}><Text style={styles.rowName}>{auditTitle(event)}</Text>
                <Text style={styles.softText}>{auditDetails(event)}</Text><Text style={styles.activityDate}>{event.actor} · {new Date(event.created_at).toLocaleString()}</Text></View>
            </View>)}<Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/stock/audit', params: { productId: id } })} style={styles.inlineAction}><Text style={styles.link}>View full history</Text><AppSymbol name="chevron" size={18} color={palette.primaryDeep} /></Pressable></> : <Text style={styles.softText}>No activity recorded yet.</Text>}
          </Section>
        </> : <>
        <Section icon="products" title="Product overview" onHelp={setHelp}>
          <View style={styles.infoGrid}>
            <Info label="Category" value={categoryPath} wide />
            <Info label="Stock counted in" value={product.base_unit} />
            <Info label="Tracking" value={trackingLabel[product.tracking_mode]} />
            {product.barcode ? <Info label="Barcode" value={product.barcode} wide /> : null}
            {Object.entries(product.specifications ?? {}).map(([label, value]) => <Info key={label} label={label} value={value} />)}
          </View>
          {product.description ? <View style={styles.description}><Text style={styles.infoLabel}>Description</Text><Text style={styles.descriptionText}>{product.description}</Text></View> : null}
        </Section>

        <Section icon="price" title="Prices" onHelp={setHelp} help="These are your current product prices. Buying price is the default for new stock entries; past stock keeps its recorded cost.">
          <View style={styles.infoGrid}>
            <Info label="Selling price" value={formatBdt(product.retail_price)} />
            <Info label="Buying price" value={formatBdt(product.purchase_price)} />
            {product.wholesale_price !== null ? <Info label="Wholesale price" value={formatBdt(product.wholesale_price)} /> : null}
          </View>
        </Section>

        {stock && <Section icon="stock" title="Inventory snapshot" onHelp={setHelp} help="Physical stock is everything still on hand. Sellable stock excludes expired batches. These figures include all your shops and warehouses.">
          <View style={styles.metricGrid}>
            <View style={styles.metric}><Text style={styles.metricLabel}>Sellable</Text><Text style={styles.metricValue}>{quantity(stock.sellable)}</Text><Text style={styles.metricUnit}>{product.base_unit}</Text></View>
            <View style={styles.metric}><Text style={styles.metricLabel}>Physical</Text><Text style={styles.metricValue}>{quantity(stock.physical)}</Text><Text style={styles.metricUnit}>{product.base_unit}</Text></View>
            {product.tracking_mode === 'expiry' && <>
              <View style={[styles.metric, Number(stock.expired) > 0 && styles.warningMetric]}><Text style={styles.metricLabel}>Expired</Text><Text style={styles.metricValue}>{quantity(stock.expired)}</Text><Text style={styles.metricUnit}>{product.base_unit}</Text></View>
              <View style={styles.metric}><Text style={styles.metricLabel}>Expiring soon</Text><Text style={styles.metricValue}>{quantity(stock.expiring_soon)}</Text><Text style={styles.metricUnit}>{product.base_unit}</Text></View>
            </>}
          </View>
          <View style={styles.thresholdRow}><AppSymbol name="warning" size={18} color={Number(stock.sellable) <= Number(product.minimum_stock) ? palette.amber : palette.secondary} /><Text style={styles.softText}>Low stock alert at {quantity(product.minimum_stock)} {product.base_unit}</Text></View>
        </Section>}

        {stock && <Section icon="location" title="Stock by location" onHelp={setHelp} help="These quantities are physically present at each shop or warehouse, including any expired stock.">
          {stock.locations.length ? stock.locations.map((location) => <View key={location.id} style={styles.simpleRow}><Text style={styles.rowName}>{location.name}</Text><Text style={styles.rowValue}>{quantity(location.quantity)} {product.base_unit}</Text></View>) :
            <Text style={styles.softText}>No stock recorded yet.</Text>}
        </Section>}

        <Section icon="package" title="Packaging" onHelp={setHelp} help="Packages let you buy or sell cartons, trays or bags while stock stays counted in the base unit.">
          <View style={styles.simpleRow}><Text style={styles.rowName}>Base unit</Text><Text style={styles.rowValue}>1 {product.base_unit}</Text></View>
          {units.filter((unit) => unit.is_active).map((unit) => <View key={unit.id} style={styles.packageRow}>
            <View style={{ flex: 1 }}><Text style={styles.rowName}>{unit.name}</Text><Text style={styles.softText}>1 {unit.name} = {quantity(unit.factor)} {product.base_unit}</Text></View>
            {unit.selling_price !== null && <Text style={styles.rowValue}>{formatBdt(unit.selling_price)}</Text>}
          </View>)}
          <Pressable accessibilityRole="button" onPress={() => setAddingUnit(true)} style={styles.inlineAction}><AppSymbol name="plus" size={20} color={palette.primaryDeep} /><Text style={styles.link}>Add packaging unit</Text></Pressable>
        </Section>

        {product.tracking_mode !== 'simple' && <Section icon="batch" title="Batches" onHelp={setHelp} help="A batch identifies a delivery or lot. Expired batches remain in physical stock until they are disposed of.">
          {batches.length ? batches.map((batch, index) => <View key={`${batch.id}-${batch.location_id}-${index}`} style={styles.batchRow}>
            <View style={{ flex: 1 }}><Text style={styles.rowName}>{batch.lot_code}</Text><Text style={styles.softText}>{batch.location || 'No location'}{batch.expires_on ? ` · Expires ${batch.expires_on}` : ''}</Text></View>
            <View style={styles.batchRight}><Text style={styles.rowValue}>{quantity(batch.physical)} {product.base_unit}</Text><Text style={[styles.batchStatus, batch.status !== 'ok' && { color: batch.status === 'expired' ? palette.rose : palette.amber }]}>{batch.status === 'ok' ? 'Sellable' : batch.status === 'expired' ? 'Expired' : 'Expiring soon'}</Text></View>
          </View>) : <Text style={styles.softText}>No batches recorded yet.</Text>}
        </Section>}

        <Section icon="movements" title="Activity" onHelp={setHelp} help="See who changed this product, its packaging, batches or stock, and when. Stock transfers show an entry for each location.">
          {events.length ? <>
            {events.slice(0, 5).map((event) => <View key={event.id} style={styles.activityRow}>
              <View style={styles.activityDot} />
              <View style={{ flex: 1 }}><Text style={styles.rowName}>{auditTitle(event)}</Text><Text style={styles.softText}>{auditDetails(event)}</Text>
                <Text style={styles.activityDate}>{event.actor} · {new Date(event.created_at).toLocaleString()}</Text></View>
            </View>)}
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/stock/audit', params: { productId: id } })} style={styles.inlineAction}><Text style={styles.link}>View full history</Text><AppSymbol name="chevron" size={18} color={palette.primaryDeep} /></Pressable>
          </> : <Text style={styles.softText}>No activity recorded yet.</Text>}
        </Section>

        </>}
      </RefreshableScrollView>}

    <Modal transparent visible={!!help} animationType="fade" onRequestClose={() => setHelp(null)}><Pressable style={styles.modalBackdrop} onPress={() => setHelp(null)}>
      <View style={styles.helpCard}><View style={styles.helpTitleRow}><AppSymbol name="info" size={22} color={palette.primaryDeep} /><Text style={styles.helpTitle}>{help?.title}</Text></View><Text style={styles.helpText}>{help?.message}</Text><Pressable accessibilityRole="button" onPress={() => setHelp(null)} style={styles.modalDone}><Text style={styles.link}>Got it</Text></Pressable></View>
    </Pressable></Modal>

    <Modal transparent visible={addingUnit} animationType="fade" onRequestClose={() => setAddingUnit(false)}><KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.unitCard} contentContainerStyle={styles.unitContent} keyboardShouldPersistTaps="handled"><View style={styles.modalHeader}><Text style={styles.helpTitle}>Add packaging unit</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setAddingUnit(false)} style={styles.close}><AppSymbol name="close" size={22} color={palette.secondary} /></Pressable></View>
        <Text style={styles.fieldLabel}>Package name *</Text><TextInput style={styles.input} value={unitName} onChangeText={setUnitName} placeholder="e.g. Tray" placeholderTextColor={palette.muted} />
        <Text style={styles.fieldLabel}>How many {product?.base_unit ?? 'units'}? *</Text><TextInput style={styles.input} value={unitFactor} onChangeText={setUnitFactor} keyboardType="decimal-pad" placeholder="e.g. 30" placeholderTextColor={palette.muted} />
        <Text style={styles.fieldLabel}>Selling price (optional)</Text><TextInput style={styles.input} value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="৳" placeholderTextColor={palette.muted} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void addUnit()} style={[styles.primaryAction, busy && styles.disabled]}><Text style={styles.primaryActionText}>{busy ? 'Saving…' : 'Save package'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  header: { minHeight: 64, width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, backgroundColor: palette.surface },
  back: { width: 44, height: 44, justifyContent: 'center' }, headerTitle: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, retry: { minHeight: 44, justifyContent: 'center' },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, gap: 14, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  heroImage: { width: 90, height: 90, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, heroInitials: { color: palette.primaryDeep, fontSize: 28, fontWeight: '700' }, photoCaption: { color: palette.primaryDeep, fontSize: 11, marginTop: 2 }, heroCopy: { flex: 1, alignItems: 'flex-start', gap: 6 },
  productName: { color: palette.ink, fontSize: 22, fontWeight: '700', lineHeight: 28 }, status: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: palette.primarySoft }, statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.primary }, statusText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' }, inactive: { backgroundColor: palette.border }, inactiveDot: { backgroundColor: palette.muted }, inactiveText: { color: palette.secondary },
  section: { overflow: 'hidden', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md }, sectionHeader: { minHeight: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: palette.border }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' }, helpButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, sectionBody: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }, info: { width: '50%', paddingRight: 10, gap: 5 }, infoWide: { width: '100%' }, infoLabel: { color: palette.secondary, fontSize: 12 }, infoValue: { color: palette.ink, fontSize: 15, fontWeight: '600', lineHeight: 21 }, description: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, gap: 5 }, descriptionText: { color: palette.ink, fontSize: 14, lineHeight: 21 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', flexGrow: 1, minHeight: 90, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface }, warningMetric: { backgroundColor: palette.roseSoft }, metricLabel: { color: palette.secondary, fontSize: 12 }, metricValue: { color: palette.ink, fontSize: 23, fontWeight: '700', marginTop: 4 }, metricUnit: { color: palette.secondary, fontSize: 12 }, thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  simpleRow: { minHeight: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: palette.border }, rowName: { flex: 1, color: palette.ink, fontSize: 14, fontWeight: '600' }, rowValue: { color: palette.ink, fontSize: 14, fontWeight: '600', textAlign: 'right' }, softText: { color: palette.secondary, fontSize: 13, lineHeight: 19 }, packageRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: palette.border }, inlineAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }, link: { color: palette.primaryDeep, fontSize: 14, fontWeight: '700' },
  batchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }, batchRight: { alignItems: 'flex-end', gap: 3 }, batchStatus: { color: palette.primaryDeep, fontSize: 12, fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }, activityDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.primary, marginTop: 5 }, activityDate: { color: palette.muted, fontSize: 11, marginTop: 4 }, activityQuantity: { color: palette.primaryDeep, fontSize: 14, fontWeight: '700' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, actionTile: { width: '22%' }, actionCell: { minHeight: 99, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, ...elevation.card }, actionIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, actionTileText: { color: palette.ink, fontSize: typography.action, fontWeight: '600', textAlign: 'center' },
  actions: { gap: 10, marginTop: 4 }, primaryAction: { minHeight: 54, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: radius.sm, backgroundColor: palette.primary }, primaryActionText: { color: palette.surface, fontSize: 16, fontWeight: '700' }, secondaryAction: { minHeight: 54, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.primary, backgroundColor: palette.surface }, secondaryActionText: { color: palette.primaryDeep, fontSize: 16, fontWeight: '700' }, moreActions: { marginTop: 4, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, overflow: 'hidden' }, navAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: palette.border }, navActionText: { flex: 1, color: palette.ink, fontSize: 14, fontWeight: '600' }, disabled: { opacity: 0.5 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(21,33,31,0.42)' }, helpCard: { width: '100%', maxWidth: 420, padding: 20, gap: 12, borderRadius: radius.md, backgroundColor: palette.surface }, helpTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, helpTitle: { color: palette.ink, fontSize: 18, fontWeight: '700' }, helpText: { color: palette.secondary, fontSize: 14, lineHeight: 21 }, modalDone: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 8 },
  unitCard: { width: '100%', maxWidth: 420, maxHeight: '85%', flexGrow: 0, borderRadius: radius.md, backgroundColor: palette.surface }, unitContent: { padding: 20, gap: 10 }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }, fieldLabel: { color: palette.ink, fontSize: 13, fontWeight: '600', marginTop: 4 }, input: { minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, color: palette.ink, fontFamily: appFontFamily, fontSize: 15 },
});
