import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from 'tamagui/toast';

import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { palette, spacing, radius, appFontFamily } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { cancelProduct, cancelStock, correctStock, pendingProducts, pendingStock, queueProduct, stageProductImage, syncProducts, syncStock } from '@/features/products/product-outbox';
import { formatBdt, validDecimal } from '@/features/products/product-rules';
import { StockUnitPicker, TrackingPicker } from '@/features/products/product-options';
import { ProductTypeToggle } from '@/features/products/product-type-toggle';
import { newVariantDraft, SimpleAttributes, validateVariantDrafts, variantAttributes, variantInputs, VariantFields, type AttributeDraft, type SimpleAttribute, type VariantDraft } from '@/features/products/variant-fields';
import { api, ApiError, type Category, type Product, type ProductInput, type ProductListOptions, type ProductSummary, type StockLocation } from '@/services/api';

const money = formatBdt;
const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const random = Math.floor(Math.random() * 16);
  return (c === 'x' ? random : (random & 3) | 8).toString(16);
});

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe}><View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><AppSymbol name="back" size={24} color={palette.primary} /></Pressable>
    <Text style={styles.title}>{title}</Text>
  </View>{children}</SafeAreaView>;
}
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, disabled && { opacity: 0.5 }]}><Text style={styles.actionText}>{label}</Text></Pressable>;
}
function FormHeading({ icon, title, help }: { icon: 'products' | 'price' | 'stock'; title: string; help: string }) {
  return <View style={styles.formHeading}><AppSymbol name={icon} size={20} color={palette.primary} /><Text style={styles.formHeadingText}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`About ${title}`} onPress={() => toast.info(help)} style={styles.formInfo}><AppSymbol name="info" size={19} color={palette.secondary} /></Pressable>
  </View>;
}
function Field({ label, value, onChangeText, keyboardType = 'default', placeholder }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'decimal-pad'; placeholder?: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={placeholder} placeholderTextColor={palette.muted} /></View>;
}
function ChoiceModal({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.modalClose}><AppSymbol name="close" size={22} color={palette.secondary} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
export function ProductListScreen() {
  const { session } = useAuth();
  const { stock: stockParam } = useLocalSearchParams<{ stock?: string }>();
  const token = session?.token; const businessId = session?.account?.business.id;
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null); const [categories, setCategories] = useState<Category[]>([]);
  const [stock, setStock] = useState<NonNullable<ProductListOptions['stock']>>(
    stockParam === 'low_stock' || stockParam === 'out_of_stock' ? stockParam : 'all');
  const [active, setActive] = useState<NonNullable<ProductListOptions['active']>>(
    stockParam === 'low_stock' || stockParam === 'out_of_stock' ? 'true' : 'all');
  const [tracking, setTracking] = useState<NonNullable<ProductListOptions['tracking']>>('all');
  const [sort, setSort] = useState<NonNullable<ProductListOptions['sort']>>('name');
  const [filterOpen, setFilterOpen] = useState(false); const [sortOpen, setSortOpen] = useState(false);
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [items, setItems] = useState<Product[]>([]); const [page, setPage] = useState<number | null>(1);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const loadingPage = useRef(false);
  const requestVersion = useRef(0);
  const [error, setError] = useState(''); const [pendingRows, setPendingRows] = useState<{ id: string; name: string; status: string; error: string | null }[]>([]);
  const [pendingStockRows, setPendingStockRows] = useState<{ id: string; status: string; error: string | null; kind: string }[]>([]);
  const [correction, setCorrection] = useState<Record<string, string>>({});
  const categoryLabels = useMemo(() => {
    const byId = new Map(categories.map((item) => [item.id, item]));
    const label = (item: Category) => { const names = [item.name]; const seen = new Set([item.id]); let parent = item.parent;
      while (parent && byId.has(parent) && !seen.has(parent)) { const ancestor = byId.get(parent)!; names.unshift(ancestor.name); seen.add(parent); parent = ancestor.parent; }
      return names.join(' › ');
    };
    return new Map(categories.map((item) => [item.id, label(item)]));
  }, [categories]);
  useEffect(() => { const timeout = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timeout); }, [search]);
  const loadSummary = useCallback(async () => {
    if (!token || !businessId) return;
    try { setSummary(await api.productSummary(token, businessId)); }
    catch { setSummary(null); }
  }, [token, businessId]);
  const load = useCallback(async (next = 1) => {
    if (!token || !businessId) return;
    if (next > 1 && loadingPage.current) return;
    if (next > 1) loadingPage.current = true;
    const version = next === 1 ? ++requestVersion.current : requestVersion.current;
    if (next === 1) { setLoading(true); setItems([]); setPage(null); }
    setError('');
    try {
      if (next === 1) {
        await syncProducts(token, businessId).catch(() => 0);
        await syncStock(token, businessId).catch(() => 0);
        const queued = await pendingProducts(businessId);
        setPendingRows(queued.map((item) => ({ id: item.command_id, name: (JSON.parse(item.payload) as ProductInput).name, status: item.status, error: item.error })));
        setPendingStockRows((await pendingStock(businessId)).map((item) => ({ id: item.command_id, status: item.status, error: item.error, kind: item.kind })));
      }
      const result = await api.products(token, businessId, { search: query, page: next, category: category ?? undefined, stock, active, tracking, sort });
      if (version !== requestVersion.current) return;
      if (next === 1) void api.categories(token, businessId).then(({ categories: value }) => setCategories(value)).catch(() => {});
      setItems((old) => next === 1 ? result.products : [...old, ...result.products]);
      setPage(result.next_page);
    } catch (cause) {
      setPendingRows((await pendingProducts(businessId).catch(() => [])).map((item) => ({ id: item.command_id, name: (JSON.parse(item.payload) as ProductInput).name, status: item.status, error: item.error })));
      setPendingStockRows((await pendingStock(businessId).catch(() => [])).map((item) => ({ id: item.command_id, status: item.status, error: item.error, kind: item.kind })));
      if (version === requestVersion.current) {
        setError('Could not load products.');
        toast.error(cause instanceof Error ? cause.message : 'Could not load products.');
      }
    }
    finally { if (next > 1) loadingPage.current = false; if (version === requestVersion.current) { setLoading(false); setRefreshing(false); } }
  }, [token, businessId, query, category, stock, active, tracking, sort]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useFocusEffect(useCallback(() => { void loadSummary(); }, [loadSummary]));
  const filterCount = Number(stock !== 'all') + Number(active !== 'all') + Number(tracking !== 'all');
  const sortedLabels: Record<NonNullable<ProductListOptions['sort']>, string> = {
    name: 'Name A–Z', name_desc: 'Name Z–A', newest: 'Newest first',
    price_asc: 'Price: low to high', price_desc: 'Price: high to low',
    stock_asc: 'Stock: low to high', stock_desc: 'Stock: high to low',
  };
  return <Shell title="Products"><View style={styles.listBody}>
    <View style={styles.kpiRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Show active products" onPress={() => { setActive('true'); setStock('all'); }} style={[styles.kpiCard, active === 'true' && stock === 'all' && styles.kpiSelected]}><AppSymbol name="products" size={18} color={palette.primary} /><Text style={styles.kpiValue}>{summary?.active_products ?? '—'}</Text><Text style={styles.kpiLabel}>Active</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Show low stock products" onPress={() => { setStock('low_stock'); setActive('true'); }} style={[styles.kpiCard, stock === 'low_stock' && styles.kpiSelected]}><AppSymbol name="warning" size={18} color={palette.primary} /><Text style={styles.kpiValue}>{summary?.low_stock ?? '—'}</Text><Text style={styles.kpiLabel}>Low stock</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Show out of stock products" onPress={() => { setStock('out_of_stock'); setActive('true'); }} style={[styles.kpiCard, stock === 'out_of_stock' && styles.kpiSelected]}><AppSymbol name="stock" size={18} color={palette.primary} /><Text style={styles.kpiValue}>{summary?.out_of_stock ?? '—'}</Text><Text style={styles.kpiLabel}>Out of stock</Text></Pressable>
    </View>
    <TextInput style={styles.input} placeholder="Search name, SKU or barcode" placeholderTextColor={palette.muted} value={search} onChangeText={setSearch} />
    <View style={styles.listControls}>
      <Pressable accessibilityRole="button" onPress={() => setFilterOpen(true)} style={styles.controlButton}><AppSymbol name="adjustment" size={19} color={palette.primary} /><Text style={styles.controlText}>Filters{filterCount ? ` (${filterCount})` : ''}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setSortOpen(true)} style={styles.controlButton}><AppSymbol name="sort" size={19} color={palette.primary} /><Text style={styles.controlText}>{sortedLabels[sort]}</Text></Pressable>
    </View>
    {categories.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => setCategory(null)} style={[styles.filter, !category && styles.filterSelected]}><Text>All categories</Text></Pressable>
      {categories.filter((item) => item.is_active).map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => setCategory(item.id)} style={[styles.filter, category === item.id && styles.filterSelected]}><Text>{categoryLabels.get(item.id)}</Text></Pressable>)}
    </ScrollView>}
    {(filterCount > 0 || category) && <Pressable accessibilityRole="button" onPress={() => { setStock('all'); setActive('all'); setTracking('all'); setCategory(null); }}><Text style={styles.link}>Clear filters</Text></Pressable>}
    {pendingRows.length > 0 && <View style={styles.card}><Text style={styles.label}>Device changes</Text>{pendingRows.map((item) =>
      <View key={item.id}><Text style={styles.muted}>{item.name} · {item.status === 'rejected' ? 'Needs correction' : 'Pending sync'}</Text>
        {item.error ? <Text style={styles.muted}>{item.error}</Text> : null}
        {item.status === 'rejected' && <Pressable accessibilityRole="button" onPress={() => void cancelProduct(item.id).then(() => load())}><Text style={styles.link}>Cancel pending change</Text></Pressable>}
      </View>)}</View>}
    {pendingStockRows.length > 0 && <View style={styles.card}><Text style={styles.label}>Stock changes</Text>{pendingStockRows.map((item) =>
      <View key={item.id}><Text style={styles.muted}>{item.kind} · {item.status === 'rejected' ? 'Needs correction' : 'Pending sync'}</Text>
        {item.error ? <Text style={styles.muted}>{item.error}</Text> : null}
        {item.status === 'rejected' && <><TextInput style={styles.input} keyboardType="decimal-pad" placeholder="Correct quantity" value={correction[item.id] ?? ''} onChangeText={(value) => setCorrection((old) => ({ ...old, [item.id]: value }))} />
          <Pressable accessibilityRole="button" onPress={() => void correctStock(item.id, commandId(), correction[item.id] ?? '').then(() => load()).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Could not correct stock change.'))}><Text style={styles.link}>Save correction for sync</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => void cancelStock(item.id).then(() => load())}><Text style={styles.link}>Cancel pending change</Text></Pressable></>}
      </View>)}</View>}
    {error ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Retry loading products</Text></Pressable> : null}
    {loading && items.length === 0 ? <ActivityIndicator color={palette.primary} /> : <FlatList data={items} keyExtractor={(item) => item.id}
      onEndReached={() => { if (page && !loading) void load(page); }} onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); void loadSummary(); }} />}
      ListEmptyComponent={<Text style={styles.empty}>{query || category || filterCount ? 'No products match these filters.' : 'No products yet. Add your first product.'}</Text>}
      renderItem={({ item }) => <Pressable onPress={() => router.push(`/products/${item.id}` as Href)} style={styles.row}>
        {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.thumb} /> : <View style={styles.thumb}><AppSymbol name="products" size={23} color={palette.primary} /></View>}
        <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>{item.sku} · {item.product_type === 'variant' ? `${item.variant_count} variants · ${item.stock_by_unit?.map((row) => `${row.quantity} ${row.unit}`).join(', ') ?? 'No stock'}` : `Stock ${item.sellable_stock ?? '0'}`}{item.out_of_stock ? ' · Out of stock' : item.low_stock ? ' · Low stock' : ''}{!item.is_active ? ' · Inactive' : ''}</Text></View>
        <Text style={styles.rowPrice}>{money(item.retail_price)}</Text>
      </Pressable>} />}
    <Action label="+ Add Product" onPress={() => router.push('/products/new')} />
    <ChoiceModal visible={filterOpen} title="Filter products" onClose={() => setFilterOpen(false)}>
      <Text style={styles.label}>Stock</Text>
      {([['all', 'All stock'], ['in_stock', 'In stock'], ['low_stock', 'Low stock'], ['out_of_stock', 'Out of stock']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: stock === value }} onPress={() => setStock(value)} style={[styles.choiceRow, stock === value && styles.choiceSelected]}><Text style={styles.choiceText}>{label}</Text></Pressable>)}
      <Text style={styles.label}>Product status</Text>
      {([['all', 'All products'], ['true', 'Active'], ['false', 'Inactive']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: active === value }} onPress={() => setActive(value)} style={[styles.choiceRow, active === value && styles.choiceSelected]}><Text style={styles.choiceText}>{label}</Text></Pressable>)}
      <Text style={styles.label}>Stock tracking</Text>
      {([['all', 'Any mode'], ['simple', 'Simple stock'], ['batch', 'Batch'], ['expiry', 'Batch and expiry']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: tracking === value }} onPress={() => setTracking(value)} style={[styles.choiceRow, tracking === value && styles.choiceSelected]}><Text style={styles.choiceText}>{label}</Text></Pressable>)}
      <Action label="Done" onPress={() => setFilterOpen(false)} />
    </ChoiceModal>
    <ChoiceModal visible={sortOpen} title="Sort products" onClose={() => setSortOpen(false)}>
      {(Object.entries(sortedLabels) as [NonNullable<ProductListOptions['sort']>, string][]).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: sort === value }} onPress={() => { setSort(value); setSortOpen(false); }} style={[styles.choiceRow, sort === value && styles.choiceSelected]}><Text style={styles.choiceText}>{label}</Text></Pressable>)}
    </ChoiceModal>
  </View></Shell>;
}

