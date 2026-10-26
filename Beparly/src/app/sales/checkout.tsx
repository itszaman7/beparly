import { router, useLocalSearchParams, type Href } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol, type AppSymbolName } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { RefreshableScrollView } from '@/components/refreshable-scroll-view';
import { BarcodeScanner } from '@/features/sales/barcode-scanner';
import { palette, spacing } from '@/constants/design-system';
import { useAuth } from '@/features/auth/auth-context';
import { CheckoutCommand, CheckoutPayload, isUnresolved } from '@/features/sales/checkout-command';
import { commandHash, preparedCommand } from '@/features/sales/checkout-command-factory';
import { loadCheckoutCommand, prepareCheckoutCommand, saveCheckoutCommand } from '@/features/sales/checkout-command-store';
import { api, ApiError, Category, Contact, MoneyAccount, Product, resolveAssetUrl, StockLocation, Variant } from '@/services/api';
import { blurWebFocus } from '@/utils/web-focus';

type SaleStep = 'catalog' | 'confirm';
type CatalogItem = { key: string; product: Product; variant?: Variant; unitId?: string; unitName?: string;
  retailPrice?: string | null; wholesalePrice?: string | null };
const salePrice = ({ product, variant, retailPrice, wholesalePrice }: CatalogItem, tier: 'retail' | 'wholesale') => tier === 'retail'
  ? (retailPrice ?? (variant ? variant.retail_price : product.retail_price))
  : (wholesalePrice ?? (variant ? variant.wholesale_price : product.wholesale_price));

