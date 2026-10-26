import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from 'tamagui/toast';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { ActionTile, Info, Section } from '@/features/products/product-detail';
import { cacheConfirmedStock } from '@/features/products/product-outbox';
import { formatBdt, validDecimal } from '@/features/products/product-rules';
import { api, type Category, type Product, type ProductMovement, type ProductUnit, type StockBatch, type StockSummary, type Variant } from '@/services/api';

const quantity = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const trackingLabel = { simple: 'Simple stock', batch: 'Batch tracking', expiry: 'Batch + expiry' };

export default function VariantDetailScreen() {
  const { id, variantId } = useLocalSearchParams<{ id: string; variantId: string }>();
  const { session } = useAuth(); const token = session?.token; const businessId = session?.account?.business.id;
  const [product, setProduct] = useState<Product | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null); const [stock, setStock] = useState<StockSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]); const [movements, setMovements] = useState<ProductMovement[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [unitName, setUnitName] = useState(''); const [factor, setFactor] = useState(''); const [unitPrice, setUnitPrice] = useState('');
  const [addingUnit, setAddingUnit] = useState(false); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({ buying: '', selling: '', wholesale: '', sku: '', barcode: '', minimum: '' });
  const [help, setHelp] = useState<{ title: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !businessId || !id || !variantId) return;
    setLoading(true);
    try {
      const [result, parent, categoryResult, batchResult, movementResult, unitResult] = await Promise.all([
        api.variant(token, businessId, id, variantId), api.product(token, businessId, id),
        api.categories(token, businessId), api.productBatches(token, businessId, id, variantId),
        api.productMovements(token, businessId, id, variantId), api.productUnits(token, businessId, id, variantId),
      ]);
      setVariant(result.variant); setStock(result.stock); setProduct(parent.product); setCategories(categoryResult.categories);
      setBatches(batchResult.batches); setMovements(movementResult.movements); setUnits(unitResult.units); setError('');
      for (const location of result.stock.locations) await cacheConfirmedStock(businessId, id, variantId, location.id, undefined, location.quantity);
      for (const batch of batchResult.batches) if (batch.location_id !== null)
        await cacheConfirmedStock(businessId, id, variantId, batch.location_id, batch.id, batch.physical);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load variant.'); }
    finally { setLoading(false); }
  }, [token, businessId, id, variantId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const categoryPath = (() => {
    if (!product?.category) return 'Uncategorized';
    const byId = new Map(categories.map((item) => [item.id, item])); const names: string[] = []; const seen = new Set<string>();
    let current: string | null = product.category;
    while (current && byId.has(current) && !seen.has(current)) {
      const item: Category = byId.get(current)!; names.unshift(item.name); seen.add(current); current = item.parent;
    }
    return names.join(' › ') || 'Uncategorized';
  })();

  async function action(kind: 'adjustment' | 'waste' | 'transfer') {
    if (!token || !businessId || !id || !variantId) return;
    try {
      const locations = (await api.locations(token, businessId)).locations;
      const location = locations.find((item) => item.is_default) ?? locations[0];
      if (!location) { toast.error('Add a stock location first.'); return; }
      router.push({ pathname: `/stock/[id]/${kind}`, params: { id: String(location.id), productId: id, variantId } });
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not load locations.'); }
  }

  async function addUnit() {
    if (!token || !businessId || !id || !variantId || !unitName.trim() || !validDecimal(factor, 3) || Number(factor) <= 0 || !validDecimal(unitPrice, 2, true)) {
      toast.error('Enter a package name, positive conversion and valid optional price.'); return;
    }
    setBusy(true);
    try {
      const result = await api.createProductUnit(token, businessId, id, { name: unitName.trim(), factor,
        selling_price: unitPrice.trim() || null, variant_id: variantId });
      setUnits((old) => [...old, result.unit]); setUnitName(''); setFactor(''); setUnitPrice(''); setAddingUnit(false);
      toast.success('Packaging unit added.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not add package.'); }
    finally { setBusy(false); }
  }

  function startEdit() {
    if (!variant) return;
    setEditValues({ buying: variant.purchase_price ?? '', selling: variant.retail_price ?? '',
      wholesale: variant.wholesale_price ?? '', sku: variant.sku, barcode: variant.barcode, minimum: variant.minimum_stock });
    setEditing(true);
  }
  async function saveVariant() {
    if (!token || !businessId || !id || !variantId || busy) return;
    if (![editValues.buying, editValues.selling, editValues.wholesale].every((value) => validDecimal(value, 2, true)) ||
      !validDecimal(editValues.minimum, 3)) { toast.error('Enter valid nonnegative prices and minimum stock.'); return; }
    setBusy(true);
    try {
      const result = await api.updateVariant(token, businessId, id, variantId, {
        purchase_price: editValues.buying || null, retail_price: editValues.selling || null,
        wholesale_price: editValues.wholesale || null, sku: editValues.sku.trim(),
        barcode: editValues.barcode.trim(), minimum_stock: editValues.minimum });
      setVariant(result.variant); setEditing(false); toast.success('Variant updated.');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update variant.'); }
    finally { setBusy(false); }
  }
  async function toggleActive() {
    if (!token || !businessId || !id || !variantId || !variant || busy) return;
    setBusy(true);
    try { const result = await api.updateVariant(token, businessId, id, variantId, { is_active: !variant.is_active });
      setVariant(result.variant); toast.success(result.variant.is_active ? 'Variant reactivated.' : 'Variant deactivated.'); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not update variant.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><AppSymbol name="back" size={24} color={palette.primary} /></Pressable>
      <Text style={styles.headerTitle}>Variant details</Text></View>
    {loading && !variant ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.soft}>Loading variant…</Text></View> : !variant || !stock || !product ?
      <View style={styles.center}><Text style={styles.soft}>{error || 'Variant not found.'}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Try again</Text></Pressable></View> :
      <RefreshableScrollView onRefresh={load} contentContainerStyle={styles.content}>
        <View style={styles.hero}>{product.image_url ? <Image source={{ uri: product.image_url }} style={styles.heroImage} resizeMode="cover" /> :
          <View style={styles.heroImage}><Text style={styles.initials}>{variant.label.slice(0, 2).toUpperCase()}</Text><Text style={styles.soft}>No photo</Text></View>}
          <View style={styles.heroCopy}><Text style={styles.status}>{variant.is_active ? '● Active' : '○ Inactive'}</Text>
            <Text style={styles.name}>{product.name}</Text><Text style={styles.variantLabel}>{variant.label}</Text>
            <Text style={styles.soft}>SKU {variant.sku}</Text></View></View>

        <View style={styles.actionGrid}>
          <ActionTile icon="plus" label="Add stock" tone="teal" onPress={() => void action('adjustment')} />
          <ActionTile icon="edit" label="Edit variant" tone="blue" onPress={startEdit} />
          <ActionTile icon="duplicate" label="Duplicate" tone="purple" onPress={() => router.push({ pathname: '/products/new', params: { duplicateId: id } })} />
          <ActionTile icon="transfer" label="Transfer" tone="blue" onPress={() => void action('transfer')} />
          <ActionTile icon="waste" label="Waste" tone="amber" onPress={() => void action('waste')} />
          <ActionTile icon={variant.is_active ? 'deactivate' : 'activate'} label={variant.is_active ? 'Deactivate' : 'Reactivate'} tone={variant.is_active ? 'rose' : 'teal'} onPress={() => void toggleActive()} disabled={busy} />
        </View>

        <Section icon="products" title="Product overview" onHelp={setHelp} help="The photo, product name, category and description are shared by all variants.">
          <View style={styles.grid}><Info label="Category" value={categoryPath} wide />
            <Info label="Stock counted in" value={variant.base_unit} /><Info label="Tracking" value={trackingLabel[variant.tracking_mode]} />
            {variant.barcode ? <Info label="Barcode" value={variant.barcode} wide /> : null}
            {Object.entries(variant.selections).map(([name, value]) => <Info key={name} label={name} value={value} />)}
            {Object.entries(product.specifications ?? {}).map(([name, value]) => <Info key={name} label={name} value={value} />)}
          </View>
          {product.description ? <View><Text style={styles.label}>Description</Text><Text style={styles.body}>{product.description}</Text></View> : null}
          <Pressable accessibilityRole="button" onPress={() => router.push(`/products/${id}` as Href)} style={styles.inlineAction}><Text style={styles.link}>View parent product</Text><AppSymbol name="chevron" size={18} color={palette.primaryDeep} /></Pressable>
        </Section>

        <Section icon="price" title="Prices" onHelp={setHelp} help="These are the current prices for this variant. Historical stock keeps its recorded cost.">
          <View style={styles.grid}><Info label="Selling price" value={formatBdt(variant.retail_price)} />
            <Info label="Buying price" value={formatBdt(variant.purchase_price)} />
            {variant.wholesale_price !== null ? <Info label="Wholesale price" value={formatBdt(variant.wholesale_price)} /> : null}</View>
        </Section>

        <Section icon="stock" title="Inventory snapshot" onHelp={setHelp} help="Sellable stock excludes expired batches. Inventory value uses the remaining cost layers.">
          <View style={styles.metricGrid}><Metric label="Sellable" value={quantity(stock.sellable)} unit={variant.base_unit} />
            <Metric label="Physical" value={quantity(stock.physical)} unit={variant.base_unit} />
            {variant.tracking_mode === 'expiry' && <><Metric label="Expired" value={quantity(stock.expired)} unit={variant.base_unit} />
              <Metric label="Expiring soon" value={quantity(stock.expiring_soon)} unit={variant.base_unit} /></>}</View>
          <View style={styles.grid}><Info label="Inventory value" value={formatBdt(stock.inventory_value)} />
            <Info label="Low stock alert" value={`${quantity(variant.minimum_stock)} ${variant.base_unit}`} /></View>
        </Section>

        <Section icon="location" title="Stock by location" onHelp={setHelp} help="These quantities are physically present at each shop or warehouse.">
          {stock.locations.length ? stock.locations.map((item) => <View key={item.id} style={styles.row}><Text style={styles.rowName}>{item.name}</Text><Text style={styles.rowValue}>{quantity(item.quantity)} {variant.base_unit}</Text></View>) : <Text style={styles.soft}>No stock recorded yet.</Text>}
        </Section>

        <Section icon="package" title="Packaging" onHelp={setHelp} help="Packages convert cartons, trays or bags into this variant's base stock unit.">
          <View style={styles.row}><Text style={styles.rowName}>Base unit</Text><Text style={styles.rowValue}>1 {variant.base_unit}</Text></View>
          {units.filter((item) => item.is_active).map((item) => <View key={item.id} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.soft}>1 {item.name} = {quantity(item.factor)} {variant.base_unit}</Text></View>
            {item.selling_price !== null && <Text style={styles.rowValue}>{formatBdt(item.selling_price)}</Text>}</View>)}
          <Pressable accessibilityRole="button" onPress={() => setAddingUnit(true)} style={styles.inlineAction}><AppSymbol name="plus" size={20} color={palette.primaryDeep} /><Text style={styles.link}>Add packaging unit</Text></Pressable>
        </Section>

        {variant.tracking_mode !== 'simple' && <Section icon="batch" title="Batches" onHelp={setHelp} help="Expired batches remain in physical stock until recorded as waste.">
          {batches.length ? batches.map((batch, index) => <View key={`${batch.id}-${batch.location_id}-${index}`} style={styles.row}>
            <View style={{ flex: 1 }}><Text style={styles.rowName}>{batch.lot_code}</Text><Text style={styles.soft}>{batch.location || 'No location'}{batch.expires_on ? ` · Expires ${batch.expires_on}` : ''}</Text></View>
            <View><Text style={styles.rowValue}>{quantity(batch.physical)} {variant.base_unit}</Text><Text style={styles.soft}>{batch.status === 'ok' ? 'Sellable' : batch.status === 'expired' ? 'Expired' : 'Expiring soon'}</Text></View>
          </View>) : <Text style={styles.soft}>No batches recorded yet.</Text>}
        </Section>}

        <Section icon="movements" title="Stock history" onHelp={setHelp} help="Posted movements are append-only and show the location and quantity change.">
          {movements.length ? movements.slice(0, 10).map((item) => <View key={item.id} style={styles.row}>
            <View style={{ flex: 1 }}><Text style={styles.rowName}>{item.type.replace(/_/g, ' ')}</Text><Text style={styles.soft}>{item.location}{item.batch ? ` · ${item.batch}` : ''} · {new Date(item.created_at).toLocaleString()}</Text></View>
            <Text style={styles.rowValue}>{quantity(item.quantity_change)} {variant.base_unit}</Text>
          </View>) : <Text style={styles.soft}>No stock movements yet.</Text>}
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/stock/audit', params: { productId: id } })} style={styles.inlineAction}><Text style={styles.link}>View product activity</Text><AppSymbol name="chevron" size={18} color={palette.primaryDeep} /></Pressable>
        </Section>

      </RefreshableScrollView>}

    <Modal transparent visible={!!help} animationType="fade" onRequestClose={() => setHelp(null)}><Pressable style={styles.backdrop} onPress={() => setHelp(null)}><View style={styles.helpCard}>
      <View style={styles.helpTitle}><AppSymbol name="info" size={21} color={palette.primaryDeep} /><Text style={styles.heading}>{help?.title}</Text></View><Text style={styles.body}>{help?.message}</Text>
      <Text style={styles.link}>Close</Text></View></Pressable></Modal>

    <Modal transparent visible={addingUnit} animationType="slide" onRequestClose={() => setAddingUnit(false)}><KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.unitCard}><View style={styles.helpTitle}><Text style={styles.heading}>Add packaging unit</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setAddingUnit(false)}><AppSymbol name="close" size={22} color={palette.secondary} /></Pressable></View>
        <Text style={styles.label}>Package name *</Text><TextInput style={styles.input} value={unitName} onChangeText={setUnitName} placeholder="Carton" placeholderTextColor={palette.muted} />
        <Text style={styles.label}>How many {variant?.base_unit ?? 'base units'}? *</Text><TextInput style={styles.input} value={factor} onChangeText={setFactor} keyboardType="decimal-pad" placeholder="12" placeholderTextColor={palette.muted} />
        <Text style={styles.label}>Selling price (৳, optional)</Text><TextInput style={styles.input} value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholderTextColor={palette.muted} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void addUnit()} style={styles.primaryAction}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Add package'}</Text></Pressable>
      </View></KeyboardAvoidingView></Modal>

    <Modal transparent visible={editing} animationType="slide" onRequestClose={() => setEditing(false)}><KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.unitCard}><View style={styles.helpTitle}><Text style={styles.heading}>Edit variant</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setEditing(false)}><AppSymbol name="close" size={22} color={palette.secondary} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editBody}>
          <EditField label="Buying price (৳)" value={editValues.buying} onChange={(buying) => setEditValues({ ...editValues, buying })} numeric />
          <EditField label="Selling price (৳)" value={editValues.selling} onChange={(selling) => setEditValues({ ...editValues, selling })} numeric />
          <EditField label="Wholesale price (৳)" value={editValues.wholesale} onChange={(wholesale) => setEditValues({ ...editValues, wholesale })} numeric />
          <EditField label="Minimum stock alert" value={editValues.minimum} onChange={(minimum) => setEditValues({ ...editValues, minimum })} numeric />
          <EditField label="SKU (auto if blank)" value={editValues.sku} onChange={(sku) => setEditValues({ ...editValues, sku })} />
          <EditField label="Barcode (auto if blank)" value={editValues.barcode} onChange={(barcode) => setEditValues({ ...editValues, barcode })} />
          <Text style={styles.soft}>Attribute values and stock units are fixed once stock history exists.</Text>
        </ScrollView>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void saveVariant()} style={styles.primaryAction}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save changes'}</Text></Pressable>
      </View></KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <View style={styles.metric}><Text style={styles.label}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.soft}>{unit}</Text></View>;
}
function EditField({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) {
  return <View style={{ gap: 5 }}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType={numeric ? 'decimal-pad' : 'default'} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, header: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg },
  back: { width: 44, height: 44, justifyContent: 'center' }, headerTitle: { color: palette.ink, fontSize: 22, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }, content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, gap: 14, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.md, backgroundColor: palette.surface },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  heroImage: { width: 100, height: 100, borderRadius: radius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  initials: { color: palette.primaryDeep, fontSize: 28, fontWeight: '700' }, heroCopy: { flex: 1, gap: 4 },
  status: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' }, name: { color: palette.ink, fontSize: 21, fontWeight: '700' },
  variantLabel: { color: palette.ink, fontSize: 16, fontWeight: '600' }, soft: { color: palette.secondary, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, label: { color: palette.secondary, fontSize: 13, fontWeight: '600' },
  body: { color: palette.ink, fontSize: 14, lineHeight: 21 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, minWidth: '45%', padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm },
  metricValue: { color: palette.ink, fontSize: 21, fontWeight: '700' }, row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.border },
  rowName: { color: palette.ink, fontSize: 14, fontWeight: '600' }, rowValue: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  inlineAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }, link: { color: palette.primaryDeep, fontWeight: '700' },
  actions: { gap: 8, paddingBottom: 12 }, primaryAction: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.sm, backgroundColor: palette.primary },
  primaryText: { color: palette.surface, fontWeight: '700' }, backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(21,33,31,0.45)' },
  helpCard: { width: '100%', maxWidth: 440, padding: spacing.lg, gap: 12, borderRadius: radius.md, backgroundColor: palette.surface }, helpTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { flex: 1, color: palette.ink, fontSize: 18, fontWeight: '700' }, unitCard: { width: '100%', maxWidth: 440, padding: spacing.lg, gap: 10, borderRadius: radius.md, backgroundColor: palette.surface },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, color: palette.ink },
  editBody: { gap: 10, paddingBottom: 12 },
});