export function ProductFormScreen({ editing = false }: { editing?: boolean }) {
  const { id, type, duplicateId } = useLocalSearchParams<{ id: string; type?: string; duplicateId?: string }>();
  const { session } = useAuth(); const token = session?.token; const businessId = session?.account?.business.id;
  const [name, setName] = useState(''); const [buying, setBuying] = useState(''); const [selling, setSelling] = useState('');
  const [productType, setProductType] = useState<'single' | 'variant'>(type === 'variant' ? 'variant' : 'single');
  const [attributes, setAttributes] = useState<AttributeDraft[]>([]);
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [simpleAttributes, setSimpleAttributes] = useState<SimpleAttribute[]>([]);
  const [wholesale, setWholesale] = useState(''); const [sku, setSku] = useState(''); const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState('Piece'); const [minimum, setMinimum] = useState('0'); const [description, setDescription] = useState('');
  const [tracking, setTracking] = useState<Product['tracking_mode']>('simple'); const [category, setCategory] = useState<string | null>(null);
  const [openingQuantity, setOpeningQuantity] = useState('');
  const [openingLot, setOpeningLot] = useState(''); const [openingExpiry, setOpeningExpiry] = useState('');
  const [locations, setLocations] = useState<StockLocation[]>([]); const [locationId, setLocationId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]); const [newCategory, setNewCategory] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false); const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryKind, setCategoryKind] = useState<'main' | 'sub'>('main'); const [categoryParent, setCategoryParent] = useState<string | null>(null);
  const [categoryParentOpen, setCategoryParentOpen] = useState(false); const [categoryParentSearch, setCategoryParentSearch] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null); const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false); const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(!!duplicateId);
  const [duplicateReady, setDuplicateReady] = useState(!duplicateId);
  const categoryOptions = useMemo(() => {
    const byId = new Map(categories.map((item) => [item.id, item]));
    return categories.filter((item) => item.is_active).map((item) => {
      const path = [item.name]; const seen = new Set([item.id]); let parent = item.parent;
      while (parent && byId.has(parent) && !seen.has(parent)) { const ancestor = byId.get(parent)!; path.unshift(ancestor.name); seen.add(parent); parent = ancestor.parent; }
      return { id: item.id, label: path.join(' › ') };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [categories]);
  useEffect(() => {
    if (!token || !businessId) return;
    void api.categories(token, businessId).then((value) => setCategories(value.categories)).catch(() => {});
    if (!editing) void api.locations(token, businessId).then((value) => { setLocations(value.locations.filter((item) => item.is_active)); setLocationId(value.locations.find((item) => item.is_default)?.id ?? null); }).catch(() => {});
    if (editing && id) void api.product(token, businessId, id).then(({ product }) => {
      setProductType(product.product_type === 'variant' ? 'variant' : 'single');
      setName(product.name); setBuying(product.purchase_price ?? ''); setSelling(product.retail_price ?? '');
      setWholesale(product.wholesale_price ?? ''); setSku(product.sku); setBarcode(product.barcode);
      setUnit(product.base_unit); setMinimum(product.minimum_stock); setDescription(product.description);
      setSimpleAttributes(Object.entries(product.specifications ?? {}).map(([name, value]) => ({ name, value })));
      setTracking(product.tracking_mode); setCategory(product.category); setCurrentImage(product.image_url);
    }).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Could not load product.'));
  }, [token, businessId, editing, id]);
  useEffect(() => {
    if (editing || !duplicateId || !token || !businessId) return;
    let current = true;
    void api.product(token, businessId, duplicateId).then(({ product, variants }) => {
      if (!current) return;
      setProductType(product.product_type === 'variant' ? 'variant' : 'single');
      setName(`${product.name} copy`); setDescription(product.description); setCategory(product.category);
      setSimpleAttributes(Object.entries(product.specifications ?? {}).map(([name, value]) => ({ name, value })));
      setBuying(product.purchase_price ?? ''); setSelling(product.retail_price ?? ''); setWholesale(product.wholesale_price ?? '');
      setSku(''); setBarcode(''); setUnit(product.base_unit); setMinimum(product.minimum_stock); setTracking(product.tracking_mode);
      setOpeningQuantity(''); setOpeningLot(''); setOpeningExpiry(''); setCurrentImage(null); setImageUri(null);
      if (product.product_type === 'variant') {
        const sourceVariants = (variants ?? []).filter((variant) => variant.is_active);
        const names = [...new Set(sourceVariants.flatMap((variant) => Object.keys(variant.selections)))];
        setAttributes(names.map((name) => ({ name })));
        setVariantDrafts(sourceVariants.map((variant) => ({ ...newVariantDraft(), selections: { ...variant.selections },
          buying: variant.purchase_price ?? '', selling: variant.retail_price ?? '', wholesale: variant.wholesale_price ?? '',
          unit: variant.base_unit, minimum: variant.minimum_stock, tracking: variant.tracking_mode })));
      }
      setDuplicateReady(true);
    }).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Could not load product to duplicate.'))
      .finally(() => { if (current) setDuplicateLoading(false); });
    return () => { current = false; };
  }, [token, businessId, editing, duplicateId]);
  async function pick(camera: boolean) {
    try {
      if (camera && Platform.OS !== 'web') { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { toast.error('Camera permission is needed.'); return; } }
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const context = ImageManipulator.manipulate(asset.uri);
      if (asset.width > 800 || asset.height > 800) context.resize(asset.width >= asset.height ? { width: 800, height: null } : { width: null, height: 800 });
      const image = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
      setImageUri(image.uri); setRemoveImage(false);
    } catch { toast.error('Could not prepare this photo. Try another image.'); }
  }
  async function save() {
    if (!token || !businessId || busy || duplicateLoading || !duplicateReady) return;
    if (!name.trim()) { toast.error('Enter a product name.'); return; }
    let input: ProductInput; let creationInput: ProductInput;
    if (editing && productType === 'variant') {
      input = { name: name.trim(), description: description.trim(), category,
        specifications: Object.fromEntries(simpleAttributes.map(({ name, value }) => [name, value])) };
      creationInput = input;
    } else if (!editing && productType === 'variant') {
      const problem = validateVariantDrafts(attributes, variantDrafts, locationId);
      if (problem) { toast.error(problem); return; }
      input = { id: commandId(), name: name.trim(), description: description.trim(), category,
        specifications: Object.fromEntries(simpleAttributes.map(({ name, value }) => [name, value])),
        product_type: 'variant', attributes: variantAttributes(attributes, variantDrafts), variants: variantInputs(variantDrafts, locationId) };
      creationInput = input;
    } else {
      if (![buying, selling, wholesale].every((value) => validDecimal(value, 2, true)) || !validDecimal(minimum, 3) || !validDecimal(openingQuantity, 3, true)) { toast.error('Enter valid nonnegative prices and quantities.'); return; }
      if (openingQuantity && Number(openingQuantity) > 0 && (!buying.trim() || !locationId)) { toast.error('Enter a buying price and choose a stock location.'); return; }
      if (openingQuantity && Number(openingQuantity) > 0 && tracking !== 'simple' && (!openingLot.trim() || tracking === 'expiry' && !/^\d{4}-\d{2}-\d{2}$/.test(openingExpiry))) { toast.error('Enter opening batch and expiry date when required.'); return; }
      input = { ...(!editing ? { id: commandId() } : {}), name: name.trim(), purchase_price: buying.trim() || null, retail_price: selling.trim() || null,
        wholesale_price: wholesale.trim() || null, sku: sku.trim(), barcode: barcode.trim(), base_unit: unit.trim() || 'Piece',
        minimum_stock: minimum.trim(), description: description.trim(), tracking_mode: tracking, category,
        specifications: Object.fromEntries(simpleAttributes.map(({ name, value }) => [name, value])) };
      creationInput = openingQuantity && Number(openingQuantity) > 0 ? { ...input, opening_stock: {
        quantity: openingQuantity, unit_cost: buying.trim(), location_id: locationId ?? undefined,
        ...(tracking !== 'simple' ? { lot_code: openingLot.trim() } : {}), ...(tracking === 'expiry' ? { expires_on: openingExpiry } : {}) } } : input;
    }
    const command = commandId(); let photoPending = false; let savedId: string | null = null; setBusy(true);
    try {
      const result = editing && id ? await api.updateProduct(token, businessId, id, input, command) : await api.createProduct(token, businessId, creationInput, command);
      savedId = result.product.id;
      if (imageUri) {
        try { await api.uploadProductImage(token, businessId, result.product.id, imageUri); }
        catch (cause) {
          if (Platform.OS === 'web' || !(cause instanceof ApiError) || cause.status !== 0) throw cause;
          const file = await stageProductImage(imageUri, command);
          await queueProduct(command, businessId, 'update', result.product.id, input, file);
          photoPending = true;
        }
      } else if (removeImage && editing) await api.removeProductImage(token, businessId, result.product.id);
      if (photoPending) toast.info('Product saved. Photo pending sync.');
      else toast.success(editing ? 'Product updated.' : 'Product added.');
      router.replace(`/products/${result.product.id}` as Href);
    } catch (cause) {
      if (savedId) {
        toast.error('Product saved, but its photo could not be updated. Open Edit Product to retry the photo.');
        router.replace(`/products/${savedId}` as Href);
        return;
      }
      if (Platform.OS !== 'web' && cause instanceof ApiError && cause.status === 0) {
        try {
          const file = imageUri ? await stageProductImage(imageUri, command) : null;
          await queueProduct(command, businessId, editing ? 'update' : 'create', editing ? id ?? null : input.id ?? null, editing ? input : creationInput, file);
          toast.info('Product saved on this device. Pending sync.');
          router.replace('/products' as Href);
          return;
        } catch (storageError) { toast.error(storageError instanceof Error ? storageError.message : 'Could not save offline.'); }
      } else toast.error(cause instanceof Error ? cause.message : 'Could not save product.');
    } finally { setBusy(false); }
  }
  async function addCategory() {
    if (!token || !businessId) return;
    if (!newCategory.trim()) { toast.error('Enter a category name.'); return; }
    if (categoryKind === 'sub' && !categoryParent) { toast.error('Choose a parent category.'); return; }
    try { const result = await api.createCategory(token, businessId, newCategory.trim(), categoryKind === 'sub' ? categoryParent : null); setCategories((old) => [...old, result.category]); setCategory(result.category.id); setNewCategory(''); setCategoryModalOpen(false); toast.success('Category added.'); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not create category.'); }
  }
  return <Shell title={editing ? 'Edit Product' : duplicateId ? 'Duplicate Product' : 'Add Product'}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      {!!duplicateId && <View style={styles.duplicateNotice}><AppSymbol name="duplicate" size={20} color={palette.purple} /><Text style={styles.muted}>Review this copy before saving. It starts with new SKU and barcode codes, no photo, stock, batches, packaging, or history.</Text></View>}
      <View style={styles.formSection}><FormHeading icon="products" title="Product details" help="Add the shared photo and name used to find this product." />
      <View style={styles.photoSection}>
        <Text style={styles.label}>Product photo <Text style={styles.muted}>(optional)</Text></Text>
        <View style={styles.photoRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose product photo" onPress={() => void pick(false)} style={styles.photoFrame}>
            {imageUri || (currentImage && !removeImage)
              ? <Image source={{ uri: imageUri ?? currentImage ?? '' }} style={styles.photo} resizeMode="cover" />
              : <View style={styles.photoPlaceholder}><Text style={styles.photoPlus}>+</Text><Text style={styles.photoHint}>Add photo</Text></View>}
          </Pressable>
          <View style={styles.photoActions}>
            <Text style={styles.muted}>A clear photo helps you find this product quickly.</Text>
            <Pressable accessibilityRole="button" onPress={() => void pick(false)} style={styles.photoButton}><Text style={styles.link}>Choose from gallery</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void pick(true)} style={styles.photoButton}><Text style={styles.link}>Take photo</Text></Pressable>
            {!!(imageUri || currentImage) && <Pressable accessibilityRole="button" onPress={() => { setImageUri(null); setRemoveImage(true); }} style={styles.photoButton}><Text style={styles.removeLink}>Remove photo</Text></Pressable>}
          </View>
        </View>
      </View>
      <Field label="Product name *" value={name} onChangeText={setName} placeholder="e.g. Chicken eggs" />
      </View>
      {!editing && <View style={styles.productTypeRow}><Text style={styles.label}>Product type</Text><ProductTypeToggle value={productType} onChange={setProductType} /></View>}
      {productType === 'single' && <><View style={styles.formSection}><FormHeading icon="price" title="Prices" help="Enter the usual buying and selling prices in BDT." />
        <Field label={`Buying price (৳)${!editing && Number(openingQuantity) > 0 ? ' *' : ''}`} value={buying} onChangeText={setBuying} keyboardType="decimal-pad" />
        <Field label="Selling price (৳)" value={selling} onChangeText={setSelling} keyboardType="decimal-pad" />
        <Field label="Wholesale price (৳)" value={wholesale} onChangeText={setWholesale} keyboardType="decimal-pad" /></View>
      {!editing && <View style={styles.formSection}><FormHeading icon="stock" title="Opening stock" help="Opening stock is optional. Choose a location when entering a quantity." />
        <Field label="Opening quantity (optional)" value={openingQuantity} onChangeText={setOpeningQuantity} keyboardType="decimal-pad" />
        {!!openingQuantity && Number(openingQuantity) > 0 && <>
          <Text style={styles.label}>Stock location *</Text><View style={styles.modeRow}>{locations.map((location) => <Pressable key={location.id} onPress={() => setLocationId(location.id)} style={[styles.mode, locationId === location.id && styles.modeActive]}><Text style={styles.muted}>{location.name}</Text></Pressable>)}</View></>}
        {!!openingQuantity && Number(openingQuantity) > 0 && tracking !== 'simple' && <><Field label="Opening batch identifier *" value={openingLot} onChangeText={setOpeningLot} />
          {tracking === 'expiry' && <Field label="Expiry date (YYYY-MM-DD) *" value={openingExpiry} onChangeText={setOpeningExpiry} />}</>}
      </View>}</>}
      {(productType === 'single' || editing) && <SimpleAttributes items={simpleAttributes} onChange={setSimpleAttributes} />}
      {editing && productType === 'variant' && <Text style={styles.muted}>Prices and stock settings are edited on each variant.</Text>}
      {!editing && productType === 'variant' && <VariantFields attributes={attributes} setAttributes={setAttributes}
        drafts={variantDrafts} setDrafts={setVariantDrafts} locations={locations} defaultLocationId={locationId} />}
      <Pressable accessibilityRole="button" accessibilityLabel="More options" accessibilityState={{ expanded: more }} onPress={() => setMore(!more)} style={styles.more}>
        <AppSymbol name="category" size={20} color={palette.primary} />
        <View style={styles.moreContent}><Text style={styles.moreTitle}>More options</Text><Text style={styles.muted}>{!editing && productType === 'variant' ? 'Category and description' : 'Category, barcode, units and stock settings'}</Text></View>
        <AppSymbol name={more ? 'up' : 'down'} size={24} color={palette.primary} />
      </Pressable>
      {more && <>
        <Text style={styles.label}>Category</Text><View style={styles.selectorGroup}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose category" onPress={() => setCategoryPickerOpen(true)} style={styles.selector}><Text style={styles.selectorText} numberOfLines={1}>{categoryOptions.find((item) => item.id === category)?.label ?? 'No category'}</Text><AppSymbol name="down" size={20} color={palette.secondary} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Add category" onPress={() => { setCategoryKind('main'); setCategoryParent(null); setNewCategory(''); setCategoryModalOpen(true); }} style={styles.plusButton}><Text style={styles.plusText}>+</Text></Pressable>
        </View>
        {productType === 'single' && <><Field label="SKU (auto if blank)" value={sku} onChangeText={setSku} />
        <Field label="Barcode (auto if blank)" value={barcode} onChangeText={setBarcode} />
        <StockUnitPicker value={unit} onChange={setUnit} />
        <Field label="Minimum stock alert" value={minimum} onChangeText={setMinimum} keyboardType="decimal-pad" />
        <TrackingPicker value={tracking} onChange={setTracking} /></>}
        <Field label="Description" value={description} onChangeText={setDescription} />
      </>}
    </ScrollView><View style={styles.footer}><Action label={duplicateLoading ? 'Loading product…' : busy ? 'Saving…' : duplicateId ? 'Create copy' : 'Save product'} onPress={() => void save()} disabled={busy || !duplicateReady} /></View>
  </KeyboardAvoidingView>
    <ChoiceModal visible={categoryPickerOpen} title="Choose category" onClose={() => setCategoryPickerOpen(false)}>
      <Pressable accessibilityRole="button" onPress={() => { setCategory(null); setCategoryPickerOpen(false); }} style={[styles.choiceRow, !category && styles.choiceSelected]}><Text style={styles.choiceText}>No category</Text></Pressable>
      {categoryOptions.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => { setCategory(item.id); setCategoryPickerOpen(false); }} style={[styles.choiceRow, category === item.id && styles.choiceSelected]}><Text style={styles.choiceText}>{item.label}</Text></Pressable>)}
    </ChoiceModal>
    <ChoiceModal visible={categoryModalOpen} title="Add category" onClose={() => setCategoryModalOpen(false)}>
      <Field label="Category name *" value={newCategory} onChangeText={setNewCategory} placeholder="e.g. MacBook" />
      <Text style={styles.label}>Category level</Text>
      <View style={styles.modeRow}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryKind === 'main' }} onPress={() => { setCategoryKind('main'); setCategoryParentOpen(false); }} style={[styles.mode, categoryKind === 'main' && styles.modeActive]}><Text style={styles.modeText}>Main category</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryKind === 'sub' }} onPress={() => setCategoryKind('sub')} style={[styles.mode, categoryKind === 'sub' && styles.modeActive]}><Text style={styles.modeText}>Subcategory</Text></Pressable>
      </View>
      {categoryKind === 'sub' && <><Text style={styles.label}>Under which category? *</Text>
        {categoryOptions.length ? <><Pressable accessibilityRole="button" accessibilityLabel="Choose parent category" accessibilityState={{ expanded: categoryParentOpen }} onPress={() => setCategoryParentOpen(!categoryParentOpen)} style={styles.selector}>
          <Text style={styles.selectorText} numberOfLines={1}>{categoryOptions.find((item) => item.id === categoryParent)?.label ?? 'Choose a category'}</Text><AppSymbol name={categoryParentOpen ? 'up' : 'down'} size={20} color={palette.secondary} />
        </Pressable>{categoryParentOpen && <View style={styles.parentDropdown}>
          <TextInput value={categoryParentSearch} onChangeText={setCategoryParentSearch} placeholder="Search categories" placeholderTextColor={palette.muted} style={styles.input} />
          <ScrollView nestedScrollEnabled style={styles.parentList} keyboardShouldPersistTaps="handled">{categoryOptions.filter((item) => item.label.toLocaleLowerCase().includes(categoryParentSearch.trim().toLocaleLowerCase())).map((item) =>
            <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: categoryParent === item.id }} onPress={() => { setCategoryParent(item.id); setCategoryParentOpen(false); setCategoryParentSearch(''); }} style={[styles.choiceRow, categoryParent === item.id && styles.choiceSelected]}><Text style={styles.choiceText}>{item.label}</Text></Pressable>)}
          </ScrollView></View>}</> : <Text style={styles.muted}>Create a main category first.</Text>}</>}
      <Action label="Add category" onPress={() => void addCategory()} disabled={categoryKind === 'sub' && !categoryOptions.length} />
    </ChoiceModal>
  </Shell>;
}

