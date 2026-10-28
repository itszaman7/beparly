import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText as Text } from '@/components/app-text';
import { AppSymbol } from '@/components/app-symbol';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { api, ApiError, Category, Contact, Product, ProductUnit, QuotationInput, QuotationLineInput, StockLocation, Variant } from '@/services/api';
import { cacheQuotationCatalog, cacheQuotationCategories, cacheQuotationOptions, cacheQuotationUnits, clearQuotationDraft, loadQuotationCatalog, loadQuotationCategories, loadQuotationDraft, loadQuotationOptions, loadQuotationUnits, LocalQuotation, saveQuotationDraft } from './quotation-storage';

const commandId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
  const value = Math.floor(Math.random() * 16); return (character === 'x' ? value : (value & 3) | 8).toString(16);
});
type QuotationCustomer = Pick<Contact, 'id' | 'name' | 'phone' | 'address' | 'area' | 'district'>;
const empty: QuotationInput = { location_id: 0, price_tier: 'retail', customer_name: '', customer_phone: '', customer_address: '', discount: '0', delivery_fee: '0', delivery_address: '', notes: '', lines: [] };
type QuotationStep = 'catalog' | 'review';
const catalogPrice = (product: Product, variant: Variant | undefined, tier: QuotationInput['price_tier']) => {
  const retail = variant ? variant.retail_price : product.retail_price;
  return tier === 'wholesale' ? ((variant ? variant.wholesale_price : product.wholesale_price) ?? retail) : retail;
};