export default function NewSale() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; scan?: string; camera?: string }>();
  const mode = params.mode === 'manual' ? 'manual' : 'quick';
  const [step, setStep] = useState<SaleStep>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchProducts, setSearchProducts] = useState<Product[]>([]);
  const [catalogNextPage, setCatalogNextPage] = useState<number | null>(null);
  const [searchNextPage, setSearchNextPage] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [scannedItems, setScannedItems] = useState<CatalogItem[]>([]);
  const [pinnedItems, setPinnedItems] = useState<CatalogItem[]>([]);
  const [scanValue, setScanValue] = useState('');
  const scanInput = useRef<ComponentRef<typeof TextInput>>(null);
  const scanLaunchHandled = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const scanSerial = useRef(Promise.resolve());
  const [catalogCategories, setCatalogCategories] = useState<Category[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState('');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [saleLocationId, setSaleLocationId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const tier: 'retail' | 'wholesale' = mode === 'quick' ? 'retail' : 'wholesale';
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial' | 'due' | ''>('');
  const [paid, setPaid] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [showDiscount, setShowDiscount] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerDistrict, setCustomerDistrict] = useState('');
  const [customerArea, setCustomerArea] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [saleSource, setSaleSource] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [sort, setSort] = useState<'name' | 'price_asc' | 'price_desc'>('name');
  const [filterOpen, setFilterOpen] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [error, setError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<CheckoutCommand | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [storageFailure, setStorageFailure] = useState<{ scope: string; message: string } | null>(null);
  const submitting = useRef(false);
  const businessId = session?.account?.business.id;
  const commandScope = businessId && session ? `${businessId}:${session.user.id}` : null;
  const restoringCommand = loadedScope !== commandScope;

  useEffect(() => {
    if (!session?.account || !businessId) return;
    let active = true;
    void loadCheckoutCommand(businessId, session.user.id).then(command => {
      if (!active) return;
      setStorageFailure(null);
      setPending(command && isUnresolved(command) ? command : null);
    }).catch(problem => {
      if (active) setStorageFailure({ scope: commandScope!, message: problem instanceof Error ? problem.message : 'Could not read checkout storage.' });
    }).finally(() => { if (active) setLoadedScope(commandScope); });
    return () => { active = false; };
  }, [businessId, commandScope, session?.account, session?.user.id]);

  useEffect(() => {
    if (restoringCommand || pending || storageFailure || step !== 'catalog') return;
    if (params.camera === '1' && !scanLaunchHandled.current) {
      const timer = setTimeout(() => { scanLaunchHandled.current = true; setCameraOpen(true); }, 0);
      return () => clearTimeout(timer);
    }
    if (params.scan === '1' || Platform.OS === 'web' && params.camera !== '1') {
      const timer = setTimeout(() => scanInput.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [params.camera, params.scan, pending, restoringCommand, step, storageFailure]);

  async function updateCommand(command: CheckoutCommand) {
    await saveCheckoutCommand(command);
    setPending(command);
  }

  async function checkCommand(command: CheckoutCommand, rejectIfMissing = false, rejectionMessage = '') {
    if (!session) return;
    try {
      const result = await api.saleCommandStatus(session.token, command.businessId, command.id);
      if (result.request_hash && result.request_hash !== await commandHash(command)) {
        await updateCommand({ ...command, state: 'needs_review', lastError: 'Server sale details differ from this saved command. Ask an owner to review before another checkout.' });
        return;
      }
      await updateCommand({ ...command, state: 'confirmed', saleId: result.sale.id, lastError: null });
      router.replace(`/sales/${result.sale.id}` as Href);
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 404) {
        await updateCommand({ ...command, state: rejectIfMissing ? 'rejected' : 'needs_review',
          lastError: rejectIfMissing ? rejectionMessage : 'The server has no confirmed sale for this command yet. Retry the original request or check recent sales.' });
      } else {
        await updateCommand({ ...command, state: 'needs_review', lastError: problem instanceof Error ? problem.message : 'Could not check sale status.' });
      }
    }
  }

  async function sendCommand(command: CheckoutCommand) {
    if (!session || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const sending = { ...command, state: 'sending' as const, attempts: command.attempts + 1, lastAttemptAt: new Date().toISOString() };
      await updateCommand(sending);
      const result = await api.createSale(session.token, sending.businessId, sending.payload, sending.id);
      await updateCommand({ ...sending, state: 'confirmed', saleId: result.sale.id, lastError: null });
      router.replace(`/sales/${result.sale.id}` as Href);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Could not complete the sale.';
      try {
        const uncertain = { ...command, state: 'awaiting_confirmation' as const, lastError: message };
        await updateCommand(uncertain);
        const knownRejection = problem instanceof ApiError && problem.status >= 400 && problem.status < 500 &&
          ![401, 403, 408, 429].includes(problem.status);
        await checkCommand(uncertain, knownRejection, message);
      } catch { setError('Checkout storage failed. Do not create another sale; check recent sales by command ID.'); }
    } finally { submitting.current = false; setSaving(false); }
  }

  useEffect(() => {
    if (pending && ['prepared', 'sending', 'awaiting_confirmation'].includes(pending.state) && !submitting.current) {
      const timeout = setTimeout(() => { void checkCommand(pending); }, 0);
      return () => clearTimeout(timeout);
    }
  // Status resolution runs once for each newly loaded in-flight state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, pending?.state]);

  const refreshChoices = useCallback(async () => {
    if (!session || !businessId) return;
    setCatalogLoading(true);
    try {
      const [productResult, options, locationResult, categoryResult] = await Promise.all([api.products(session.token, businessId, { sort }), api.salesOptions(session.token, businessId), api.locations(session.token, businessId), api.categories(session.token, businessId)]);
      setProducts(productResult.products.filter((item) => item.is_active));
      setCatalogNextPage(productResult.next_page);
      setContacts(options.contacts);
      setLocations(locationResult.locations.filter((item) => item.is_active));
      setLocationId((current) => locationResult.locations.some((item) => item.is_active && item.id === current) ? current : locationResult.locations.find((item) => item.is_active && item.is_default)?.id ?? locationResult.locations.find((item) => item.is_active)?.id ?? null);
      setAccounts(options.accounts.filter((item) => item.is_active));
      setAccountId((current) => options.accounts.some((item) => item.is_active && item.id === current) ? current : options.accounts.find((item) => item.is_active && item.is_default)?.id || options.accounts.find((item) => item.is_active)?.id || '');
      setCatalogCategories(categoryResult.categories.filter((category) => category.is_active));
      setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load sale options.'); }
    finally { setCatalogLoading(false); }
  }, [session, businessId, sort]);
  useEffect(() => { const timeout = setTimeout(() => { void refreshChoices(); }, 0); return () => clearTimeout(timeout); }, [refreshChoices]);

  useEffect(() => {
    if (!session || !businessId || !query.trim()) return;
    let active = true;
    const timeout = setTimeout(() => {
      void api.products(session.token, businessId, { search: query.trim(), sort }).then(result => {
        if (!active) return;
        setSearchProducts(result.products.filter(item => item.is_active));
        setSearchNextPage(result.next_page);
        setSearchTerm(query.trim());
      }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Product search failed.'); });
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [session, businessId, query, sort]);

  async function loadMoreProducts() {
    if (!session || !businessId || loadingMore) return;
    const searching = !!query.trim();
    const page = searching ? (searchTerm === query.trim() ? searchNextPage : null) : catalogNextPage;
    if (!page) return;
    setLoadingMore(true);
    try {
      const result = await api.products(session.token, businessId, { page, search: searching ? query.trim() : '', sort });
      const merge = (old: Product[]) => [...old, ...result.products.filter(item => !old.some(existing => existing.id === item.id))];
      if (searching) { setSearchProducts(merge); setSearchNextPage(result.next_page); }
      else { setProducts(merge); setCatalogNextPage(result.next_page); }
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load more products.'); }
    finally { setLoadingMore(false); }
  }

  const catalogItems = useMemo<CatalogItem[]>(() => {
    const visibleProducts = [...products, ...searchProducts.filter(row => !products.some(item => item.id === row.id))];
    const listed = visibleProducts.flatMap((product) => product.product_type === 'variant' ? (product.variants ?? []).filter((variant) => variant.tracking_mode === 'simple').map((variant) => ({ key: `${product.id}:${variant.id}`, product, variant })) : [{ key: product.id, product }]);
    const extra = [...scannedItems, ...pinnedItems];
    return [...listed, ...extra.filter((item, index) => !listed.some(row => row.key === item.key) &&
      extra.findIndex(row => row.key === item.key) === index)];
  }, [products, searchProducts, scannedItems, pinnedItems]);
  const hasWholesalePricedItems = catalogItems.some((item) => salePrice(item, 'wholesale') != null);
  const hasRetailPricedItems = catalogItems.some((item) => salePrice(item, 'retail') != null);
  const productCategories = useMemo(() => catalogCategories.filter((category) => products.some((product) => product.category === category.id)), [catalogCategories, products]);
  const filtered = catalogItems.filter((item) => {
    const { product, variant } = item;
    const matchesSearch = `${product.name} ${variant?.label ?? ''} ${variant?.sku ?? product.sku}`.toLowerCase().includes(query.toLowerCase());
    const hasTierPrice = salePrice(item, tier) != null;
    const stock = Number(variant?.sellable_stock ?? product.sellable_stock ?? (product.out_of_stock ? 0 : 1));
    return matchesSearch && hasTierPrice && (categoryFilter === 'all' || product.category === categoryFilter) && (stockFilter === 'all' || (stockFilter === 'in_stock' ? stock > 0 : stock <= 0));
  }).sort((a, b) => {
    if (sort === 'name') return `${a.product.name}${a.variant?.label ?? ''}`.localeCompare(`${b.product.name}${b.variant?.label ?? ''}`);
    const price = (item: CatalogItem) => Number(sort === 'price_asc' || sort === 'price_desc' ? salePrice(item, tier) : 0);
    return sort === 'price_asc' ? price(a) - price(b) : price(b) - price(a);
  });
  const subtotal = useMemo(() => catalogItems.reduce((sum, item) => {
    const price = salePrice(item, tier);
    return sum + Number(price ?? 0) * (cart[item.key] ?? 0);
  }, 0), [catalogItems, cart, tier]);
  const discountValue = discountType === 'percent' ? subtotal * Number(discount || 0) / 100 : Number(discount || 0);
  const total = Math.max(0, subtotal - discountValue + Number(deliveryFee || 0));
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const selectedCustomer = contacts.find((contact) => contact.id === customerId);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const effectiveSaleLocation = locations.find((location) => location.id === (saleLocationId ?? locationId));
  const selectedAccount = accounts.find((account) => account.id === accountId);

  function changeQuantity(productId: string, delta: number) {
    if (delta > 0) {
      const item = catalogItems.find(row => row.key === productId);
      if (item) setPinnedItems(old => old.some(row => row.key === item.key) ? old : [...old, item]);
    }
    setCart((old) => {
      const next = (old[productId] ?? 0) + delta;
      if (next <= 0) { const { [productId]: _removed, ...rest } = old; return rest; }
      return { ...old, [productId]: next };
    });
  }

  function scanBarcode(rawCode: string) {
    const code = rawCode.trim();
    setScanValue('');
    if (!code || !session || !businessId) return;
    scanSerial.current = scanSerial.current.catch(() => {}).then(async () => {
      setScanBusy(true); setError('');
      try {
        const { target } = await api.barcodeLookup(session.token, businessId, code);
        const key = target.unit_id ? `${target.product_id}:${target.variant_id}:${target.unit_id}` :
          target.product_type === 'simple' ? target.product_id : `${target.product_id}:${target.variant_id}`;
        let item = catalogItems.find(row => row.key === key);
        if (!item) {
          const detail = await api.product(session.token, businessId, target.product_id);
          const product = { ...detail.product, sellable_stock: target.sellable_stock };
          const variant = target.product_type === 'variant'
            ? (detail.variants?.find(row => row.id === target.variant_id) ??
              (await api.variant(session.token, businessId, target.product_id, target.variant_id)).variant) : undefined;
          item = { key, product, ...(variant ? { variant: { ...variant, sellable_stock: target.sellable_stock } } : {}),
            ...(target.unit_id ? { unitId: target.unit_id, unitName: target.unit_name,
              retailPrice: target.retail_price, wholesalePrice: target.wholesale_price } : {}) };
          setScannedItems(current => current.some(row => row.key === key) ? current : [...current, item!]);
          setPinnedItems(current => current.some(row => row.key === key) ? current : [...current, item!]);
        }
        if (Number(target.sellable_stock) <= 0) { setError(`${target.product_name} is out of stock.`); return; }
        if (salePrice(item, tier) == null) { setError(`Add a ${tier} price for ${target.product_name}.`); return; }
        changeQuantity(key, 1);
      } catch (problem) { setError(problem instanceof Error ? problem.message : 'Barcode lookup failed.'); }
      finally { setScanBusy(false); }
    });
  }

  async function submit() {
    if (submitting.current || restoringCommand || pending || storageFailure?.scope === commandScope) return;
    if (!paymentMode) { setError('Choose a payment type to continue.'); return; }
    const paidAmount = paymentMode === 'full' ? total.toFixed(2) : (paymentMode === 'due' ? '0' : (paid.trim() || '0'));
    const billingAddress = effectiveSaleLocation?.address?.trim() ?? '';
    if (!session || !businessId || !locationId) { setError('Choose a stock location to continue.'); return; }
    if (!billingAddress) { setError('Add an address to the selected shop before completing this sale.'); return; }
    if (deliveryFee && (!/^\d+(?:\.\d{1,2})?$/.test(deliveryFee) || Number(deliveryFee) < 0)) { setError('Enter a valid delivery charge with up to two decimal places.'); return; }
    if (Number(deliveryFee || 0) > 0 && !deliveryAddress.trim()) { setError('Add the delivery address for this charge.'); return; }
    if (paymentMode !== 'full' && !customerId) { setError('Choose a registered customer for partial payment or due.'); return; }
    if (Number(paidAmount) < total && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setError('Enter a due date as YYYY-MM-DD.'); return; }
    setSaving(true); setError('');
    try {
      const payload: CheckoutPayload = {
        mode, price_tier: tier, location_id: saleLocationId ?? locationId,
        ...(customerId ? { customer_id: customerId } : {}), paid: paidAmount,
        ...(Number(paidAmount) < total ? { due_date: dueDate } : {}),
        ...(Number(paidAmount) > 0 ? { account_id: accountId } : {}),
        discount: discount || '0', discount_type: discountType,
        delivery_fee: deliveryFee.trim() || '0', delivery_address: deliveryAddress.trim(),
        billing_address: { text: billingAddress, location_id: String(saleLocationId ?? locationId) },
        ...(saleSource.trim() ? { source: saleSource.trim() } : {}), ...(saleNotes.trim() ? { notes: saleNotes.trim() } : {}),
        lines: catalogItems.filter((item) => cart[item.key] > 0).map((item) => ({ product_id: item.product.id, ...(item.variant ? { variant_id: item.variant.id } : {}), ...(item.unitId ? { unit_id: item.unitId } : {}), quantity: String(cart[item.key]) })),
      };
      const command = preparedCommand(businessId, session.user.id, payload);
      await prepareCheckoutCommand(command);
      setPending(command);
      await sendCommand(command);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not complete the sale.');
      const existing = await loadCheckoutCommand(businessId, session.user.id).catch(() => null);
      if (existing) setPending(existing);
    }
    finally { setSaving(false); }
  }

  async function addCustomer() {
    if (!session || !businessId || !customerPhone.trim()) { setError('Customer phone number is required.'); return; }
    try {
      const result = await api.createSalesCustomer(session.token, businessId, { phone: customerPhone.trim(), name: customerName.trim(), address: customerAddress.trim(), district: customerDistrict.trim(), area: customerArea.trim(), notes: customerNotes.trim() });
      const customer = { ...result.customer, is_customer: true, is_supplier: false, customer_advance: '0', supplier_advance: '0', to_collect: '0', to_pay: '0' };
      setContacts((old) => old.some((item) => item.id === customer.id) ? old : [...old, customer]);
      blurWebFocus(); setCustomerId(customer.id); setCustomerPhone(''); setCustomerName(''); setCustomerAddress(''); setCustomerDistrict(''); setCustomerArea(''); setCustomerNotes(''); setShowCustomerDetails(false); setShowAddCustomer(false); setShowCustomerPicker(false); setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not add customer.'); }
  }

  if (!session?.account) return null;
  if (restoringCommand || pending || storageFailure?.scope === commandScope) return <SafeAreaView style={[styles.safe, { justifyContent: 'center', padding: 24 }]}>
    <View style={{ gap: 14, padding: 22, borderRadius: 18, backgroundColor: palette.surface }}>
      <Text style={{ fontSize: 21, fontWeight: '800', color: palette.ink }}>
        {storageFailure?.scope === commandScope ? 'Checkout storage unavailable' :
          restoringCommand || pending?.state === 'sending' || pending?.state === 'awaiting_confirmation' ? 'Checking Sale Status' :
          pending?.state === 'rejected' ? 'Sale was not recorded' : pending?.state === 'confirmed' ? 'Sale confirmed' : 'Needs Review'}
      </Text>
      <Text style={{ color: palette.secondary }}>
        {storageFailure?.scope === commandScope ? `${storageFailure.message} Do not start a new sale on this device until storage is available.` :
          restoringCommand ? 'Checking this device for an earlier checkout…' :
          pending?.lastError ?? 'Keep this sale open until its result is confirmed.'}
      </Text>
      {pending ? <Text selectable style={{ color: palette.muted, fontSize: 12 }}>Command ID: {pending.id}</Text> : null}
      {pending?.state === 'needs_review' ? <>
        <Pressable accessibilityRole="button" onPress={() => void checkCommand(pending)} style={styles.saveButton}><Text style={styles.saveText}>Check server again</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => void sendCommand(pending)} style={styles.saveButton}><Text style={styles.saveText}>Retry original sale</Text></Pressable>
      </> : null}
      {pending?.state === 'rejected' ? <Pressable accessibilityRole="button" onPress={() => { setPending(null); setStep('catalog'); }} style={styles.saveButton}><Text style={styles.saveText}>Correct and retry</Text></Pressable> : null}
      <Pressable accessibilityRole="button" onPress={() => router.push('/sales' as Href)}><Text style={{ color: palette.primaryDeep, fontWeight: '700' }}>Search recent sales</Text></Pressable>
      {pending?.saleId ? <Pressable accessibilityRole="button" onPress={() => router.replace(`/sales/${pending.saleId}` as Href)}><Text style={{ color: palette.primaryDeep, fontWeight: '700' }}>Open original receipt</Text></Pressable> : null}
      {storageFailure?.scope === commandScope ? <Pressable accessibilityRole="button" onPress={() => { setLoadedScope(null); void loadCheckoutCommand(businessId!, session.user.id).then(command => { setStorageFailure(null); setPending(command); }).catch(problem => setStorageFailure({ scope: commandScope!, message: String(problem) })).finally(() => setLoadedScope(commandScope)); }}><Text style={{ color: palette.primaryDeep, fontWeight: '700' }}>Retry storage check</Text></Pressable> : null}
    </View>
  </SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => {
          if (step === 'confirm') setStep('catalog');
          else if (router.canGoBack()) router.back();
          else router.replace('/sales-hub' as Href);
        }} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}>
          <AppSymbol name="back" size={21} color={palette.ink} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.eyebrow}>{step === 'catalog' ? (mode === 'quick' ? 'RETAIL SALE' : 'WHOLESALE SALE') : 'CHECKOUT'}</Text>
          <Text style={styles.headerTitle}>{step === 'catalog' ? 'New sale' : 'Confirm sale'}</Text>
        </View>
        <View style={styles.headerBadge}><AppSymbol name={step === 'catalog' ? 'sale' : 'receipt'} size={20} color={palette.primaryDeep} /></View>
      </View>

      {step === 'catalog' ? <>
        <Pressable onPress={() => setShowLocationPicker((open) => !open)} style={styles.locationDropdown} accessibilityRole="button" accessibilityLabel="Select shop">
          <View style={styles.locationIcon}><AppSymbol name="location" size={17} color={palette.primaryDeep} /></View>
          <View style={styles.locationCopy}><Text style={styles.locationLabel}>SELLING FROM</Text><Text style={styles.locationName}>{selectedLocation?.name ?? 'Select shop'}</Text></View>
          <AppSymbol name={showLocationPicker ? 'up' : 'down'} size={18} color={palette.primaryDeep} />
        </Pressable>
        {showLocationPicker ? <View style={styles.locationMenu}>{locations.map((location) => <Pressable key={location.id} onPress={() => { setLocationId(location.id); setShowLocationPicker(false); }} style={styles.locationOption}><View style={styles.locationOptionCopy}><Text style={styles.locationOptionName}>{location.name}</Text><Text style={styles.locationOptionMeta}>{location.type === 'warehouse' ? 'Warehouse' : 'Shop'}{location.is_default ? ' · Default' : ''}</Text></View>{location.id === locationId ? <AppSymbol name="activate" size={18} color={palette.primaryDeep} /> : null}</Pressable>)}</View> : null}
        <View style={styles.searchBox}>
          <AppSymbol name="products" size={18} color={palette.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search products or SKU" placeholderTextColor={palette.muted} style={styles.searchInput} />
          {query ? <Pressable onPress={() => setQuery('')}><AppSymbol name="close" size={18} color={palette.muted} /></Pressable> : null}
        </View>
        <View style={[styles.searchBox, { marginTop: 8 }]}>
          <AppSymbol name="barcode" size={19} color={palette.primaryDeep} />
          <TextInput ref={scanInput} value={scanValue} onChangeText={setScanValue} onSubmitEditing={() => { scanBarcode(scanValue); if (Platform.OS === 'web') setTimeout(() => scanInput.current?.focus(), 0); }}
            placeholder="Scan barcode, then Enter" accessibilityLabel="Scan product barcode" autoCorrect={false}
            autoCapitalize="none" returnKeyType="done" style={styles.searchInput} />
          {scanBusy ? <ActivityIndicator color={palette.primaryDeep} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Open camera scanner" onPress={() => setCameraOpen(true)}><AppSymbol name="barcode" size={22} color={palette.primaryDeep} /></Pressable>
        </View>
        <View style={styles.controlRow}><Pressable onPress={() => setFilterOpen((open) => !open)} style={[styles.controlButton, stockFilter !== 'all' && styles.controlButtonActive]}><AppSymbol name="adjustment" size={16} color={palette.primaryDeep} /><Text style={styles.controlText}>{stockFilter === 'all' ? 'Filters' : stockFilter === 'in_stock' ? 'In stock' : 'Out of stock'}</Text></Pressable><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}><Chip label="Name A–Z" selected={sort === 'name'} onPress={() => setSort('name')} /><Chip label="Price low" selected={sort === 'price_asc'} onPress={() => setSort('price_asc')} /><Chip label="Price high" selected={sort === 'price_desc'} onPress={() => setSort('price_desc')} /></ScrollView></View>
        {filterOpen ? <View style={styles.filterPanel}><Text style={styles.filterTitle}>Stock availability</Text><View style={styles.inlineChips}><Chip label="All stock" selected={stockFilter === 'all'} onPress={() => { setStockFilter('all'); setFilterOpen(false); }} /><Chip label="In stock" selected={stockFilter === 'in_stock'} onPress={() => { setStockFilter('in_stock'); setFilterOpen(false); }} /><Chip label="Out of stock" selected={stockFilter === 'out_of_stock'} onPress={() => { setStockFilter('out_of_stock'); setFilterOpen(false); }} /></View></View> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryRow}>
          <Chip label="All products" selected={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
          {productCategories.map((category) => <Chip key={category.id} label={category.name} selected={categoryFilter === category.id} onPress={() => setCategoryFilter(category.id)} />)}
        </ScrollView>
        <RefreshableScrollView onRefresh={refreshChoices} style={styles.catalogScroll} contentContainerStyle={styles.productGrid} showsVerticalScrollIndicator={false}>
          {filtered.map((item) => {
            const { product, variant } = item;
            const quantity = cart[item.key] ?? 0;
            const price = salePrice(item, tier);
            const stock = Number(variant?.sellable_stock ?? product.sellable_stock ?? (product.out_of_stock ? 0 : 1));
            const outOfStock = stock <= 0;
            return <View key={item.key} style={[styles.productCard, quantity > 0 && styles.productSelected]}>
              <Pressable disabled={outOfStock} onPress={() => changeQuantity(item.key, 1)} accessibilityRole="button" accessibilityLabel={outOfStock ? `${product.name} out of stock` : `Add ${product.name} to sale`}>
                <View style={styles.productImageWrap}>
                  {resolveAssetUrl(product.image_url) ? <Image source={{ uri: resolveAssetUrl(product.image_url) ?? undefined }} style={styles.productImage} resizeMode="cover" /> : <AppSymbol name="products" size={34} color={palette.primaryDeep} />}
                  {quantity > 0 ? <View style={styles.selectedMark}><AppSymbol name="activate" size={16} color="white" /></View> : null}
                  {outOfStock ? <View style={styles.outOfStockBadge}><Text style={styles.outOfStockText}>Out of stock</Text></View> : null}
                </View>
                <Text style={styles.productName} numberOfLines={2}>{product.name}{variant?.label ? ` · ${variant.label}` : ''}</Text>
                <Text style={styles.productSku} numberOfLines={1}>{variant?.sku ?? product.sku}</Text>
              </Pressable>
              <View style={styles.productBottom}>
                <View><Text style={styles.productPrice}>৳{price ?? '—'}</Text><Text style={styles.productUnit}>per {item.unitName ?? variant?.base_unit ?? product.base_unit}</Text></View>
                {quantity > 0 ? <Stepper quantity={quantity} onMinus={() => changeQuantity(item.key, -1)} onPlus={() => changeQuantity(item.key, 1)} /> : <Pressable disabled={outOfStock} style={[styles.addButton, outOfStock && styles.disabledAddButton]} onPress={() => changeQuantity(item.key, 1)}><AppSymbol name="plus" size={19} color="white" /></Pressable>}
              </View>
            </View>;
          })}
          {(query.trim() ? (searchTerm === query.trim() ? searchNextPage : null) : catalogNextPage) ? <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMoreProducts()} style={styles.smallAction}><Text style={styles.smallActionText}>{loadingMore ? 'Loading…' : 'Load more products'}</Text></Pressable> : null}
          {filtered.length === 0 ? <View style={styles.emptyState}>
            {catalogLoading ? <ActivityIndicator color={palette.primaryDeep} /> : <AppSymbol name="products" size={28} color={palette.muted} />}
            <Text style={styles.muted}>{catalogLoading ? 'Loading products…' : error ? 'Could not load products. Pull down to retry.' : query ? 'No matching products.' : mode === 'manual' && catalogItems.length > 0 && !hasWholesalePricedItems ? 'No products have a wholesale price yet. Set wholesale prices in Products, or make a retail sale.' : mode === 'quick' && catalogItems.length > 0 && !hasRetailPricedItems ? 'No products have a retail price yet. Set retail prices in Products.' : products.length > 0 ? 'No products match these filters.' : 'No saleable products found.'}</Text>
            {!catalogLoading && catalogItems.length > 0 && !(mode === 'manual' ? hasWholesalePricedItems : hasRetailPricedItems) && !query ? <View style={styles.inlineChips}>
              <Pressable onPress={() => { blurWebFocus(); router.push('/products' as Href); }} style={styles.smallAction}><Text style={styles.smallActionText}>Open Products</Text></Pressable>
              {mode === 'manual' ? <Pressable onPress={() => { blurWebFocus(); router.replace('/sales/checkout?mode=quick' as Href); }} style={styles.smallAction}><Text style={styles.smallActionText}>Retail Sale</Text></Pressable> : null}
            </View> : null}
          </View> : null}
        </RefreshableScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.cartBar}>
          <View style={styles.cartSummary}><View style={styles.cartCount}><Text style={styles.cartCountText}>{cartCount}</Text></View><View><Text style={styles.cartLabel}>{cartCount === 1 ? '1 item' : `${cartCount} items`}</Text><Text style={styles.cartTotal}>৳{subtotal.toFixed(2)}</Text></View></View>
          <Pressable disabled={!cartCount} onPress={() => { setError(''); setStep('confirm'); }} style={[styles.nextButton, !cartCount && styles.buttonDisabled]}><Text style={styles.nextText}>Review sale</Text><AppSymbol name="chevron" size={18} color="white" /></Pressable>
        </View>
      </> : <>
        <RefreshableScrollView onRefresh={refreshChoices} style={styles.confirmScroll} contentContainerStyle={styles.confirmContent} keyboardShouldPersistTaps="handled">
          <View style={styles.customerCard}><View style={styles.locationIcon}><AppSymbol name="location" size={17} color={palette.primaryDeep} /></View><View style={styles.customerCopy}><Text style={styles.customerName}>{selectedLocation?.name ?? 'Selected shop'}</Text><Text style={styles.customerHint}>Stock location for this sale</Text></View></View>
          <View style={styles.invoiceMeta}>
            <View style={styles.metaCell}><Text style={styles.metaLabel}>INVOICE</Text><Text style={styles.metaValue}>Assigned on save</Text></View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}><Text style={styles.metaLabel}>DATE</Text><Text style={styles.metaValue}>{new Date().toLocaleDateString()}</Text></View>
          </View>
          <Pressable onPress={() => setShowCustomerPicker((open) => !open)} style={styles.customerCard}>
            <View style={styles.customerIcon}><AppSymbol name="parties" size={18} color={palette.primaryDeep} /></View>
            <View style={styles.customerCopy}><Text style={styles.customerName}>{selectedCustomer?.name ?? 'Walk-in Customer'}</Text><Text style={styles.customerHint}>{selectedCustomer ? `${selectedCustomer.phone || 'Registered customer'} · can pay by full, partial, or due` : 'Full payment required for walk-in sales'}</Text></View>
            <Text style={styles.changeText}>{showCustomerPicker ? 'Close' : 'Change'}</Text>
          </Pressable>
          {showCustomerPicker ? <View style={styles.pickerPanel}>
            <TextInput value={customerSearch} onChangeText={setCustomerSearch} placeholder="Search customers" placeholderTextColor={palette.muted} style={styles.formInput} />
            <Chip label="Walk-in Customer" selected={!customerId} onPress={() => { setCustomerId(''); setShowCustomerPicker(false); }} />
            {contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(customerSearch.toLowerCase())).map((contact) => <Pressable key={contact.id} onPress={() => { setCustomerId(contact.id); setShowCustomerPicker(false); }} style={styles.pickerItem}><AppSymbol name="parties" size={17} color={palette.primaryDeep} /><Text style={styles.pickerItemText}>{contact.name || contact.phone}<Text style={styles.muted}> · {contact.phone}</Text></Text>{customerId === contact.id ? <AppSymbol name="activate" size={18} color={palette.primaryDeep} /> : null}</Pressable>)}
            <Pressable onPress={() => { setShowCustomerPicker(false); setShowAddCustomer(true); }} style={styles.addCustomerButton}><AppSymbol name="plus" size={16} color={palette.primaryDeep} /><Text style={styles.optionText}>Register customer</Text></Pressable>
          </View> : null}
          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Items</Text><Pressable onPress={() => setStep('catalog')}><Text style={styles.changeText}>Edit</Text></Pressable></View>
          {catalogItems.filter((item) => cart[item.key]).map((item) => {
            const { product, variant } = item;
            const quantity = cart[item.key];
            const price = Number(salePrice(item, tier)) || 0;
            return <View key={item.key} style={styles.billRow}>
              <View style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }}>{resolveAssetUrl(product.image_url) ? <Image source={{ uri: resolveAssetUrl(product.image_url) ?? undefined }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <AppSymbol name="products" size={20} color={palette.primaryDeep} />}</View><View style={styles.billCopy}><Text style={styles.billName}>{product.name}{variant?.label ? ` · ${variant.label}` : ''}</Text><Text style={styles.billMeta}>{quantity} {item.unitName ?? variant?.base_unit ?? product.base_unit} × ৳{price.toFixed(2)}</Text></View>
              <Text style={styles.billAmount}>৳{(quantity * price).toFixed(2)}</Text>
              <Stepper quantity={quantity} onMinus={() => changeQuantity(item.key, -1)} onPlus={() => changeQuantity(item.key, 1)} compact />
            </View>;
          })}
          <View style={styles.optionsRow}><OptionButton icon="price" label={showDiscount ? 'Discount added' : 'Add discount'} onPress={() => setShowDiscount((value) => !value)} /></View>
          {showDiscount ? <View style={styles.discountRow}><TextInput value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" placeholder="Discount" placeholderTextColor={palette.muted} style={styles.discountInput} /><Segment icon="price" label="Fixed" selected={discountType === 'amount'} onPress={() => setDiscountType('amount')} /><Segment icon="percent" label="Percent" selected={discountType === 'percent'} onPress={() => setDiscountType('percent')} /></View> : null}
          <View style={{ gap: 8 }}><Text style={styles.fieldLabel}>Delivery charge <Text style={styles.muted}>(optional)</Text></Text><TextInput value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="decimal-pad" placeholder="৳0.00" placeholderTextColor={palette.muted} style={styles.formInput} />{Number(deliveryFee || 0) > 0 ? <><Text style={styles.fieldLabel}>Delivery address</Text><TextInput value={deliveryAddress} onChangeText={setDeliveryAddress} placeholder="Where should the order be delivered?" placeholderTextColor={palette.muted} style={[styles.formInput, { minHeight: 68 }]} multiline /></> : null}</View>
          <View style={styles.totalCard}><View style={styles.totalLine}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalLabel}>৳{subtotal.toFixed(2)}</Text></View><View style={styles.totalLine}><Text style={styles.totalLabel}>Discount</Text><Text style={styles.totalLabel}>− ৳{Math.min(discountValue, subtotal).toFixed(2)}</Text></View>{Number(deliveryFee || 0) > 0 ? <View style={styles.totalLine}><Text style={styles.totalLabel}>Delivery</Text><Text style={styles.totalLabel}>৳{Number(deliveryFee).toFixed(2)}</Text></View> : null}<View style={styles.totalDivider} /><View style={styles.totalLine}><Text style={styles.totalStrong}>Total amount</Text><Text style={styles.totalAmount}>৳{total.toFixed(2)}</Text></View></View>
          <View style={paymentTypeStyles.paymentHeading}><Text style={styles.fieldLabel}>Payment type <Text style={paymentTypeStyles.requiredMark}>*</Text></Text><Text style={paymentTypeStyles.paymentHint}>Choose how this sale will be paid.</Text></View>
          <View style={paymentTypeStyles.paymentModes}>
            {([['full', 'Full', 'Paid now'], ['partial', 'Partial', 'Some paid now'], ['due', 'Due', 'Pay later']] as const).map(([value, label, hint]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: paymentMode === value }} onPress={() => { setPaymentMode(value); setError(''); if (value !== 'full' && !customerId) setShowCustomerPicker(true); }} style={[paymentTypeStyles.paymentModeCard, paymentMode === value && paymentTypeStyles.paymentModeSelected]}>
              <View style={[paymentTypeStyles.paymentRadio, paymentMode === value && paymentTypeStyles.paymentRadioSelected]}>{paymentMode === value ? <AppSymbol name="activate" size={15} color="white" /> : null}</View>
              <Text style={[paymentTypeStyles.paymentModeLabel, paymentMode === value && paymentTypeStyles.paymentModeLabelSelected]}>{label}</Text><Text style={[paymentTypeStyles.paymentModeHint, paymentMode === value && paymentTypeStyles.paymentModeHintSelected]}>{hint}</Text>
            </Pressable>)}
          </View>
          {!paymentMode ? <Text style={paymentTypeStyles.paymentRequired}>Select a payment type before completing the sale.</Text> : null}
          {paymentMode !== '' && paymentMode !== 'full' && !customerId ? <Pressable onPress={() => setShowCustomerPicker(true)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, backgroundColor: palette.primarySoft, borderRadius: 12 }}><AppSymbol name="parties" size={17} color={palette.primaryDeep} /><Text style={{ flex: 1, color: palette.secondary, fontSize: 11, lineHeight: 16 }}>Choose a customer to record the unpaid balance on their account.</Text><Text style={styles.changeText}>Choose</Text></Pressable> : null}
          {paymentMode === 'partial' && customerId ? <>
            <TextInput value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="Amount received now" placeholderTextColor={palette.muted} style={styles.formInput} />
            <Text style={styles.dueText}>Remaining due · ৳{Math.max(0, total - Number(paid || 0)).toFixed(2)}</Text>
          </> : null}
          {paymentMode === 'due' && customerId ? <Text style={styles.dueText}>Full amount due · ৳{total.toFixed(2)}</Text> : null}
          {paymentMode !== 'full' && paymentMode !== '' ? <View style={{ gap: 7 }}><Text style={styles.fieldLabel}>Due date *</Text><TextInput value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" style={styles.formInput} accessibilityLabel="Customer due date" /></View> : null}
          {paymentMode === 'full' || paymentMode === 'partial' ? <>
            <Text style={styles.fieldLabel}>Payment account · {selectedAccount?.name ?? 'Choose account'}</Text>
            {accounts.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inlineChips}>{accounts.map((account) => <Chip key={account.id} label={account.name} selected={accountId === account.id} onPress={() => setAccountId(account.id)} />)}</ScrollView> : <Text style={styles.muted}>No payment account is set up yet.</Text>}
            <Pressable onPress={() => router.push('/money/accounts' as Href)} style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6 }}><AppSymbol name="plus" size={15} color={palette.primaryDeep} /><Text style={styles.changeText}>{accounts.length ? 'Manage payment accounts' : 'Add payment account'}</Text></Pressable>
          </> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.border, borderRadius: 15 }}><View style={styles.locationIcon}><AppSymbol name="location" size={17} color={palette.primaryDeep} /></View><View style={styles.customerCopy}><Text style={styles.customerName}>Shop address · {effectiveSaleLocation?.name ?? 'Selected shop'}</Text><Text style={styles.customerHint}>{effectiveSaleLocation?.address || 'Shop address is required'}</Text></View>{effectiveSaleLocation?.address ? <AppSymbol name="activate" size={18} color={palette.primaryDeep} /> : null}</View>
          <View style={{ gap: 8 }}><Text style={styles.fieldLabel}>Stock location</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inlineChips}>{locations.map((location) => <Chip key={location.id} label={location.name} selected={(saleLocationId ?? locationId) === location.id} onPress={() => setSaleLocationId(location.id)} />)}</ScrollView></View>
          <View style={{ gap: 8 }}><Text style={styles.fieldLabel}>Sale source <Text style={styles.muted}>(optional)</Text></Text><TextInput value={saleSource} onChangeText={setSaleSource} placeholder="e.g. Facebook, phone, counter" placeholderTextColor={palette.muted} style={styles.formInput} /><Text style={styles.fieldLabel}>Sales notes <Text style={styles.muted}>(optional)</Text></Text><TextInput value={saleNotes} onChangeText={setSaleNotes} placeholder="Add a note for this sale" placeholderTextColor={palette.muted} style={[styles.formInput, { minHeight: 68 }]} multiline /></View>
          {error ? <><Text style={styles.error}>{error}</Text>{error.toLowerCase().includes('income category') ? <Pressable onPress={() => router.push('/money/income-categories' as Href)} style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6 }}><AppSymbol name="plus" size={15} color={palette.primaryDeep} /><Text style={styles.changeText}>Set up income category</Text></Pressable> : null}</> : null}
        </RefreshableScrollView>
        <View style={styles.confirmFooter}>
          <Pressable onPress={() => setStep('catalog')} style={styles.cancelButton}><Text style={styles.cancelText}>Back to items</Text></Pressable>
          <Pressable disabled={saving || cartCount === 0} onPress={() => void submit()} style={[styles.saveButton, (saving || cartCount === 0) && styles.buttonDisabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : `Complete · ৳${total.toFixed(2)}`}</Text></Pressable>
        </View>
      </>}
      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <BarcodeScanner onClose={() => setCameraOpen(false)} onScan={code => { setCameraOpen(false); scanBarcode(code); }} />
      </Modal>
      <Modal visible={showAddCustomer} transparent animationType="slide" onRequestClose={() => { blurWebFocus(); setShowAddCustomer(false); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.customerModal}>
            <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>CUSTOMER</Text><Text style={styles.modalTitle}>Register customer</Text></View><Pressable onPress={() => { blurWebFocus(); setShowAddCustomer(false); }} style={styles.closeButton}><AppSymbol name="close" size={18} color={palette.ink} /></Pressable></View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalHint}>Phone is required. Save will immediately select this customer for the sale.</Text>
              <TextInput value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" placeholder="Phone number *" placeholderTextColor={palette.muted} style={styles.formInput} autoFocus />
              <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Name (optional)" placeholderTextColor={palette.muted} style={styles.formInput} />
              <Pressable onPress={() => setShowCustomerDetails((open) => !open)} style={styles.detailsToggle}><Text style={styles.changeText}>{showCustomerDetails ? 'Hide customer details' : 'Add more customer details'}</Text><AppSymbol name={showCustomerDetails ? 'up' : 'down'} size={16} color={palette.primaryDeep} /></Pressable>
              {showCustomerDetails ? <View style={styles.addCustomerForm}><TextInput value={customerAddress} onChangeText={setCustomerAddress} placeholder="Address" placeholderTextColor={palette.muted} style={styles.formInput} /><TextInput value={customerDistrict} onChangeText={setCustomerDistrict} placeholder="District" placeholderTextColor={palette.muted} style={styles.formInput} /><TextInput value={customerArea} onChangeText={setCustomerArea} placeholder="Area / thana" placeholderTextColor={palette.muted} style={styles.formInput} /><TextInput value={customerNotes} onChangeText={setCustomerNotes} placeholder="Notes" placeholderTextColor={palette.muted} style={[styles.formInput, { minHeight: 72 }]} multiline /></View> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable onPress={() => void addCustomer()} style={styles.modalSaveButton}><Text style={styles.saveText}>Save and select customer</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  </SafeAreaView>;
}

