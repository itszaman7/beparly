import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from 'tamagui/toast';

import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, radius, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { queueStock } from '@/features/products/product-outbox';
import { api, ApiError, type Product, type Variant, type ProductUnit, type StockBatch, type StockLocation, type ProductMovement } from '@/services/api';

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
const milli = (value: string) => { const [whole, part = ''] = value.split('.'); return BigInt(whole) * 1000n + BigInt(part.padEnd(3, '0')); };
function baseQuantity(quantity: string, unitId: string, units: ProductUnit[]) {
  const factor = unitId ? units.find((item) => item.id === unitId)?.factor : '1';
  if (!factor) throw new Error('Choose an active packaging unit.');
  const raw = milli(quantity) * milli(factor);
  if (raw % 1000n !== 0n) throw new Error('Quantity conversion needs at most three decimal places.');
  const result = raw / 1000n; return `${result / 1000n}.${String(result % 1000n).padStart(3, '0')}`;
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe}><Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.link}>Back</Text></Pressable><Text style={styles.title}>{title}</Text>{children}</SafeAreaView>;
}

export function LocationStockScreen({ movements = false }: { movements?: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>(); const { session } = useAuth();
  const token = session?.token; const businessId = session?.account?.business.id;
  const [items, setItems] = useState<{ id?: string; product_id: string; name: string; quantity?: string; unit?: string; type?: string; quantity_change?: string; created_at?: string }[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token || !businessId || !id) return;
    setLoading(true);
    try { const data = movements ? await api.locationMovements(token, businessId, Number(id)) : await api.locationStock(token, businessId, Number(id)); setItems(movements ? 'movements' in data ? data.movements : [] : 'stock' in data ? data.stock : []); setError(''); }
    catch (cause) { setError('Could not load stock.'); toast.error(cause instanceof Error ? cause.message : 'Could not load stock.'); }
    finally { setLoading(false); }
  }, [token, businessId, id, movements]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Page title={movements ? 'Stock Movements' : 'Location Stock'}><RefreshableScrollView onRefresh={load} contentContainerStyle={styles.body}>{loading ? <ActivityIndicator color={palette.primary} /> : error ? <Pressable onPress={() => void load()}><Text style={styles.link}>Retry loading stock</Text></Pressable> : items.length ? items.map((item, index) => <View key={item.id ?? `${item.product_id}-${index}`} style={styles.card}><Text style={styles.name}>{item.name}</Text><Text style={styles.muted}>{movements ? `${item.type}: ${item.quantity_change} · ${item.created_at?.slice(0, 10)}` : `${item.quantity} ${item.unit}`}</Text></View>) : <Text style={styles.muted}>No stock records yet.</Text>}</RefreshableScrollView></Page>;
}