export function QuotationForm({ id, initialTier, draftKey }: { id?: string; initialTier?: 'retail' | 'wholesale'; draftKey?: string }) {
  const { session } = useAuth(); const businessId = session?.account?.business.id;
  const key = id ?? draftKey ?? 'new';
  const [draft, setDraft] = useState<LocalQuotation | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [customers, setCustomers] = useState<QuotationCustomer[]>([]);
  const [units, setUnits] = useState<Record<string, ProductUnit[]>>({});
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [step, setStep] = useState<QuotationStep>(id ? 'review' : 'catalog');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [sort, setSort] = useState<'name' | 'price_asc' | 'price_desc'>('name');
  const [catalogLimit, setCatalogLimit] = useState(50);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerNextPage, setCustomerNextPage] = useState<number | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerOffline, setCustomerOffline] = useState(false);
  const customerRequest = useRef(0);
  const [search, setSearch] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session || !businessId) return;
    let active = true;
    void (async () => {
      const local = await loadQuotationDraft(businessId, key);
      if (!active) return;
      if (local) setDraft(!id && initialTier && local.input.lines.length === 0 ? { ...local, state: 'pending', commandId: commandId(), input: { ...local.input, price_tier: initialTier } } : local);
      else if (id) {
        try {
          const result = await api.quotation(session.token, businessId, id);
          if (active) setDraft({ key, serverId: id, version: result.quotation.version, commandId: commandId(), state: 'synced', input: {
            version: result.quotation.version, customer_id: result.quotation.customer_id, customer_name: result.quotation.customer_name,
            customer_phone: result.quotation.customer_phone, customer_address: result.quotation.customer_address,
            location_id: result.quotation.location_id, price_tier: result.quotation.price_tier,
            valid_until: result.quotation.valid_until, delivery_address: result.quotation.delivery_address,
            notes: result.quotation.notes, discount: result.quotation.discount, delivery_fee: result.quotation.delivery_fee,
            lines: (result.quotation.lines ?? []).map(line => ({ product_id: line.product_id, variant_id: line.variant_id,
              unit_id: line.unit_id, quantity: line.quantity, unit_price: line.unit_price })) } });
        } catch (problem) { if (active) setError(problem instanceof Error ? problem.message : 'Could not load quotation.'); }
      } else setDraft({ key, serverId: null, version: null, commandId: commandId(), state: 'pending', input: { ...empty, ...(initialTier ? { price_tier: initialTier } : {}) } });
      try {
        const cached = await loadQuotationCatalog(businessId); if (active) setProducts(cached);
        const cachedCategories = await loadQuotationCategories(businessId); if (active) setCatalogCategories(cachedCategories);
        const cachedOptions = await loadQuotationOptions(businessId);
        if (active && cachedOptions) {
          setCustomers(cachedOptions.customers); setLocations(cachedOptions.locations);
          setDraft(current => current && !current.input.location_id ? { ...current, input: { ...current.input, location_id: cachedOptions.locations.find(row => row.is_default)?.id ?? cachedOptions.locations[0]?.id ?? 0 } } : current);
        }
        const [catalog, shops, categoryResult] = await Promise.all([api.products(session.token, businessId), api.locations(session.token, businessId), api.categories(session.token, businessId).catch(() => null)]);
        if (!active) return;
        setProducts(catalog.products.filter(row => row.is_active)); void cacheQuotationCatalog(businessId, catalog.products);
        if (categoryResult) { setCatalogCategories(categoryResult.categories.filter(row => row.is_active)); void cacheQuotationCategories(businessId, categoryResult.categories); }
        setLocations(shops.locations.filter(row => row.is_active));
        setDraft(current => current && !current.input.location_id ? { ...current, input: { ...current.input, location_id: shops.locations.find(row => row.is_default)?.id ?? shops.locations[0]?.id ?? 0 } } : current);
      } catch { /* Keep the local draft and cached catalog for offline editing. */ }
    })();
    return () => { active = false; };
  }, [session, businessId, id, key, initialTier]);

  const fetchCustomers = useCallback(async (term: string, page: number, append: boolean) => {
    if (!session || !businessId) return;
    const request = ++customerRequest.current;
    setCustomerLoading(true);
    try {
      const result = await api.quotationCustomers(session.token, businessId, term, page);
      if (request !== customerRequest.current) return;
      setCustomerOffline(false);
      setCustomers(current => {
        return append ? [...current, ...result.customers.filter(row => !current.some(item => item.id === row.id))] : result.customers;
      });
      void cacheQuotationOptions(businessId, locations, result.customers);
      setCustomerNextPage(result.next_page);
    } catch {
      if (request === customerRequest.current) { setCustomerNextPage(null); setCustomerOffline(true); }
    } finally {
      if (request === customerRequest.current) setCustomerLoading(false);
    }
  }, [session, businessId, locations]);

  useEffect(() => {
    if (!showCustomerPicker) return;
    const timeout = setTimeout(() => void fetchCustomers(customerSearch.trim(), 1, false), customerSearch.trim() ? 250 : 0);
    return () => { clearTimeout(timeout); customerRequest.current += 1; };
  }, [showCustomerPicker, customerSearch, fetchCustomers]);

  const lineKeys = draft?.input.lines.map(line => `${line.product_id}:${line.variant_id ?? ''}`).join('|') ?? '';
  useEffect(() => { if (!session || !businessId || !lineKeys) return; let active = true;
    for (const pair of new Set(lineKeys.split('|'))) {
      const [productId, variantId] = pair.split(':');
      void loadQuotationUnits(businessId, productId, variantId || undefined).then(cached => { if (active) setUnits(current => ({ ...current, [pair]: cached })); });
      void api.productUnits(session.token, businessId, productId, variantId || undefined).then(result => {
        if (active) setUnits(current => ({ ...current, [pair]: result.units }));
        void cacheQuotationUnits(businessId, productId, variantId || undefined, result.units);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [session, businessId, lineKeys]);

  useEffect(() => { if (draft && businessId) void saveQuotationDraft(businessId, draft); }, [draft, businessId]);
  const input = draft?.input ?? empty;
  const selectedCustomer = input.customer_id ? customers.find(row => row.id === input.customer_id) : undefined;
  const choices = useMemo(() => products.flatMap(product => product.product_type === 'variant'
    ? (product.variants ?? []).filter(row => row.is_active).map(variant => ({ product, variant }))
    : [{ product, variant: product.variants?.[0] }]), [products]);
  const filtered = choices.filter(({ product, variant }) => {
    const matchesSearch = `${product.name} ${variant?.label ?? ''} ${variant?.sku ?? product.sku}`.toLowerCase().includes(search.toLowerCase());
    const stock = Number(variant?.sellable_stock ?? product.sellable_stock ?? (product.out_of_stock ? 0 : 1));
    return matchesSearch && (categoryFilter === 'all' || product.category === categoryFilter) &&
      (stockFilter === 'all' || (stockFilter === 'in_stock' ? stock > 0 : stock <= 0));
  }).sort((a, b) => {
    if (sort === 'name') return `${a.product.name}${a.variant?.label ?? ''}`.localeCompare(`${b.product.name}${b.variant?.label ?? ''}`);
    const price = ({ product, variant }: typeof choices[number]) => Number(catalogPrice(product, variant, input.price_tier) ?? 0);
    return sort === 'price_asc' ? price(a) - price(b) : price(b) - price(a);
  });
  const visibleChoices = filtered.slice(0, catalogLimit);
  const categories = catalogCategories.filter(category => products.some(product => product.category === category.id));
  const itemCount = input.lines.reduce((total, line) => total + (Number(line.quantity) || 0), 0);
  const change = (patch: Partial<QuotationInput>) => setDraft(current => current ? { ...current, state: 'pending', commandId: commandId(), input: { ...current.input, ...patch } } : current);
  const changeLine = (index: number, patch: Partial<QuotationLineInput>) => change({ lines: input.lines.map((line, position) => position === index ? { ...line, ...patch } : line) });
  const productFor = (line: QuotationLineInput) => products.find(row => row.id === line.product_id);
  const variantFor = (line: QuotationLineInput) => productFor(line)?.variants?.find(row => row.id === line.variant_id);
  const unitKey = (line: QuotationLineInput) => `${line.product_id}:${line.variant_id ?? ''}`;
  const preparedLines = input.lines.map(line => {
    if (line.unit_price?.trim()) return line;
    const product = productFor(line);
    if (!product) return line;
    const variant = variantFor(line);
    const unit = line.unit_id ? units[unitKey(line)]?.find(row => row.id === line.unit_id) : null;
    const price = line.unit_id && !unit ? null : (unit?.selling_price ?? catalogPrice(product, variant, input.price_tier));
    return price == null ? line : { ...line, unit_price: price };
  });
  function changeCatalogQuantity(product: Product, variant: Variant | undefined, delta: 1 | -1) {
    setDraft(current => {
      if (!current) return current;
      const lines = current.input.lines;
      const index = lines.findIndex(line => line.product_id === product.id && (line.variant_id ?? null) === (variant?.id ?? null));
      let nextLines: QuotationLineInput[];
      if (index < 0) {
        if (delta < 0) return current;
        const price = catalogPrice(product, variant, current.input.price_tier);
        if (price == null) return current;
        nextLines = [...lines, { product_id: product.id, variant_id: variant?.id, quantity: '1', unit_price: price }];
      } else {
        const quantity = Number(lines[index].quantity) + delta;
        nextLines = quantity <= 0 ? lines.filter((_, position) => position !== index) : lines.map((line, position) => position === index ? { ...line, quantity: String(quantity) } : line);
      }
      return { ...current, state: 'pending', commandId: commandId(), input: { ...current.input, lines: nextLines } };
    });
  }
  async function save() {
    if (!session || !businessId || !draft) return;
    if (!input.location_id || !input.lines.length) { setError('Choose a shop and at least one product.'); return; }
    setSaving(true); setError('');
    try {
      const result = await api.saveQuotation(session.token, businessId, { ...input, lines: preparedLines, ...(draft.version != null ? { version: draft.version } : {}) }, draft.commandId, draft.serverId ?? undefined);
      await clearQuotationDraft(businessId, key);
      if (id) router.replace(`/sales/quotations/${result.quotation.id}` as Href);
      else router.replace(`/sales/quotations/${result.quotation.id}` as Href);
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 409) {
        setDraft(current => current ? { ...current, state: 'conflict' } : current);
        setError('Conflict: this draft changed elsewhere. Your local edits are saved; duplicate or review the latest server version.');
      } else setError(problem instanceof Error ? problem.message : 'Draft saved locally. Retry when online.');
    } finally { setSaving(false); }
  }
  async function saveConflictAsCopy() {
    if (!session || !businessId || !draft?.serverId) return;
    setSaving(true); setError('');
    try {
      const copied = await api.quotationAction(session.token, businessId, draft.serverId, 'duplicate', {}, draft.commandId);
      if (!copied.quotation) throw new Error('Could not create a draft copy.');
      const next = { ...draft, serverId: copied.quotation.id, version: copied.quotation.version,
        commandId: commandId(), state: 'pending' as const, input: { ...draft.input, version: copied.quotation.version } };
      await saveQuotationDraft(businessId, next);
      setDraft(next);
      const saved = await api.saveQuotation(session.token, businessId, next.input, next.commandId, next.serverId);
      await clearQuotationDraft(businessId, key);
      router.replace(`/sales/quotations/${saved.quotation.id}` as Href);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Your local edits are kept. Retry when online.'); }
    finally { setSaving(false); }
  }
  if (!session?.account) return null;
  if (!draft) return <SafeAreaView style={[styles.safe, styles.loadingState]} edges={['top', 'bottom']}><ActivityIndicator color={palette.primaryDeep} /></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><><RefreshableScrollView onRefresh={async () => {
    if (!session || !businessId) return;
    try {
      const [catalog, shops, categoryResult] = await Promise.all([api.products(session.token, businessId), api.locations(session.token, businessId), api.categories(session.token, businessId)]);
      setProducts(catalog.products.filter((row) => row.is_active)); setLocations(shops.locations.filter((row) => row.is_active));
      setCatalogCategories(categoryResult.categories.filter((row) => row.is_active)); setError('');
      void Promise.all([cacheQuotationCatalog(businessId, catalog.products), cacheQuotationCategories(businessId, categoryResult.categories)]).catch(() => {});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh quotation choices.'); }
  }} style={{ flex: 1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <View style={styles.formHeading}><Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/sales/quotations' as Href)} style={styles.backButton}><AppSymbol name="back" size={20} color={palette.ink} /></Pressable><Text style={styles.formTitle}>{step === 'catalog' ? `${input.price_tier === 'retail' ? 'Retail' : 'Wholesale'} products` : id ? 'Edit quotation' : 'Review offer'}</Text></View>
    {draft?.state === 'conflict' && <Text style={styles.notice}>Conflict · local edits kept</Text>}
    {step === 'catalog' && <>
    <Pressable onPress={() => setShowLocationPicker(open => !open)} style={styles.locationDropdown}><View style={styles.locationIcon}><AppSymbol name="location" size={17} color={palette.primaryDeep} /></View><View style={styles.locationCopy}><Text style={styles.locationLabel}>QUOTING FROM</Text><Text style={styles.locationName}>{locations.find(location => location.id === input.location_id)?.name ?? 'Select shop or warehouse'}</Text></View><AppSymbol name={showLocationPicker ? 'up' : 'down'} size={18} color={palette.primaryDeep} /></Pressable>
    {showLocationPicker && <View style={styles.locationMenu}>{locations.map(location => <Pressable key={location.id} onPress={() => { change({ location_id: location.id }); setShowLocationPicker(false); }} style={styles.locationOption}><View style={styles.locationOptionCopy}><Text style={styles.locationOptionName}>{location.name}</Text><Text style={styles.locationOptionMeta}>{location.type === 'warehouse' ? 'Warehouse' : 'Retail shop'}</Text></View>{location.id === input.location_id && <AppSymbol name="activate" size={18} color={palette.primaryDeep} />}</Pressable>)}</View>}
    <View style={styles.searchBox}><AppSymbol name="products" size={18} color={palette.muted} /><TextInput style={styles.searchInput} placeholder="Search products or SKU" placeholderTextColor={palette.muted} value={search} onChangeText={value => { setSearch(value); setCatalogLimit(50); }} /><Pressable style={styles.controlButton} onPress={() => setStockFilter(value => value === 'all' ? 'in_stock' : value === 'in_stock' ? 'out_of_stock' : 'all')}><Text style={styles.controlText}>{stockFilter === 'all' ? 'All' : stockFilter === 'in_stock' ? 'In stock' : 'Out'}</Text></Pressable></View>
    <View style={styles.controlRow}><Text style={styles.controlText}>Sort:</Text>{([['name', 'Name'], ['price_asc', 'Price ↑'], ['price_desc', 'Price ↓']] as const).map(([value, label]) => <Pressable key={value} style={[styles.chip, sort === value && styles.selected]} onPress={() => { setSort(value); setCatalogLimit(50); }}><Text>{label}</Text></Pressable>)}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}><Pressable style={[styles.chip, categoryFilter === 'all' && styles.selected]} onPress={() => { setCategoryFilter('all'); setCatalogLimit(50); }}><Text>All</Text></Pressable>{categories.map(category => <Pressable key={category.id} style={[styles.chip, categoryFilter === category.id && styles.selected]} onPress={() => { setCategoryFilter(category.id); setCatalogLimit(50); }}><Text>{category.name}</Text></Pressable>)}</ScrollView>
    </>}
    {step === 'review' && <><Text style={styles.label}>Customer</Text>
    <Pressable style={styles.customerCard} onPress={() => { setCustomerSearch(''); setShowCustomerPicker(true); }} accessibilityRole="button" accessibilityLabel="Choose registered customer or walk-in buyer">
      <View style={styles.customerIcon}><AppSymbol name="parties" size={18} color={palette.primaryDeep} /></View>
      <View style={styles.customerCopy}><Text style={styles.customerName}>{input.customer_id ? input.customer_name || selectedCustomer?.name || 'Registered customer' : input.customer_name || 'Walk-in buyer'}</Text>
        <Text style={styles.customerHint}>{input.customer_id ? input.customer_phone || selectedCustomer?.phone || 'Registered customer' : 'Optional buyer details · no account required'}</Text></View>
      <Text style={styles.changeText}>Choose</Text>
    </Pressable>
    {!input.customer_id && <><Field label="Buyer name (optional)" value={input.customer_name ?? ''} onChangeText={customer_name => change({ customer_name })} /><Field label="Phone (optional)" value={input.customer_phone ?? ''} onChangeText={customer_phone => change({ customer_phone })} /><Field label="Address (optional)" value={input.customer_address ?? ''} onChangeText={customer_address => change({ customer_address })} /></>}
    </>}
    {step === 'catalog' && <>
      {visibleChoices.map(({ product, variant }) => {
        const line = input.lines.find(row => row.product_id === product.id && (row.variant_id ?? null) === (variant?.id ?? null));
        const stock = Number(variant?.sellable_stock ?? product.sellable_stock ?? (product.out_of_stock ? 0 : 1));
        const price = catalogPrice(product, variant, input.price_tier);
        return <View key={`${product.id}:${variant?.id ?? ''}`} style={styles.catalogItem}>
          <View style={styles.catalogCopy}>
            <Text style={styles.catalogName}>{product.name}{variant?.label ? ` · ${variant.label}` : ''}</Text>
            <Text style={styles.hint}>{variant?.sku ?? product.sku ?? 'Product'} · {stock > 0 ? `${stock} in stock` : 'Out of stock'}</Text>
            <Text style={styles.productPrice}>{price == null ? 'Set a catalog price' : `৳${price} / ${variant?.base_unit ?? product.base_unit}`}</Text>
          </View>
          {line ? <View style={styles.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${product.name}`} style={styles.stepperButton} onPress={() => changeCatalogQuantity(product, variant, -1)}><Text style={styles.stepperSymbol}>−</Text></Pressable>
            <Text style={styles.stepperValue}>{line.quantity}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add one ${product.name}`} style={styles.stepperButton} onPress={() => changeCatalogQuantity(product, variant, 1)}><Text style={styles.stepperSymbol}>+</Text></Pressable>
          </View> : <Pressable accessibilityRole="button" accessibilityLabel={`Add ${product.name}`} disabled={price == null} style={[styles.rowAdd, price == null && styles.rowAddDisabled]} onPress={() => changeCatalogQuantity(product, variant, 1)}><Text style={[styles.rowAddText, price == null && styles.rowAddTextDisabled]}>{price == null ? 'No price' : '+ Add'}</Text></Pressable>}
        </View>;
      })}
      {visibleChoices.length < filtered.length && <Pressable style={styles.loadMore} onPress={() => setCatalogLimit(value => value + 50)}><Text style={styles.link}>Load more products ({filtered.length - visibleChoices.length} remaining)</Text></Pressable>}
      {!filtered.length && <Text style={styles.emptyText}>{search ? 'No matching products.' : 'No products match these filters.'}</Text>}
    </>}
    {step === 'review' && preparedLines.map((line, index) => { const product = productFor(line); const variant = variantFor(line); const selectedUnit = units[unitKey(line)]?.find(row => row.id === line.unit_id); return <View key={index} style={styles.card}>
      <View style={styles.item}><Text style={styles.itemName}>{product?.name ?? line.product_id}{variant?.label ? ` · ${variant.label}` : ''}</Text><Pressable onPress={() => change({ lines: input.lines.filter((_, position) => position !== index) })}><Text style={styles.danger}>Remove</Text></Pressable></View>
      <View style={styles.wrap}><Pressable style={[styles.chip, !line.unit_id && styles.selected]} onPress={() => changeLine(index, { unit_id: null, unit_price: product ? (catalogPrice(product, variant, input.price_tier) ?? '') : '' })}><Text>{variant?.base_unit ?? product?.base_unit ?? 'Base unit'}</Text></Pressable>{(units[unitKey(line)] ?? []).filter(row => row.is_active).map(unit => <Pressable key={unit.id} style={[styles.chip, line.unit_id === unit.id && styles.selected]} onPress={() => changeLine(index, { unit_id: unit.id, unit_price: unit.selling_price ?? (product ? catalogPrice(product, variant, input.price_tier) : null) ?? line.unit_price })}><Text>{unit.name} × {unit.factor}</Text></Pressable>)}</View>
      <View style={styles.row}><View style={styles.half}><Field label="Quantity" value={line.quantity} onChangeText={quantity => changeLine(index, { quantity })} keyboardType="decimal-pad" /></View><View style={styles.half}><Field label="Unit price (৳)" value={line.unit_price ?? ''} onChangeText={unit_price => changeLine(index, { unit_price })} keyboardType="decimal-pad" editable={session.account?.role === 'owner'} /></View></View>
      <Text style={styles.hint}>{selectedUnit?.name ?? variant?.base_unit ?? product?.base_unit ?? 'Unit'} · approximate ৳{(Number(line.quantity) * Number(line.unit_price)).toFixed(2)}</Text>
    </View>; })}
    {step === 'catalog' && <Pressable style={styles.primary} onPress={() => input.lines.length ? (setStep('review'), setError('')) : setError('Add at least one product to continue.')}><Text style={styles.primaryText}>Review quotation ({itemCount} {itemCount === 1 ? 'item' : 'items'})</Text></Pressable>}
    {step === 'review' && <><View style={styles.row}><View style={styles.half}><Field label="Discount (৳)" value={input.discount} onChangeText={discount => change({ discount })} keyboardType="decimal-pad" /></View><View style={styles.half}><Field label="Delivery (৳)" value={input.delivery_fee} onChangeText={delivery_fee => change({ delivery_fee })} keyboardType="decimal-pad" /></View></View>
    <Field label="Delivery address" value={input.delivery_address ?? ''} onChangeText={delivery_address => change({ delivery_address })} />
    <Field label="Valid until (YYYY-MM-DD, optional)" value={input.valid_until ?? ''} onChangeText={valid_until => change({ valid_until })} />
    <Field label="Notes" value={input.notes ?? ''} onChangeText={notes => change({ notes })} />
    {!!error && <Text style={styles.danger}>{error}</Text>}
    {draft?.state === 'conflict' && draft.serverId && <Pressable style={styles.chip} onPress={() => void saveConflictAsCopy()} disabled={saving}><Text style={styles.link}>Save my edits as a new draft</Text></Pressable>}
    <Pressable style={styles.primary} onPress={() => void save()} disabled={saving}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save quotation draft'}</Text></Pressable></>}
  </RefreshableScrollView>
  <Modal visible={showCustomerPicker} transparent animationType="slide" onRequestClose={() => setShowCustomerPicker(false)}>
    <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.modalSheet}>
      <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>CUSTOMER</Text><Text style={styles.modalTitle}>Choose a buyer</Text></View>
        <Pressable style={styles.closeButton} onPress={() => setShowCustomerPicker(false)} accessibilityRole="button" accessibilityLabel="Close customer picker"><AppSymbol name="close" size={18} color={palette.secondary} /></Pressable>
      </View>
      <View style={styles.modalContent}>
        <TextInput style={styles.input} value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search by name or phone" placeholderTextColor={palette.muted} accessibilityLabel="Search customers by name or phone" />
        <Pressable style={styles.customerResult} onPress={() => { change({ customer_id: null, customer_name: '', customer_phone: '', customer_address: '' }); setShowCustomerPicker(false); }}>
          <View style={styles.resultIcon}><AppSymbol name="sale" size={17} color={palette.primaryDeep} /></View><View style={styles.resultCopy}><Text style={styles.resultName}>Walk-in buyer</Text><Text style={styles.customerHint}>Use optional one-time contact details</Text></View>{!input.customer_id && <AppSymbol name="activate" size={18} color={palette.primaryDeep} />}
        </Pressable>
        <FlatList
          style={styles.customerList}
          data={customerOffline ? customers.filter(item => `${item.name} ${item.phone}`.toLowerCase().includes(customerSearch.trim().toLowerCase())) : customers}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => { if (customerNextPage && !customerLoading) void fetchCustomers(customerSearch.trim(), customerNextPage, true); }}
          onEndReachedThreshold={0.35}
          renderItem={({ item }) => <Pressable style={styles.customerResult} onPress={() => {
            change({ customer_id: item.id, customer_name: item.name || item.phone, customer_phone: item.phone,
              customer_address: [item.address, item.area, item.district].filter(Boolean).join(', ') });
            setShowCustomerPicker(false);
          }}>
            <View style={styles.resultIcon}><AppSymbol name="parties" size={17} color={palette.primaryDeep} /></View>
            <View style={styles.resultCopy}><Text style={styles.resultName} numberOfLines={1}>{item.name || item.phone}</Text><Text style={styles.customerHint}>{item.phone || 'No phone number'}</Text></View>
            {input.customer_id === item.id && <AppSymbol name="activate" size={18} color={palette.primaryDeep} />}
          </Pressable>}
          ListEmptyComponent={!customerLoading ? <Text style={styles.emptyText}>{customerSearch ? 'No customers match that search.' : 'No registered customers found.'}</Text> : undefined}
          ListFooterComponent={customerLoading ? <ActivityIndicator color={palette.primaryDeep} style={{ padding: 14 }} /> : customerNextPage ? <Pressable style={styles.loadMore} onPress={() => void fetchCustomers(customerSearch.trim(), customerNextPage, true)}><Text style={styles.link}>Load more customers</Text></Pressable> : undefined}
        />
      </View>
    </View></KeyboardAvoidingView>
  </Modal></></SafeAreaView>;
}

function Field({ label, value, onChangeText, keyboardType, editable = true }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'decimal-pad'; editable?: boolean }) {
  return <View><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholderTextColor={palette.muted} editable={editable} accessibilityLabel={label} /></View>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  loadingState: { alignItems: 'center', justifyContent: 'center' },
  formHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  formTitle: { color: palette.ink, fontSize: 19, fontWeight: '800' },
  locationChoice: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  searchInput: { flex: 1, minHeight: 44, padding: 0, color: palette.ink },
  controlRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  controlButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 16, backgroundColor: palette.primarySoft },
  controlText: { color: palette.secondary, fontSize: 11, fontWeight: '700' },
  categoryRow: { gap: 7, alignItems: 'center', paddingVertical: 5 },
  productPrice: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' },
  rowAdd: { minWidth: 58, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 18, backgroundColor: palette.primaryDeep },
  stepper: { height: 38, flexDirection: 'row', alignItems: 'center', borderRadius: 19, backgroundColor: palette.primarySoft },
  stepperButton: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center' },
  stepperSymbol: { color: palette.primaryDeep, fontSize: 21, fontWeight: '700' },
  stepperValue: { minWidth: 22, textAlign: 'center', color: palette.ink, fontSize: 13, fontWeight: '800' },
  rowAddDisabled: { backgroundColor: palette.background }, rowAddText: { color: '#fff', fontSize: 11, fontWeight: '800' }, rowAddTextDisabled: { color: palette.muted },
  header: { height: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center' },
  headerTitles: { flex: 1, gap: 2 }, eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: palette.primaryDeep }, headerTitle: { fontSize: 19, fontWeight: '700', color: palette.ink }, headerBadge: { width: 40, height: 40, borderRadius: 14, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  locationDropdown: { minHeight: 58, paddingHorizontal: 11, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }, locationIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }, locationCopy: { flex: 1, gap: 2 }, locationLabel: { color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, locationName: { color: palette.ink, fontSize: 13, fontWeight: '800' }, locationMenu: { padding: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, gap: 2 }, locationOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, borderRadius: 10 }, locationOptionCopy: { flex: 1, gap: 2 }, locationOptionName: { color: palette.ink, fontSize: 12, fontWeight: '700' }, locationOptionMeta: { color: palette.muted, fontSize: 10 },
  catalogItem: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, catalogCopy: { flex: 1, gap: 4 }, catalogName: { color: palette.ink, fontSize: 13, fontWeight: '700' }, addButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryDeep }, catalogEmpty: { flex: 1, minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 9 },
  invoiceMeta: { flexDirection: 'row', backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 15, padding: 14 }, metaCell: { flex: 1, gap: 5 }, metaDivider: { width: 1, backgroundColor: palette.border, marginHorizontal: 12 }, metaLabel: { color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, metaValue: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  paymentModes: { flexDirection: 'row', gap: 8 }, modeCard: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, modeOption: { flex: 1, minHeight: 55, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, modeOptionSelected: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft }, modeOptionText: { color: palette.secondary, fontWeight: '700' }, modeOptionTextSelected: { color: palette.primaryDeep },
  cartBar: { minHeight: 76, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cartSummary: { flexDirection: 'row', alignItems: 'center', gap: 11 }, cartCount: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, cartCountText: { color: palette.primaryDeep, fontWeight: '800' }, cartLabel: { color: palette.secondary, fontSize: 11 }, cartTotal: { color: palette.ink, fontSize: 17, fontWeight: '800' }, nextButton: { height: 48, paddingHorizontal: 18, borderRadius: 25, backgroundColor: palette.primaryDeep, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, nextText: { color: 'white', fontWeight: '700', fontSize: 13 }, buttonDisabled: { opacity: 0.45 },
  totalCard: { padding: 14, gap: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15 }, totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalLabel: { color: palette.secondary, fontSize: 12 }, totalDivider: { height: 1, backgroundColor: palette.border }, totalStrong: { color: palette.ink, fontSize: 14, fontWeight: '800' }, totalAmount: { color: palette.primaryDeep, fontSize: 18, fontWeight: '800' },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: spacing.lg, paddingBottom: 80, gap: 12 },
  title: { color: palette.ink, fontSize: 24, fontWeight: '800' },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  notice: { color: palette.primaryDeep, backgroundColor: palette.primarySoft, padding: 10, borderRadius: 10 },
  link: { color: palette.primaryDeep, fontWeight: '700' },
  label: { color: palette.secondary, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingHorizontal: 13, backgroundColor: palette.surface, color: palette.ink },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 10, backgroundColor: palette.surface },
  selected: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 9 },
  itemName: { flex: 1, color: palette.ink, fontWeight: '700' },
  card: { backgroundColor: palette.surface, padding: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 14, gap: 10 },
  customerCard: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15 },
  customerIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  customerCopy: { flex: 1, gap: 3 },
  customerName: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  customerHint: { color: palette.muted, fontSize: 11 },
  changeText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,25,22,.42)' },
  modalSheet: { width: '100%', maxWidth: 640, maxHeight: '88%', minHeight: 0, alignSelf: 'center', backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border },
  modalEyebrow: { color: palette.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  modalTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
  modalContent: { padding: spacing.lg, gap: 10, paddingBottom: 24, flexShrink: 1 },
  customerList: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  customerResult: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: palette.border },
  resultIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft },
  resultCopy: { flex: 1, gap: 3 },
  resultName: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  emptyText: { padding: 18, textAlign: 'center', color: palette.muted },
  loadMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  danger: { color: '#B42318' },
  primary: { minHeight: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.primaryDeep, borderRadius: 14, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '800' },
});