function Segment({ icon, label, selected, onPress }: { icon: AppSymbolName; label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} accessibilityRole="radio" accessibilityLabel={`${label} discount`} accessibilityState={{ selected }} style={[styles.segment, selected && styles.segmentSelected]}><AppSymbol name={icon} size={15} color={selected ? palette.primaryDeep : palette.secondary} /><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text></Pressable>; }
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text></Pressable>; }
function Stepper({ quantity, onMinus, onPlus, compact = false }: { quantity: number; onMinus: () => void; onPlus: () => void; compact?: boolean }) { return <View style={[styles.stepper, compact && styles.stepperCompact]}><Pressable onPress={onMinus} style={styles.stepButton}><AppSymbol name="minus" size={15} color={palette.primaryDeep} /></Pressable><Text style={styles.stepValue}>{quantity}</Text><Pressable onPress={onPlus} style={styles.stepButton}><AppSymbol name="plus" size={15} color={palette.primaryDeep} /></Pressable></View>; }
function OptionButton({ icon, label, onPress }: { icon: 'price'; label: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.optionButton}><AppSymbol name={icon} size={17} color={palette.primaryDeep} /><Text style={styles.optionText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, screen: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { height: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center' }, headerTitles: { flex: 1, gap: 2 }, eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: palette.primaryDeep }, headerTitle: { fontSize: 19, lineHeight: 24, fontWeight: '700', color: palette.ink }, headerBadge: { width: 40, height: 40, borderRadius: 14, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  locationDropdown: { minHeight: 58, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: 11, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }, locationIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primarySoft }, locationCopy: { flex: 1, gap: 2 }, locationLabel: { color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, locationName: { color: palette.ink, fontSize: 13, fontWeight: '800' }, locationMenu: { marginHorizontal: spacing.lg, marginTop: 5, padding: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, gap: 2 }, locationOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, borderRadius: 10 }, locationOptionCopy: { flex: 1, gap: 2 }, locationOptionName: { color: palette.ink, fontSize: 12, fontWeight: '700' }, locationOptionMeta: { color: palette.muted, fontSize: 10 }, searchBox: { height: 48, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingHorizontal: 13, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, padding: 0, fontSize: 14, color: palette.ink }, 
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, muted: { color: palette.muted, fontSize: 12 },
  controlRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg }, controlButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 17, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, controlButtonActive: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, controlText: { color: palette.secondary, fontSize: 11, fontWeight: '700' }, sortRow: { gap: 7, alignItems: 'center' }, filterPanel: { marginHorizontal: spacing.lg, marginBottom: spacing.xs, padding: 10, borderRadius: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, gap: 8 }, filterTitle: { color: palette.ink, fontSize: 11, fontWeight: '800' }, categoryScroll: { height: 61, flexGrow: 0 }, categoryRow: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' }, chip: { minHeight: 35, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, chipSelected: { backgroundColor: palette.primarySoft, borderColor: palette.primary }, chipText: { color: palette.secondary, fontSize: 12, fontWeight: '600' }, chipTextSelected: { color: palette.primaryDeep, fontWeight: '700' },
  catalogScroll: { flex: 1 }, productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 11, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }, productCard: { width: '48.2%', padding: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 17 }, productSelected: { borderColor: palette.primary, backgroundColor: '#F7FFFD' }, productImageWrap: { height: 112, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, productImage: { width: '100%', height: '100%' }, selectedMark: { position: 'absolute', top: 7, right: 7, width: 25, height: 25, borderRadius: 13, backgroundColor: palette.primaryDeep, alignItems: 'center', justifyContent: 'center' }, outOfStockBadge: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: '#FFF0EE' }, outOfStockText: { color: '#B42318', fontSize: 9, fontWeight: '800' }, productName: { minHeight: 36, fontSize: 13, lineHeight: 17, fontWeight: '700', color: palette.ink }, productSku: { marginTop: 2, color: palette.muted, fontSize: 10 }, productBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }, productPrice: { color: palette.ink, fontSize: 15, fontWeight: '800' }, productUnit: { color: palette.muted, fontSize: 10 }, addButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryDeep }, disabledAddButton: { opacity: 0.35 }, stepper: { height: 34, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: palette.primarySoft }, stepperCompact: { height: 30 }, stepButton: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center' }, stepValue: { minWidth: 18, textAlign: 'center', color: palette.ink, fontSize: 12, fontWeight: '700' }, emptyState: { width: '100%', padding: 36, alignItems: 'center', gap: 10 },
  cartBar: { minHeight: 76, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cartSummary: { flexDirection: 'row', alignItems: 'center', gap: 11 }, cartCount: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, cartCountText: { color: palette.primaryDeep, fontWeight: '800' }, cartLabel: { color: palette.secondary, fontSize: 11 }, cartTotal: { color: palette.ink, fontSize: 17, fontWeight: '800' }, nextButton: { height: 48, paddingHorizontal: 18, borderRadius: 25, backgroundColor: palette.primaryDeep, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, nextText: { color: 'white', fontWeight: '700', fontSize: 13 }, buttonDisabled: { opacity: 0.45 },
  confirmScroll: { flex: 1 }, confirmContent: { padding: spacing.lg, gap: 12, paddingBottom: 22 }, invoiceMeta: { flexDirection: 'row', backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 15, padding: 14 }, metaCell: { flex: 1, gap: 5 }, metaDivider: { width: 1, backgroundColor: palette.border, marginHorizontal: 12 }, metaLabel: { color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, metaValue: { color: palette.ink, fontSize: 13, fontWeight: '600' }, customerCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15 }, customerIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' }, customerCopy: { flex: 1, gap: 3 }, customerName: { color: palette.ink, fontSize: 14, fontWeight: '700' }, customerHint: { color: palette.muted, fontSize: 11 }, changeText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' }, pickerPanel: { padding: 10, gap: 7, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, pickerItem: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 6 }, pickerItemText: { flex: 1, color: palette.ink, fontSize: 13 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }, sectionTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' }, billRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.border }, billCopy: { flex: 1, gap: 3 }, billName: { color: palette.ink, fontSize: 13, fontWeight: '700' }, billMeta: { color: palette.muted, fontSize: 11 }, billAmount: { color: palette.ink, fontSize: 13, fontWeight: '700', minWidth: 64, textAlign: 'right' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }, optionButton: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 18, backgroundColor: palette.primarySoft }, optionText: { color: palette.primaryDeep, fontSize: 12, fontWeight: '700' }, discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, discountInput: { flex: 1, minHeight: 42, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, color: palette.ink, fontSize: 14 },
  categoryCreate: { gap: 7 }, fieldLabel: { color: palette.secondary, fontSize: 11, fontWeight: '700', marginTop: 3 }, inlineChips: { gap: 7 }, smallAction: { minHeight: 40, paddingHorizontal: 17, borderRadius: 12, backgroundColor: palette.primaryDeep, alignItems: 'center', justifyContent: 'center' }, smallActionText: { color: 'white', fontSize: 12, fontWeight: '700' }, addCustomerButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6 }, addCustomerForm: { gap: 8, paddingTop: 5 }, detailsToggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 25, 22, 0.42)' }, customerModal: { width: '100%', maxWidth: 640, maxHeight: '88%', alignSelf: 'center', backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border }, modalEyebrow: { color: palette.primaryDeep, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, modalTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }, closeButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }, modalContent: { padding: spacing.lg, gap: 10, paddingBottom: 28 }, modalHint: { color: palette.muted, fontSize: 12, lineHeight: 18 }, modalSaveButton: { minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primaryDeep, marginTop: 4 }, totalCard: { padding: 14, gap: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 15, marginTop: 3 }, totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalLabel: { color: palette.secondary, fontSize: 12 }, totalDivider: { height: 1, backgroundColor: palette.border }, totalStrong: { color: palette.ink, fontSize: 14, fontWeight: '800' }, totalAmount: { color: palette.primaryDeep, fontSize: 18, fontWeight: '800' }, paymentModes: { flexDirection: 'row', gap: 8 }, segment: { minHeight: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }, segmentSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft }, segmentText: { color: palette.secondary, fontSize: 11, fontWeight: '600' }, segmentTextSelected: { color: palette.primaryDeep, fontWeight: '800' }, formInput: { minHeight: 45, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: palette.surface, color: palette.ink, fontSize: 13 }, dueText: { color: palette.orange, fontSize: 12, fontWeight: '700' },
  confirmFooter: { flexDirection: 'row', gap: 9, padding: spacing.md, paddingBottom: Math.max(spacing.md, 8), backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border }, cancelButton: { flex: 0.8, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: palette.border }, cancelText: { color: palette.secondary, fontSize: 13, fontWeight: '700' }, saveButton: { flex: 1.2, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: palette.primaryDeep }, saveText: { color: 'white', fontSize: 13, fontWeight: '800' }, error: { color: '#B42318', fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
});

const paymentTypeStyles = StyleSheet.create({
  paymentHeading: { gap: 3 }, requiredMark: { color: '#B42318', fontSize: 13, fontWeight: '800' },
  paymentHint: { color: palette.muted, fontSize: 11 },
  paymentModes: { flexDirection: 'row', gap: 8 },
  paymentModeCard: { flex: 1, minWidth: 85, minHeight: 82, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 14, borderWidth: 2, borderColor: '#CBD8D2', backgroundColor: palette.surface },
  paymentModeSelected: { borderColor: palette.primaryDeep, backgroundColor: palette.primarySoft },
  paymentRadio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: '#91A39B', backgroundColor: palette.surface },
  paymentRadioSelected: { borderColor: palette.primaryDeep, backgroundColor: palette.primaryDeep },
  paymentModeLabel: { color: palette.ink, fontSize: 13, fontWeight: '800' },
  paymentModeLabelSelected: { color: palette.primaryDeep },
  paymentModeHint: { color: palette.muted, fontSize: 9, textAlign: 'center' },
  paymentModeHintSelected: { color: palette.primaryDeep },
  paymentRequired: { color: '#A62925', fontSize: 11, fontWeight: '700' },
});