export function ManualStockScreen() {
  const { id, productId, variantId } = useLocalSearchParams<{ id: string; productId?: string; variantId?: string }>(); const { session } = useAuth();
  const token = session?.token; const businessId = session?.account?.business.id;
  const [locations, setLocations] = useState<StockLocation[]>([]); const [locationId, setLocationId] = useState<number | null>(id ? Number(id) : null);
  const [products, setProducts] = useState<Product[]>([]); const [selected, setSelected] = useState(productId ?? '');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]); const [selectedVariant, setSelectedVariant] = useState(variantId ?? '');
  const [productSearch, setProductSearch] = useState('');
  const [units, setUnits] = useState<ProductUnit[]>([]); const [batches, setBatches] = useState<StockBatch[]>([]);
  const [unitId, setUnitId] = useState(''); const [batchId, setBatchId] = useState('');
  const [lot, setLot] = useState(''); const [expiry, setExpiry] = useState('');
  const [quantity, setQuantity] = useState(''); const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [openings, setOpenings] = useState<ProductMovement[]>([]); const [openingId, setOpeningId] = useState('');
  const [increase, setIncrease] = useState(true);
  const [financialReason, setFinancialReason] = useState<'owner_contribution' | 'count_gain' | 'shortage' | 'opening_correction' | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshChoices = useCallback(async () => {
    if (!token || !businessId) return;
    try {
      const [placeResult, productResult] = await Promise.all([api.locations(token, businessId), api.products(token, businessId, { search: productSearch, active: 'true' })]);
      setLocations(placeResult.locations.filter((location) => location.is_active)); setProducts(productResult.products);
      if (selected) {
        const [detail, unitResult, batchResult, movementResult] = await Promise.all([
          api.product(token, businessId, selected), api.productUnits(token, businessId, selected, selectedVariant || undefined),
          api.productBatches(token, businessId, selected, selectedVariant || undefined), api.productMovements(token, businessId, selected, selectedVariant || undefined, true),
        ]);
        setSelectedProduct(detail.product); setVariants(detail.variants ?? []); setUnits(unitResult.units);
        setBatches(batchResult.batches); setOpenings(movementResult.movements);
      }
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not refresh stock choices.'); }
  }, [token, businessId, productSearch, selected, selectedVariant]);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    void api.locations(token, businessId).then(({ locations: value }) => { setLocations(value.filter((location) => location.is_active)); setLocationId((old) => old || value.find((location) => location.is_default)?.id || null); }).catch(() => {});
  }, [token, businessId]));
  useEffect(() => {
    if (!token || !businessId) return;
    const timer = setTimeout(() => {
      void api.products(token, businessId, { search: productSearch, active: 'true' }).then(async ({ products: value }) => {
        if (selected && !value.some((item) => item.id === selected)) {
          const detail = await api.product(token, businessId, selected);
          setProducts([detail.product, ...value]);
        } else setProducts(value);
      }).catch(() => toast.error('Could not find products. Try again.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [token, businessId, selected, productSearch]);
  const product = selectedProduct?.id === selected ? selectedProduct : products.find((item) => item.id === selected);
  const activeVariant = selectedVariant ? variants.find((item) => item.id === selectedVariant) : product;
  useFocusEffect(useCallback(() => {
    if (!token || !businessId || !selected) return;
    void api.product(token, businessId, selected).then(({ product: value, variants: rows }) => { setSelectedProduct(value); setVariants(rows ?? []); }).catch(() => toast.error('Could not load the product.'));
    if (!selectedVariant && !variantId) { setUnits([]); setBatches([]); }
    void api.productUnits(token, businessId, selected, selectedVariant || undefined).then(({ units: value }) => setUnits(value)).catch(() => {});
    void api.productBatches(token, businessId, selected, selectedVariant || undefined).then(({ batches: value }) => setBatches(value)).catch(() => {});
    void api.productMovements(token, businessId, selected, selectedVariant || undefined, true).then(({ movements }) => setOpenings(movements)).catch(() => setOpenings([]));
  }, [token, businessId, selected, selectedVariant, variantId]));
  async function addBatch() {
    if (!token || !businessId || !selected || !lot.trim() || (activeVariant?.tracking_mode === 'expiry' && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) { toast.error('Enter a batch identifier and expiry date when required.'); return; }
    try { const result = await api.createBatch(token, businessId, selected, { lot_code: lot.trim(), expires_on: expiry || null, ...(selectedVariant ? { variant_id: selectedVariant } : {}) }); setBatches((old) => [...old, { ...result.batch, location_id: locationId ?? 0, location: '', physical: '0', sellable: '0', status: 'ok' }]); setBatchId(result.batch.id); setLot(''); setExpiry(''); toast.success('Batch added.'); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not create batch.'); }
  }
  async function save() {
    if (!token || !businessId || !locationId || !selected || !/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || !reason.trim()) { toast.error('Choose a product and location, then enter quantity and reason.'); return; }
    if (product?.product_type === 'variant' && !selectedVariant) { toast.error('Choose a variant.'); return; }
    if (!financialReason) { toast.error('Choose why the stock changed.'); return; }
    if (increase && (!/^\d+(\.\d{1,4})?$/.test(unitCost) || Number(unitCost) < 0)) { toast.error('Enter the actual cost per base unit.'); return; }
    if (activeVariant?.tracking_mode !== 'simple' && !batchId) { toast.error('Choose a batch.'); return; }
    if (financialReason === 'opening_correction' && !openingId) { toast.error('Choose the opening stock record to correct.'); return; }
    setBusy(true);
    const payload = { product_id: selected, ...(selectedVariant ? { variant_id: selectedVariant } : {}), location_id: locationId, quantity, increase, ...(increase ? { unit_cost: unitCost } : {}), reason: reason.trim(), financial_reason: financialReason, ...(financialReason === 'opening_correction' ? { opening_movement_id: openingId } : {}), ...(batchId ? { batch_id: batchId } : {}), ...(unitId ? { unit_id: unitId } : {}) };
    const command = uuid();
    try { await api.adjustment(token, businessId, payload, command); toast.success(increase ? 'Stock added.' : 'Stock reduced.'); router.back(); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 0) {
      try { await queueStock(command, businessId, 'adjustment', payload, baseQuantity(quantity, unitId, units)); toast.info('Stock change pending sync.'); router.back(); }
      catch (storageError) { toast.error(storageError instanceof Error ? storageError.message : 'Could not save offline.'); }
    } else toast.error(cause instanceof Error ? cause.message : 'Could not post stock.'); }
    finally { setBusy(false); }
  }
  return <Page title="Adjust Stock"><RefreshableScrollView onRefresh={refreshChoices} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    {increase && <><Text style={styles.name}>How is stock coming in?</Text>
      <Pressable style={[styles.card, styles.selected]}><Text>Add Stock Manually</Text></Pressable>
      {(session?.account?.role === 'owner' || session?.account?.can_manage_purchases) &&
        <Pressable style={styles.card} onPress={() => router.push(`/purchases/new?locationId=${locationId || ''}`)}><Text>Purchase from Supplier</Text></Pressable>}
      <Text style={styles.muted}>Manual stock changes use the existing adjustment flow.</Text></>}
    <View style={{ flexDirection: 'row', gap: 8 }}><Pressable onPress={() => { setIncrease(true); setFinancialReason(null); }} style={[styles.card, increase && styles.selected]}><Text>Add stock</Text></Pressable><Pressable onPress={() => { setIncrease(false); setFinancialReason(null); }} style={[styles.card, !increase && styles.selected]}><Text>Reduce stock</Text></Pressable></View>
    <Text style={styles.name}>Why did this change? *</Text>
    {(increase ? ([['count_gain', 'Inventory count gain'], ['owner_contribution', 'Owner added stock']] as const) : ([['shortage', 'Shortage or loss'], ...(session?.account?.role === 'owner' ? [['opening_correction', 'Correct opening stock'] as const] : [])] as const)).map(([value, label]) =>
      <Pressable key={value} onPress={() => setFinancialReason(value)} style={[styles.card, financialReason === value && styles.selected]}><Text>{label}</Text></Pressable>)}
    {financialReason === 'opening_correction' && <><Text style={styles.name}>Opening stock record *</Text>
      {openings.filter((item) => item.location_id === locationId && item.batch_id === (batchId || null)).map((item) => <Pressable key={item.id} onPress={() => setOpeningId(item.id)} style={[styles.card, openingId === item.id && styles.selected]}><Text>{item.created_at.slice(0, 10)} · {item.quantity_change} {product?.base_unit}</Text></Pressable>)}
      {!openings.some((item) => item.location_id === locationId && item.batch_id === (batchId || null)) && <Text style={styles.muted}>No opening stock record matches this location and batch.</Text>}
    </>}
    <Text style={styles.name}>Product *</Text><TextInput style={styles.input} placeholder="Search name, SKU or barcode" value={productSearch} onChangeText={setProductSearch} />{products.map((item) => <Pressable key={item.id} onPress={() => { setSelected(item.id); setSelectedVariant(''); }} style={[styles.card, selected === item.id && styles.selected]}><Text>{item.name}</Text></Pressable>)}
    <Text style={styles.name}>Location *</Text>{locations.map((location) => <Pressable key={location.id} onPress={() => setLocationId(location.id)} style={[styles.card, locationId === location.id && styles.selected]}><Text>{location.name}</Text></Pressable>)}
    {product?.product_type === 'variant' && <><Text style={styles.name}>Variant *</Text>{variants.map((item) => <Pressable key={item.id} onPress={() => { setSelectedVariant(item.id); setBatchId(''); setUnitId(''); }} style={[styles.card, selectedVariant === item.id && styles.selected]}><Text>{item.label} · {item.sku}</Text></Pressable>)}</>}
    {units.length > 0 && <><Text style={styles.name}>Packaging</Text><Pressable onPress={() => setUnitId('')} style={[styles.card, !unitId && styles.selected]}><Text>{product?.base_unit ?? 'Base unit'}</Text></Pressable>{units.map((unit) => <Pressable key={unit.id} onPress={() => setUnitId(unit.id)} style={[styles.card, unitId === unit.id && styles.selected]}><Text>{unit.name} = {unit.factor} {product?.base_unit}</Text></Pressable>)}</>}
    {activeVariant && activeVariant.tracking_mode !== 'simple' && <><Text style={styles.name}>Batch *</Text>{batches.map((batch) => <Pressable key={`${batch.id}-${batch.location_id}`} onPress={() => setBatchId(batch.id)} style={[styles.card, batchId === batch.id && styles.selected]}><Text>{batch.lot_code}{batch.expires_on ? ` · ${batch.expires_on}` : ''}</Text></Pressable>)}
      <TextInput style={styles.input} placeholder="New batch identifier (to create) *" value={lot} onChangeText={setLot} />
      {activeVariant.tracking_mode === 'expiry' && <TextInput style={styles.input} placeholder="Expiry YYYY-MM-DD (to create) *" value={expiry} onChangeText={setExpiry} />}
      <Pressable onPress={() => void addBatch()}><Text style={styles.link}>+ Create batch</Text></Pressable></>}
    <Text style={styles.name}>Quantity *</Text><TextInput style={styles.input} placeholder="Enter quantity" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} />
    {increase && <><Text style={styles.name}>Actual cost per base unit (৳) *</Text><TextInput style={styles.input} placeholder="Cost paid for this stock" keyboardType="decimal-pad" value={unitCost} onChangeText={setUnitCost} /><Text style={styles.muted}>Use the actual cost of these goods. The saved buying price is only a reference.</Text></>}
    <Text style={styles.name}>Reason *</Text><TextInput style={styles.input} placeholder="Why is stock changing?" value={reason} onChangeText={setReason} />
    <Pressable disabled={busy} onPress={() => void save()} style={styles.action}><Text style={styles.actionText}>{busy ? 'Posting…' : increase ? 'Add Stock' : 'Reduce Stock'}</Text></Pressable>
  </RefreshableScrollView></Page>;
}

export function StockActionScreen({ kind }: { kind: 'waste' | 'transfer' }) {
  const { id, productId, variantId } = useLocalSearchParams<{ id: string; productId?: string; variantId?: string }>();
  const { session } = useAuth(); const token = session?.token; const businessId = session?.account?.business.id;
  const [products, setProducts] = useState<Product[]>([]); const [locations, setLocations] = useState<StockLocation[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selected, setSelected] = useState(productId ?? ''); const [source, setSource] = useState(Number(id) || 0); const [destination, setDestination] = useState(0);
  const [variants, setVariants] = useState<Variant[]>([]); const [selectedVariant, setSelectedVariant] = useState(variantId ?? '');
  const [units, setUnits] = useState<ProductUnit[]>([]); const [unitId, setUnitId] = useState('');
  const [batches, setBatches] = useState<StockBatch[]>([]); const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState(''); const [reason, setReason] = useState('damaged'); const [busy, setBusy] = useState(false);
  const refreshChoices = useCallback(async () => {
    if (!token || !businessId) return;
    try {
      const [placeResult, productResult] = await Promise.all([api.locations(token, businessId), api.products(token, businessId, { search: productSearch, active: 'true' })]);
      setLocations(placeResult.locations.filter((item) => item.is_active)); setProducts(productResult.products);
      if (selected) {
        const [detail, unitResult, batchResult] = await Promise.all([api.product(token, businessId, selected), api.productUnits(token, businessId, selected, selectedVariant || undefined), api.productBatches(token, businessId, selected, selectedVariant || undefined)]);
        setVariants(detail.variants ?? []); setUnits(unitResult.units); setBatches(batchResult.batches);
      }
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not refresh stock choices.'); }
  }, [token, businessId, productSearch, selected, selectedVariant]);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId) return;
    void api.locations(token, businessId).then(({ locations: value }) => { setLocations(value.filter((item) => item.is_active)); setSource((old) => old || value.find((item) => item.is_default)?.id || 0); }).catch(() => {});
  }, [token, businessId]));
  useEffect(() => {
    if (!token || !businessId) return;
    const timer = setTimeout(() => {
      void api.products(token, businessId, { search: productSearch, active: 'true' }).then(async ({ products: value }) => {
        if (selected && !value.some((item) => item.id === selected)) setProducts([(await api.product(token, businessId, selected)).product, ...value]); else setProducts(value);
      }).catch(() => toast.error('Could not find products. Try again.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [token, businessId, selected, productSearch]);
  useFocusEffect(useCallback(() => {
    if (!token || !businessId || !selected) return;
    void api.product(token, businessId, selected).then(({ variants: rows }) => setVariants(rows ?? [])).catch(() => {});
    void api.productUnits(token, businessId, selected, selectedVariant || undefined).then(({ units: value }) => setUnits(value)).catch(() => {});
    void api.productBatches(token, businessId, selected, selectedVariant || undefined).then(({ batches: value }) => setBatches(value)).catch(() => {});
  }, [token, businessId, selected, selectedVariant]));
  const product = products.find((item) => item.id === selected);
  const activeVariant = selectedVariant ? variants.find((item) => item.id === selectedVariant) : product;
  async function save() {
    if (!token || !businessId || !selected || !source || product?.product_type === 'variant' && !selectedVariant || !/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || activeVariant?.tracking_mode !== 'simple' && !batchId || kind === 'transfer' && (!destination || destination === source)) { toast.error('Choose product, variant, location, batch if needed, and a valid quantity.'); return; }
    setBusy(true);
    const command = uuid();
    try {
      const common = { product_id: selected, ...(selectedVariant ? { variant_id: selectedVariant } : {}), location_id: source, quantity, ...(batchId ? { batch_id: batchId } : {}), ...(unitId ? { unit_id: unitId } : {}) };
      if (kind === 'waste') await api.waste(token, businessId, { ...common, reason }, command);
      else await api.transfer(token, businessId, { ...common, destination_id: destination }, command);
      toast.success(kind === 'waste' ? 'Waste recorded.' : 'Stock transferred.');
      router.back();
    } catch (cause) { if (cause instanceof ApiError && cause.status === 0) {
      try { const common = { product_id: selected, ...(selectedVariant ? { variant_id: selectedVariant } : {}), location_id: source, quantity, ...(batchId ? { batch_id: batchId } : {}), ...(unitId ? { unit_id: unitId } : {}) };
        await queueStock(command, businessId, kind, kind === 'waste' ? { ...common, reason } : { ...common, destination_id: destination }, baseQuantity(quantity, unitId, units));
        toast.info('Stock change pending sync.'); router.back();
      } catch (storageError) { toast.error(storageError instanceof Error ? storageError.message : 'Could not save offline.'); }
    } else toast.error(cause instanceof Error ? cause.message : 'Could not post stock change.'); }
    finally { setBusy(false); }
  }
  return <Page title={kind === 'waste' ? 'Record Waste' : 'Transfer Stock'}><RefreshableScrollView onRefresh={refreshChoices} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <Text style={styles.name}>Product *</Text><TextInput style={styles.input} placeholder="Search name, SKU or barcode" value={productSearch} onChangeText={setProductSearch} />{products.map((item) => <Pressable key={item.id} onPress={() => { setSelected(item.id); setSelectedVariant(''); setBatchId(''); setUnitId(''); }} style={[styles.card, selected === item.id && styles.selected]}><Text>{item.name}</Text></Pressable>)}
    {product?.product_type === 'variant' && <><Text style={styles.name}>Variant *</Text>{variants.map((item) => <Pressable key={item.id} onPress={() => { setSelectedVariant(item.id); setBatchId(''); setUnitId(''); }} style={[styles.card, selectedVariant === item.id && styles.selected]}><Text>{item.label} · {item.sku}</Text></Pressable>)}</>}
    <Text style={styles.name}>From location *</Text>{locations.map((item) => <Pressable key={item.id} onPress={() => setSource(item.id)} style={[styles.card, source === item.id && styles.selected]}><Text>{item.name}</Text></Pressable>)}
    {kind === 'transfer' && <><Text style={styles.name}>To location *</Text>{locations.filter((item) => item.id !== source).map((item) => <Pressable key={item.id} onPress={() => setDestination(item.id)} style={[styles.card, destination === item.id && styles.selected]}><Text>{item.name}</Text></Pressable>)}</>}
    {units.length > 0 && <><Text style={styles.name}>Unit</Text><Pressable onPress={() => setUnitId('')} style={[styles.card, !unitId && styles.selected]}><Text>{product?.base_unit}</Text></Pressable>{units.map((item) => <Pressable key={item.id} onPress={() => setUnitId(item.id)} style={[styles.card, unitId === item.id && styles.selected]}><Text>{item.name} = {item.factor} {product?.base_unit}</Text></Pressable>)}</>}
    {activeVariant && activeVariant.tracking_mode !== 'simple' && <><Text style={styles.name}>Batch *</Text>{batches.filter((item) => item.location_id === source && Number(item.physical) > 0).map((item) => <Pressable key={item.id} onPress={() => setBatchId(item.id)} style={[styles.card, batchId === item.id && styles.selected]}><Text>{item.lot_code} · {item.physical} physical{item.expires_on ? ` · ${item.expires_on}` : ''}</Text></Pressable>)}</>}
    <Text style={styles.name}>Quantity *</Text><TextInput style={styles.input} placeholder="Enter quantity" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} />
    {kind === 'waste' && <><Text style={styles.name}>Reason *</Text>{['damaged', 'broken', 'spoiled', 'expired', 'lost', 'other'].map((value) => <Pressable key={value} onPress={() => setReason(value)} style={[styles.card, reason === value && styles.selected]}><Text>{value[0].toUpperCase() + value.slice(1)}</Text></Pressable>)}</>}
    <Pressable disabled={busy} onPress={() => void save()} style={styles.action}><Text style={styles.actionText}>{busy ? 'Posting…' : kind === 'waste' ? 'Record Waste' : 'Transfer Stock'}</Text></Pressable>
  </RefreshableScrollView></Page>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.surface }, back: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg }, link: { color: palette.primary, fontWeight: '700' }, title: { width: '100%', maxWidth: 640, alignSelf: 'center', fontSize: 24, fontWeight: '700', color: palette.ink, paddingHorizontal: spacing.lg }, body: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, gap: 12 }, card: { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.lg }, selected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, name: { color: palette.ink, fontSize: 15, fontWeight: '700' }, muted: { color: palette.secondary, fontSize: 13 }, error: { color: palette.rose }, input: { minHeight: 52, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg }, action: { minHeight: 54, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.primary, borderRadius: radius.sm }, actionText: { color: '#fff', fontWeight: '700' } });