const styles = StyleSheet.create({
  formSection: { gap: 12, padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, formHeadingText: { flex: 1, color: palette.ink, fontSize: 17, fontWeight: '700' },
  formInfo: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: palette.surface }, header: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg }, back: { width: 44, height: 44, justifyContent: 'center' }, title: { fontSize: 22, color: palette.ink, fontWeight: '700' },
  listBody: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: spacing.lg, gap: 12, paddingBottom: spacing.lg }, input: { minHeight: 52, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface, color: palette.ink, paddingHorizontal: 14, fontFamily: appFontFamily, fontSize: 15 },
  kpiRow: { flexDirection: 'row', gap: 8 }, kpiCard: { flex: 1, minWidth: 0, minHeight: 94, padding: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface, justifyContent: 'space-between' }, kpiSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, kpiValue: { color: palette.ink, fontSize: 21, fontWeight: '700' }, kpiLabel: { color: palette.secondary, fontSize: 11, fontWeight: '600' },
  listControls: { flexDirection: 'row', gap: 8 }, controlButton: { flex: 1, minWidth: 0, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm }, controlText: { color: palette.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  action: { minHeight: 54, backgroundColor: palette.primary, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, actionText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  row: { minHeight: 76, padding: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }, thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, rowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' }, rowPrice: { color: palette.ink, fontSize: 13 }, muted: { color: palette.secondary, fontSize: 13 }, empty: { color: palette.secondary, textAlign: 'center', marginTop: 50 }, notice: { color: palette.rose, fontSize: 13 },
  form: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 14, padding: spacing.lg, paddingBottom: 40 }, duplicateNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.sm, backgroundColor: palette.purpleSoft }, footer: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border }, field: { gap: 5 }, label: { color: palette.ink, fontSize: 14, fontWeight: '600' }, productTypeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, link: { color: palette.primary, fontWeight: '700', fontSize: 14 }, removeLink: { color: palette.rose, fontWeight: '600', fontSize: 14 }, photoSection: { gap: 10 }, photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, photoFrame: { width: 112, height: 112, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.primarySoft, overflow: 'hidden' }, photo: { width: '100%', height: '100%' }, photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }, photoPlus: { fontSize: 34, fontWeight: '300', color: palette.primary }, photoHint: { fontSize: 12, fontWeight: '600', color: palette.primary }, photoActions: { flex: 1, alignItems: 'flex-start', gap: 3 }, photoButton: { minHeight: 32, justifyContent: 'center' }, more: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: palette.border, paddingVertical: 12 }, moreContent: { flex: 1, gap: 3 }, moreTitle: { color: palette.primary, fontSize: 15, fontWeight: '700' }, options: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, backgroundColor: palette.surface, maxHeight: 180 }, option: { color: palette.ink, padding: 10 }, selected: { backgroundColor: palette.primarySoft, fontWeight: '700' }, modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, mode: { minWidth: 96, flexGrow: 1, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm }, modeActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, heroImage: { width: 130, height: 130, alignSelf: 'center', backgroundColor: palette.primarySoft, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' }, detailName: { color: palette.ink, fontSize: 24, fontWeight: '700' }, card: { padding: spacing.lg, backgroundColor: palette.surface, borderRadius: radius.sm, gap: 12 },
  filter: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 18, backgroundColor: palette.surface }, filterSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  selectorGroup: { flexDirection: 'row', gap: 8 }, selector: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm, paddingHorizontal: 14, backgroundColor: palette.surface }, selectorText: { flex: 1, color: palette.ink, fontSize: 15 }, plusButton: { width: 52, height: 52, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }, plusText: { color: palette.primary, fontSize: 28, fontWeight: '500' }, trackingMode: { flexDirection: 'row', alignItems: 'center', gap: 6 }, modeText: { color: palette.secondary, fontSize: 13, fontWeight: '600' }, modeTextActive: { color: palette.primary },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: 'rgba(21,33,31,0.45)' }, modalCard: { width: '100%', maxWidth: 480, maxHeight: '85%', padding: spacing.lg, borderRadius: radius.md, backgroundColor: palette.surface }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, modalTitle: { color: palette.ink, fontSize: 20, fontWeight: '700' }, modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, modalContent: { gap: 10, paddingBottom: 12 }, choiceRow: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm }, choiceSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, choiceText: { color: palette.ink, fontSize: 14 },
  parentDropdown: { padding: 8, gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: radius.sm }, parentList: { maxHeight: 220 },
});
