import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { RecordAttachments, uploadPendingAttachments } from '@/features/attachments/record-attachments';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { cachePurchaseCatalog, clearPurchaseDraft, loadPurchaseDraft, savePurchaseDraft,
  searchCachedPurchaseCatalog } from '@/features/purchases/purchase-draft';
import { lineAmountCents, purchaseAmountCents } from '@/features/purchases/purchase-rules';
import { api, resolveAssetUrl, type PurchasePaymentAccount, type ProductUnit, type PurchaseCatalogItem,
  type PurchaseInput, type StockBatch, type StockLocation, type Supplier, type PendingAttachment, type RecordAttachment } from '@/services/api';

type Stage = 'picker' | 'cart' | 'review';
type Line = { id: string; item: PurchaseCatalogItem; quantity: string; unitCost: string; unitId?: string;
  unitName?: string; batchId?: string; batchLabel?: string };
type Stored = { lines: Line[]; supplier: string; location: string; notes: string; paid: string;
  payment: 'full' | 'partial' | 'due'; accountId: string; dueDate: string; serverId?: string };
const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
});
const money = (value: number) => `৳${value.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numeric = (value: string) => Number(value || 0);
const validQuantity = (value: string) => /^\d+(\.\d{1,3})?$/.test(value) && numeric(value) > 0;
const validCost = (value: string) => /^\d+(\.\d{1,4})?$/.test(value) && numeric(value) > 0;
const stepQuantity = (value: string, step: 1 | -1) => {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const next = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0')) + BigInt(step) * 1000n;
  if (next <= 0n) return '';
  const remainder = next % 1000n;
  return `${next / 1000n}${remainder ? `.${String(remainder).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
};
const initial: Stored = { lines: [], supplier: '', location: '', notes: '', paid: '', payment: 'due', accountId: '', dueDate: '' };
const err = (cause: unknown) => cause instanceof Error ? cause.message : 'Please try again.';

export function PurchaseFlowScreen() {
  const { id, locationId } = useLocalSearchParams<{ id?: string; locationId?: string }>();
  const { session } = useAuth();
  const business = session?.account?.business.id;
  const draftKey = id ?? 'new';
  const [readyKey, setReadyKey] = useState('');
  const ready = !!business && readyKey === `${business}:${draftKey}`;
  const [stage, setStage] = useState<Stage>('picker');
  const [draft, setDraft] = useState<Stored>(initial);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PurchaseCatalogItem[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadedSupplier, setLoadedSupplier] = useState<Supplier | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierPage, setSupplierPage] = useState<number | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [accounts, setAccounts] = useState<PurchasePaymentAccount[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [newLot, setNewLot] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [supplierAdd, setSupplierAdd] = useState(false);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierArea, setSupplierArea] = useState('');
  const [supplierDistrict, setSupplierDistrict] = useState('');
  const [supplierTerms, setSupplierTerms] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [supplierImage, setSupplierImage] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<PurchaseCatalogItem | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<RecordAttachment[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchSequence = useRef(0);
  const supplierSequence = useRef(0);
  const supplierPaging = useRef(false);
  const queryRef = useRef('');
  const draftCommand = useRef(uid());
  const savedInput = useRef('');
  const completeCommand = useRef(uid());
  const supplierCommand = useRef(uid());
  const preserveForProduct = useRef(false);
  const supplierAddTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const change = (patch: Partial<Stored>) => setDraft(current => ({ ...current, ...patch }));
  const changeLine = (lineId: string, patch: Partial<Line>) => setDraft(current => ({ ...current,
    lines: current.lines.map(line => line.id === lineId ? { ...line, ...patch } : line) }));
  const currentLine = draft.lines.find(line => line.id === editing);
  const chosenSupplier = suppliers.find(row => row.id === draft.supplier) ??
    (loadedSupplier?.id === draft.supplier ? loadedSupplier : null);
  const exactTotal = purchaseAmountCents(draft.lines);
  const total = exactTotal === null ? draft.lines.reduce((sum, line) => sum + numeric(line.quantity) * numeric(line.unitCost), 0) : Number(exactTotal) / 100;
  const selectedCount = new Set(draft.lines.map(line => line.item.variant_id)).size;
  const paid = draft.payment === 'full' ? total.toFixed(2) : draft.payment === 'due' ? '0' : draft.paid;

  useEffect(() => {
    if (!business) return;
    let live = true;
    void (async () => {
      try {
        const saved = id ? await loadPurchaseDraft(business, draftKey) : null;
        if (!id) void clearPurchaseDraft(business, draftKey).catch(() => {});
        let restored = saved ? JSON.parse(saved) as Stored : { ...initial };
        if (id && session) {
          const record = (await api.purchase(session.token, business, id)).purchase;
          const documents = await api.recordAttachments(session.token, business, 'purchase', id);
          if (live) setExistingAttachments(documents.attachments);
          if (record.status !== 'draft') { router.replace(`/purchases/${id}` as Href); return; }
          if (!saved) restored = {
            ...initial, serverId: id, supplier: record.supplier_id, location: String(record.location_id), notes: record.notes,
            lines: (record.lines ?? []).map(line => ({ id: uid(), item: {
              product_id: line.product_id, variant_id: line.variant_id ?? line.product_id,
              name: line.product_name, variant_label: line.variant_name, sku: line.sku, barcode: '',
              base_unit: line.base_unit, tracking_mode: line.tracking_mode,
              image_url: line.image_url, stock: '0', last_purchase_cost: null, default_purchase_cost: null,
            }, quantity: line.quantity, unitCost: line.unit_cost,
              unitId: line.unit_id, unitName: line.unit_name, batchId: line.batch_id,
              batchLabel: line.lot_code })) };
        }
        if (live) setDraft(current => ({ ...restored,
          location: restored.location || locationId || current.location, accountId: restored.accountId || current.accountId }));
      } catch (cause) { if (live) setError(`Could not restore purchase: ${err(cause)}`); }
      finally { if (live) setReadyKey(`${business}:${draftKey}`); }
    })();
    return () => { live = false; };
  }, [business, draftKey, id, locationId, session]);

  useFocusEffect(useCallback(() => {
    preserveForProduct.current = false;
    return () => {
      if (supplierAddTimer.current) clearTimeout(supplierAddTimer.current);
      if (id || preserveForProduct.current) return;
      setDraft(initial); setStage('picker'); setQuery(''); queryRef.current = '';
      setSupplierPickerOpen(false); setSupplierQuery(''); setLoadedSupplier(null);
      setSupplierAdd(false); setSupplierName(''); setSupplierPhone(''); setSupplierAddress('');
      setSupplierArea(''); setSupplierDistrict(''); setSupplierTerms(''); setSupplierNotes('');
      setSupplierImage(null); setEditing(null); setNotesOpen(false); setAttachments([]); setExistingAttachments([]); setPreviewItem(null); setError('');
      draftCommand.current = uid(); completeCommand.current = uid(); supplierCommand.current = uid(); savedInput.current = '';
    };
  }, [id]));

  useEffect(() => {
    if (!business || !ready || !id) return;
    const timer = setTimeout(() => { void savePurchaseDraft(business, draftKey, JSON.stringify(draft)).catch(cause => setError(`Could not save local draft: ${err(cause)}`)); }, 150);
    return () => clearTimeout(timer);
  }, [business, draftKey, draft, id, ready]);

  const loadCatalog = useCallback(async (term: string, page = 1) => {
    if (!session?.account) return;
    const requestNo = ++searchSequence.current;
    setLoading(true);
    try {
      const value = await api.purchaseCatalog(session.token, session.account.business.id, term, page);
      if (requestNo !== searchSequence.current) return;
      setResults(current => page === 1 ? value.items : [...current, ...value.items]);
      setNextPage(value.next_page); setError('');
      void cachePurchaseCatalog(session.account.business.id, value.items).catch(() => {});
    } catch (cause) {
      if (requestNo === searchSequence.current) {
        try {
          const cached = await searchCachedPurchaseCatalog(session.account.business.id, term, page);
          setResults(current => page === 1 ? cached.items : [...current, ...cached.items]); setNextPage(cached.next_page);
          setError(`Offline catalog: showing downloaded products only. ${err(cause)}`);
        } catch { setError(`Product search failed: ${err(cause)}`); }
      }
    }
    finally { if (requestNo === searchSequence.current) setLoading(false); }
  }, [session]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void loadCatalog(query.trim()); }, query.trim() ? 280 : 0);
    return () => clearTimeout(timer);
  }, [loadCatalog, query, ready]);
  useFocusEffect(useCallback(() => {
    if (ready) void loadCatalog(queryRef.current.trim());
  }, [loadCatalog, ready]));

  const loadSuppliers = useCallback(async (term = '', page = 1) => {
    if (!session?.account) return;
    if (page > 1 && supplierPaging.current) return;
    if (page > 1) supplierPaging.current = true;
    const requestNo = ++supplierSequence.current;
    try {
      const result = await api.suppliers(session.token, session.account.business.id, page, term);
      if (requestNo !== supplierSequence.current) return;
      setSuppliers(current => page === 1 ? result.suppliers : [...current, ...result.suppliers]);
      setSupplierPage(result.next_page);
    } catch (cause) { if (requestNo === supplierSequence.current) setError(`Supplier search failed: ${err(cause)}`); }
    finally { if (requestNo === supplierSequence.current) supplierPaging.current = false; }
  }, [session]);
  useFocusEffect(useCallback(() => {
    if (!session?.account) return;
    const businessId = session.account.business.id;
    void Promise.all([api.locations(session.token, businessId), api.purchasePaymentAccounts(session.token, businessId)])
      .then(([place, cash]) => {
        setLocations(place.locations); setAccounts(cash.accounts);
        setDraft(current => ({ ...current, location: current.location || String(place.locations.find(row => row.is_default)?.id || ''),
          accountId: current.accountId || cash.accounts.find(row => row.is_default)?.id || '' }));
      }).catch(cause => setError(err(cause)));
    void loadSuppliers();
  }, [loadSuppliers, session]));
  useEffect(() => {
    if (!supplierPickerOpen) return;
    const timer = setTimeout(() => { void loadSuppliers(supplierQuery.trim()); }, 250);
    return () => clearTimeout(timer);
  }, [supplierPickerOpen, supplierQuery, loadSuppliers]);
  useEffect(() => {
    if (!draft.supplier || !business || !session || suppliers.some(row => row.id === draft.supplier)) return;
    let active = true;
    void api.supplier(session.token, business, draft.supplier).then(result => { if (active) setLoadedSupplier(result.supplier); })
      .catch(() => {});
    return () => { active = false; };
  }, [business, draft.supplier, session, suppliers]);

  const add = (item: PurchaseCatalogItem) => {
    const existing = draft.lines.find(line => line.item.variant_id === item.variant_id && !line.unitId && !line.batchId);
    if (existing) {
      const quantity = stepQuantity(existing.quantity, 1);
      if (quantity === null) { setError('Finish editing this quantity before using + or −.'); return; }
      changeLine(existing.id, { quantity });
      return;
    }
    if (draft.lines.length >= 1000) { setError('A purchase can contain at most 1,000 lines.'); return; }
    setDraft(current => ({ ...current, lines: [...current.lines, { id: uid(), item, quantity: '1',
      unitCost: item.last_purchase_cost ?? item.default_purchase_cost ?? '' }] }));
  };
  const removeOne = (item: PurchaseCatalogItem) => {
    const matches = draft.lines.filter(line => line.item.variant_id === item.variant_id);
    const line = [...matches].reverse().find(row => !row.unitId && !row.batchId) ?? matches.at(-1);
    if (!line) return;
    const quantity = stepQuantity(line.quantity, -1);
    if (quantity === null) { setError('Finish editing this quantity before using + or −.'); return; }
    if (!quantity) setDraft(current => ({ ...current, lines: current.lines.filter(row => row.id !== line.id) }));
    else changeLine(line.id, { quantity });
  };
  const scan = async (barcode: string) => {
    if (!session?.account) return;
    setScannerOpen(false);
    queryRef.current = barcode; setQuery(barcode);
    try {
      const found = await api.purchaseCatalog(session.token, session.account.business.id, barcode);
      const exact = found.items.find(row => row.barcode === barcode || row.sku === barcode || row.package_barcode_match);
      if (exact) add(exact);
      else setError('No product has this barcode. You can search or add a new product.');
    } catch (cause) { setError(`Barcode lookup failed: ${err(cause)}`); }
  };
  const openNewProduct = async () => {
    preserveForProduct.current = true;
    router.push('/products/new');
  };
  const openLine = async (lineId: string) => {
    const line = draft.lines.find(row => row.id === lineId);
    if (!line || !session?.account) return;
    setEditing(lineId); setUnits([]); setBatches([]); setNewLot(''); setNewExpiry('');
    try {
      const businessId = session.account.business.id;
      const [unitResult, batchResult] = await Promise.all([
        api.productUnits(session.token, businessId, line.item.product_id, line.item.variant_id),
        line.item.tracking_mode === 'simple' ? Promise.resolve({ batches: [] as StockBatch[] }) :
          api.productBatches(session.token, businessId, line.item.product_id, line.item.variant_id),
      ]);
      setUnits(unitResult.units); setBatches(batchResult.batches);
    } catch (cause) { setError(`Line details failed to load: ${err(cause)}`); }
  };
  const finishLine = (next: boolean) => {
    if (!currentLine || !validQuantity(currentLine.quantity) || !validCost(currentLine.unitCost) ||
      lineAmountCents(currentLine.quantity, currentLine.unitCost) === null ||
      currentLine.item.tracking_mode !== 'simple' && !currentLine.batchId) {
      setError('Enter valid quantity, cost and required batch.'); return;
    }
    setError('');
    const index = draft.lines.findIndex(row => row.id === currentLine.id);
    if (next && draft.lines[index + 1]) void openLine(draft.lines[index + 1].id);
    else setEditing(null);
  };
  const createBatch = async () => {
    if (!currentLine || !session?.account || !newLot.trim()) { setError('Enter a batch identifier.'); return; }
    if (currentLine.item.tracking_mode === 'expiry' && !/^\d{4}-\d{2}-\d{2}$/.test(newExpiry)) { setError('Enter expiry as YYYY-MM-DD.'); return; }
    setBusy(true);
    try {
      const result = await api.createBatch(session.token, session.account.business.id, currentLine.item.product_id,
        { variant_id: currentLine.item.variant_id, lot_code: newLot.trim(), expires_on: newExpiry || null });
      setBatches(current => [...current, result.batch]);
      changeLine(currentLine.id, { batchId: result.batch.id, batchLabel: result.batch.lot_code });
      setNewLot(''); setNewExpiry(''); setError('');
    } catch (cause) { setError(err(cause)); }
    finally { setBusy(false); }
  };
  const addSupplier = async () => {
    if (!session?.account || !supplierName.trim()) { setError('Enter a supplier name.'); return; }
    setBusy(true);
    try {
      const result = await api.createSupplier(session.token, session.account.business.id,
        { name: supplierName.trim(), phone: supplierPhone.trim(), address: supplierAddress.trim(),
          area: supplierArea.trim(), district: supplierDistrict.trim(), payment_terms: supplierTerms.trim(),
          notes: supplierNotes.trim() }, supplierCommand.current);
      const supplier = supplierImage ? (await api.uploadSupplierImage(session.token, session.account.business.id,
        result.supplier.id, supplierImage)).supplier : result.supplier;
      setSuppliers(current => [supplier, ...current]); change({ supplier: supplier.id });
      setSupplierAdd(false); setSupplierName(''); setSupplierPhone(''); setSupplierAddress(''); setSupplierArea('');
      setSupplierDistrict(''); setSupplierTerms(''); setSupplierNotes(''); setSupplierImage(null);
      supplierCommand.current = uid(); setError('');
    } catch (cause) { setError(err(cause)); }
    finally { setBusy(false); }
  };
  const pickSupplierImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82 });
      if (!result.canceled && result.assets[0]) setSupplierImage(result.assets[0].uri);
    } catch { setError('Could not select a supplier photo.'); }
  };
  const payload = (): PurchaseInput => ({ supplier_id: draft.supplier, location_id: Number(draft.location), notes: draft.notes,
    lines: draft.lines.map(line => ({ product_id: line.item.product_id, variant_id: line.item.variant_id,
      ...(line.unitId && { unit_id: line.unitId }), ...(line.batchId && { batch_id: line.batchId }),
      quantity: line.quantity, unit_cost: line.unitCost })) });
  const submit = async (complete: boolean) => {
    if (!session?.account || !business) return;
    if (!draft.lines.length || !draft.supplier || !draft.location) { setError('Select products, supplier and receiving location.'); return; }
    if (draft.lines.length > 1000) { setError('A purchase can contain at most 1,000 lines.'); return; }
    if (draft.lines.some(line => !validQuantity(line.quantity) || !validCost(line.unitCost) ||
      lineAmountCents(line.quantity, line.unitCost) === null ||
      line.item.tracking_mode !== 'simple' && !line.batchId)) { setError('Check quantity, cost and required batch on every line.'); return; }
    if (complete && (numeric(paid) > total || numeric(paid) < 0 ||
      draft.payment === 'partial' && (!/^\d+(\.\d{1,2})?$/.test(paid) || numeric(paid) <= 0))) {
      setError('Enter a valid payment no greater than the purchase total.'); return;
    }
    if (complete && numeric(paid) > 0 && !draft.accountId) { setError('Choose a money account.'); return; }
    if (complete && numeric(paid) < total && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate || '')) { setError('Enter a due date as YYYY-MM-DD.'); return; }
    setBusy(true); setError('');
    try {
      let serverId = draft.serverId;
      const input = payload();
      if (serverId) {
        const server = (await api.purchase(session.token, business, serverId)).purchase;
        if (server.status === 'completed') {
          await uploadPendingAttachments(session.token, business, 'purchase', serverId, attachments);
          await clearPurchaseDraft(business, draftKey).catch(() => {});
          router.replace(`/purchases/${serverId}` as Href);
          return;
        }
        if (savedInput.current !== JSON.stringify(input)) {
          await api.updatePurchase(session.token, business, serverId, input, draftCommand.current);
          savedInput.current = JSON.stringify(input);
        }
      }
      else {
        const saved = await api.createPurchase(session.token, business, input, draftCommand.current);
        serverId = saved.purchase.id;
        savedInput.current = JSON.stringify(input);
        change({ serverId });
        if (id) await savePurchaseDraft(business, draftKey, JSON.stringify({ ...draft, serverId }));
      }
      await uploadPendingAttachments(session.token, business, 'purchase', serverId, attachments);
      setAttachments([]);
      if (attachments.length) {
        const documents = await api.recordAttachments(session.token, business, 'purchase', serverId);
        setExistingAttachments(documents.attachments);
      }
      if (complete) {
        await api.completePurchase(session.token, business, serverId,
          { paid, ...(numeric(paid) > 0 && { account_id: draft.accountId }),
            ...(numeric(paid) < total && { due_date: draft.dueDate }) }, completeCommand.current);
      }
      await clearPurchaseDraft(business, draftKey).catch(() => {});
      router.replace(`/purchases/${serverId}` as Href);
    } catch (cause) { setError(`${complete ? 'Could not complete' : 'Could not save'} purchase: ${err(cause)}. Your cart is preserved.`); }
    finally { setBusy(false); }
  };

  const listRow = ({ item }: { item: PurchaseCatalogItem }) => {
    const count = draft.lines.filter(line => line.item.variant_id === item.variant_id)
      .reduce((sum, line) => sum + numeric(line.quantity), 0);
    const image = resolveAssetUrl(item.image_url);
    return <View style={styles.productRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${item.name}`} onPress={() => setPreviewItem(item)}>
        {image ? <Image source={{ uri: image }} style={styles.thumbnail} contentFit="cover" cachePolicy="disk" /> :
          <View style={styles.thumbnailEmpty}><AppSymbol name="products" size={24} color="#607770" /></View>}</Pressable>
      <View style={styles.productInfo}><Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
        {!!item.variant_label && <Text style={styles.meta} numberOfLines={1}>{item.variant_label}</Text>}
        <Text style={styles.meta} numberOfLines={1}>{item.sku}{item.barcode ? ` · ${item.barcode}` : ''} · Stock {item.stock} {item.base_unit}</Text>
        <Text style={styles.cost}>{item.last_purchase_cost ? `Last cost ${money(numeric(item.last_purchase_cost))}` :
          item.default_purchase_cost ? `Default cost ${money(numeric(item.default_purchase_cost))}` : 'Cost not set'}</Text>
      </View>
      <View style={styles.productActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${item.name} ${item.variant_label} from purchase`}
          disabled={!count} onPress={() => removeOne(item)} style={[styles.reduceButton, !count && { opacity: 0.4 }]}>
          <AppSymbol name="minus" size={18} color="#915725" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.name} ${item.variant_label}`} onPress={() => add(item)} style={styles.addButton}>
          <AppSymbol name="plus" size={18} color="#fff" /><Text style={styles.addText}>{count || 'Add'}</Text>
        </Pressable>
      </View>
    </View>;
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable onPress={() => stage === 'picker' ? router.back() : setStage(stage === 'review' ? 'cart' : 'picker')} style={styles.back}>
      <AppSymbol name="back" size={24} color="#19483E" /></Pressable><View style={{ flex: 1 }}>
      <Text style={styles.title}>{id ? 'Edit purchase' : 'New purchase'}</Text><Text style={styles.subtitle}>{stage === 'picker' ? 'Select products' : stage === 'cart' ? 'Purchase cart' : 'Review & complete'}</Text></View>
      <Text style={styles.step}>{stage === 'picker' ? '1' : stage === 'cart' ? '2' : '3'} / 3</Text></View>
    <View style={styles.progress}><View style={[styles.progressFill, { width: stage === 'picker' ? '33.3%' : stage === 'cart' ? '66.6%' : '100%' }]} /></View>
    {!!error && <Pressable onPress={() => setError('')} style={styles.error}><Text style={styles.errorText}>{error}  ×</Text></Pressable>}
    {stage === 'picker' && <><View style={styles.searchWrap}><AppSymbol name="products" size={20} color="#678077" />
      <TextInput style={styles.search} value={query} onChangeText={value => { queryRef.current = value; setQuery(value); }} placeholder="Name, SKU or barcode" placeholderTextColor="#82938D" autoCorrect={false} />
      <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => setScannerOpen(true)}>
        <AppSymbol name="barcode" size={21} color="#006D64" /></Pressable>
      {!!query && <Pressable onPress={() => { queryRef.current = ''; setQuery(''); }}><AppSymbol name="close" size={18} color="#678077" /></Pressable>}</View>
      <FlatList data={results} extraData={draft.lines} keyExtractor={item => item.variant_id} renderItem={listRow} style={styles.list}
        contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled"
        onEndReached={() => { if (nextPage && !loading) void loadCatalog(query.trim(), nextPage); }} onEndReachedThreshold={0.4}
        ListHeaderComponent={<View style={styles.listHeading}><Text style={styles.sectionTitle}>Products</Text>
          <Pressable onPress={() => void openNewProduct()}><Text style={styles.link}>+ New product</Text></Pressable></View>}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Searching products…' : 'No matching products. Search again or add a product.'}</Text>}
        ListFooterComponent={loading && results.length ? <Text style={styles.empty}>Loading more…</Text> : undefined} /></>}
    {stage === 'cart' && <FlatList data={draft.lines} keyExtractor={line => line.id} style={styles.list}
      contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={styles.listHeading}><Text style={styles.sectionTitle}>{selectedCount} products · {draft.lines.length} lines</Text>
        <Pressable onPress={() => setStage('picker')}><Text style={styles.link}>+ Add products</Text></Pressable></View>}
      ListEmptyComponent={<Text style={styles.empty}>Your cart is empty. Add products to start this purchase.</Text>}
      renderItem={({ item: line }) => <Pressable style={styles.cartRow} onPress={() => void openLine(line.id)}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${line.item.name}`} onPress={() => setPreviewItem(line.item)}>
          {line.item.image_url ? <Image source={{ uri: resolveAssetUrl(line.item.image_url) || '' }}
            style={styles.thumbnail} contentFit="cover" cachePolicy="disk" /> :
            <View style={styles.thumbnailEmpty}><AppSymbol name="products" size={24} color="#607770" /></View>}
        </Pressable>
        <View style={{ flex: 1 }}><Text style={styles.productName}>{line.item.name}</Text>
          <Text style={styles.meta}>{[line.item.variant_label, line.item.sku].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.meta}>{line.quantity} {line.unitName || line.item.base_unit} × {line.unitCost ? money(numeric(line.unitCost)) : 'Set cost'}
            {line.batchLabel ? ` · Batch ${line.batchLabel}` : ''}</Text></View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}><Text style={styles.lineTotal}>{money(numeric(line.quantity) * numeric(line.unitCost))}</Text>
          <Text style={styles.link}>Edit</Text></View></Pressable>} />}
    {stage === 'review' && <ScrollView style={styles.list} contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Supplier *</Text>
      <Pressable style={[styles.option, !!chosenSupplier && styles.selected]} onPress={() => setSupplierPickerOpen(true)}>
        {!!chosenSupplier?.image_url && <Image source={{ uri: resolveAssetUrl(chosenSupplier.image_url) || '' }}
          style={{ width: 42, height: 42, borderRadius: 9, marginRight: 10 }} contentFit="cover" />}
        <View style={{ flex: 1 }}><Text style={styles.productName}>{chosenSupplier?.name || 'Search suppliers'}</Text>
          <Text style={styles.meta}>{chosenSupplier?.phone || 'Choose an existing supplier'}</Text></View>
        <AppSymbol name="chevron" size={20} color="#006D64" /></Pressable>
      <Pressable onPress={() => setSupplierAdd(true)}><Text style={styles.link}>+ Quick add supplier</Text></Pressable>
      <Text style={styles.sectionTitle}>Receive at *</Text><View style={styles.optionsRow}>{locations.filter(row => row.is_active).map(row =>
        <Pressable key={row.id} style={[styles.pill, draft.location === String(row.id) && styles.selected]}
          onPress={() => change({ location: String(row.id) })}><Text style={styles.pillText}>{row.name}</Text></Pressable>)}</View>
      <View style={styles.summary}><Text style={styles.sectionTitle}>Purchase summary</Text>
        <View style={styles.optionsRow}>{draft.lines.slice(0, 5).map(line => <Pressable key={line.id}
          accessibilityRole="button" accessibilityLabel={`Preview ${line.item.name}`} onPress={() => setPreviewItem(line.item)}>
          {line.item.image_url ? <Image source={{ uri: resolveAssetUrl(line.item.image_url) || '' }}
            style={styles.thumbnail} contentFit="cover" cachePolicy="disk" /> :
            <View style={styles.thumbnailEmpty}><AppSymbol name="products" size={24} color="#607770" /></View>}
        </Pressable>)}</View>
        <View style={styles.summaryRow}><Text style={styles.meta}>{selectedCount} products · {draft.lines.length} lines</Text><Text style={styles.meta}>Subtotal</Text></View>
        <View style={styles.summaryRow}><Text style={styles.productName}>Total</Text><Text style={styles.total}>{money(total)}</Text></View></View>
      <Text style={styles.sectionTitle}>Payment</Text><View style={styles.optionsRow}>
        {([['full', 'Paid in full'], ['partial', 'Partially paid'], ['due', 'Pay later · বাকি']] as const).map(([value, label]) =>
          <Pressable key={value} style={[styles.pill, draft.payment === value && styles.selected]}
            onPress={() => change({ payment: value })}><Text style={styles.pillText}>{label}</Text></Pressable>)}</View>
      {draft.payment === 'partial' && <View><Text style={styles.fieldLabel}>Paid now ৳</Text><TextInput style={styles.input} value={draft.paid}
        onChangeText={value => change({ paid: value })} keyboardType="decimal-pad" placeholder="0.00" /></View>}
      {draft.payment !== 'full' && <View><Text style={styles.fieldLabel}>Due date *</Text><TextInput style={styles.input} value={draft.dueDate || ''} onChangeText={dueDate => change({ dueDate })} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" accessibilityLabel="Supplier due date" /></View>}
      {draft.payment !== 'due' && <><Text style={styles.fieldLabel}>Money account *</Text><View style={styles.optionsRow}>
        {accounts.filter(row => row.is_active).map(row => <Pressable key={row.id}
          style={[styles.pill, draft.accountId === row.id && styles.selected]} onPress={() => change({ accountId: row.id })}>
          <Text style={styles.pillText}>{row.name}</Text></Pressable>)}</View></>}
      <View style={styles.summaryRow}><Text style={styles.meta}>Supplier due after completion</Text><Text style={styles.lineTotal}>{money(Math.max(0, total - numeric(paid)))}</Text></View>
      <Pressable onPress={() => setNotesOpen(current => !current)} style={styles.summaryRow}><Text style={styles.fieldLabel}>Notes & documents</Text>
        <AppSymbol name={notesOpen ? 'up' : 'down'} size={20} color="#607770" /></Pressable>
      {notesOpen && <View style={{ gap: 14 }}><TextInput multiline style={[styles.input, { minHeight: 85 }]} value={draft.notes} onChangeText={notes => change({ notes })}
        placeholder="Optional purchase note" />
        <RecordAttachments kind="purchase" pending={attachments} onChange={setAttachments} existing={existingAttachments}
          token={session?.token} businessId={business} recordId={draft.serverId} showUploadButton={false} />
      </View>}
      <Text style={styles.hint}>Stock and supplier balances change only after online completion.</Text>
    </ScrollView>}
    <View style={styles.footer}><View><Text style={styles.meta}>{selectedCount} products · {draft.lines.length} lines</Text>
      <Text style={styles.footerTotal}>{money(total)}</Text></View><Pressable disabled={busy || !ready || stage !== 'review' && !draft.lines.length}
      onPress={() => stage === 'picker' ? setStage('cart') : stage === 'cart' ? (setStage('review'), !draft.supplier && setSupplierPickerOpen(true)) : void submit(true)}
      style={[styles.primary, (busy || !ready || stage !== 'review' && !draft.lines.length) && { opacity: 0.5 }]}>
      <Text style={styles.primaryText}>{busy ? 'Working…' : stage === 'picker' ? 'Review cart' : stage === 'cart' ? 'Continue' : 'Complete purchase'}</Text>
      <AppSymbol name="chevron" size={18} color="#fff" /></Pressable></View>
    {stage === 'review' && <Pressable disabled={busy} onPress={() => void submit(false)} style={styles.saveDraft}>
      <Text style={styles.link}>Save server draft for later</Text></Pressable>}
    <Modal visible={!!currentLine} transparent animationType="slide" onRequestClose={() => setEditing(null)}><View style={styles.scrim}>
      <View style={styles.sheet}><View style={styles.sheetHeader}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{currentLine?.item.name}</Text>
        <Text style={styles.meta}>{currentLine?.item.variant_label} · {currentLine?.item.sku}</Text></View>
        <Pressable onPress={() => setEditing(null)}><AppSymbol name="close" size={24} color="#415850" /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
          {!!currentLine?.item.image_url && <Pressable onPress={() => setPreviewItem(currentLine.item)}>
            <Image source={{ uri: resolveAssetUrl(currentLine.item.image_url) || '' }}
              style={{ width: 86, height: 86, borderRadius: 12 }} contentFit="cover" cachePolicy="disk" />
            <Text style={styles.link}>Preview product</Text></Pressable>}
          <View style={styles.editRow}><View style={{ flex: 1 }}><Text style={styles.fieldLabel}>Quantity</Text><TextInput style={styles.input}
            keyboardType="decimal-pad" value={currentLine?.quantity || ''} onChangeText={quantity => currentLine && changeLine(currentLine.id, { quantity })} /></View>
          <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>Unit cost ৳</Text><TextInput style={styles.input}
            keyboardType="decimal-pad" value={currentLine?.unitCost || ''} onChangeText={unitCost => currentLine && changeLine(currentLine.id, { unitCost })} /></View></View>
          <Text style={styles.fieldLabel}>Packaging unit</Text><View style={styles.optionsRow}>
            <Pressable style={[styles.pill, !currentLine?.unitId && styles.selected]} onPress={() => currentLine && changeLine(currentLine.id,
              { unitId: undefined, unitName: undefined, ...(currentLine.unitId && { unitCost: '' }) })}><Text style={styles.pillText}>{currentLine?.item.base_unit || 'Base unit'}</Text></Pressable>
            {units.filter(row => row.is_active).map(row => <Pressable key={row.id} style={[styles.pill, currentLine?.unitId === row.id && styles.selected]}
              onPress={() => currentLine && changeLine(currentLine.id, { unitId: row.id, unitName: row.name,
                ...(currentLine.unitId !== row.id && { unitCost: '' }) })}>
              <Text style={styles.pillText}>{row.name} · {row.factor} {currentLine?.item.base_unit}</Text></Pressable>)}</View>
          {currentLine?.item.tracking_mode !== 'simple' && <><Text style={styles.fieldLabel}>Batch *</Text><View style={styles.optionsRow}>
            {batches.map(row => <Pressable key={row.id} style={[styles.pill, currentLine?.batchId === row.id && styles.selected]}
              onPress={() => currentLine && changeLine(currentLine.id, { batchId: row.id, batchLabel: row.lot_code })}>
              <Text style={styles.pillText}>{row.lot_code}{row.expires_on ? ` · ${row.expires_on}` : ''}</Text></Pressable>)}</View>
            <TextInput style={styles.input} value={newLot} onChangeText={setNewLot} placeholder="New batch identifier" />
            {currentLine?.item.tracking_mode === 'expiry' && <TextInput style={styles.input} value={newExpiry}
              onChangeText={setNewExpiry} placeholder="Expiry YYYY-MM-DD" />}
            <Pressable onPress={() => void createBatch()} disabled={busy} style={styles.outline}><Text style={styles.link}>Create batch</Text></Pressable></>}
          <View style={styles.summaryRow}><Text style={styles.fieldLabel}>Line total</Text>
            <Text style={styles.total}>{money(numeric(currentLine?.quantity || '') * numeric(currentLine?.unitCost || ''))}</Text></View>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable onPress={() => { setDraft(current => ({ ...current, lines: current.lines.filter(row => row.id !== currentLine?.id) })); setEditing(null); }}>
            <Text style={styles.remove}>Remove line</Text></Pressable>
        </ScrollView><View style={styles.editRow}><Pressable style={[styles.primaryWide, { flex: 1 }]} onPress={() => finishLine(false)}>
          <Text style={styles.primaryText}>Save line</Text></Pressable>
          {draft.lines.findIndex(row => row.id === currentLine?.id) < draft.lines.length - 1 &&
            <Pressable style={[styles.primaryWide, { flex: 1 }]} onPress={() => finishLine(true)}>
              <Text style={styles.primaryText}>Save & next</Text></Pressable>}</View>
      </View></View></Modal>
    <Modal visible={supplierAdd} transparent animationType="slide" onRequestClose={() => setSupplierAdd(false)}><View style={styles.scrim}>
      <View style={styles.sheet}><View style={styles.sheetHeader}><Text style={styles.sectionTitle}>Quick add supplier</Text>
        <Pressable onPress={() => setSupplierAdd(false)}><AppSymbol name="close" size={24} color="#415850" /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
        {!!supplierImage && <Image source={{ uri: supplierImage }} style={{ width: 76, height: 76, borderRadius: 12 }} contentFit="cover" />}
        <Pressable style={styles.outline} onPress={() => void pickSupplierImage()}><Text style={styles.link}>+ Photo (optional)</Text></Pressable>
        {!!supplierImage && <Pressable onPress={() => setSupplierImage(null)}><Text style={styles.remove}>Remove photo</Text></Pressable>}
        <TextInput style={styles.input} value={supplierName} onChangeText={setSupplierName} placeholder="Supplier name *" />
        <TextInput style={styles.input} value={supplierPhone} onChangeText={setSupplierPhone} keyboardType="phone-pad" placeholder="Phone (optional)" />
        <TextInput style={styles.input} value={supplierAddress} onChangeText={setSupplierAddress} placeholder="Address (optional)" />
        <TextInput style={styles.input} value={supplierArea} onChangeText={setSupplierArea} placeholder="Area (optional)" />
        <TextInput style={styles.input} value={supplierDistrict} onChangeText={setSupplierDistrict} placeholder="District (optional)" />
        <TextInput style={styles.input} value={supplierTerms} onChangeText={setSupplierTerms} placeholder="Payment terms (optional)" />
        <TextInput style={[styles.input, { minHeight: 65 }]} value={supplierNotes} onChangeText={setSupplierNotes}
          multiline placeholder="Notes (optional)" />
        </ScrollView>
        <Pressable style={styles.primaryWide} disabled={busy} onPress={() => void addSupplier()}><Text style={styles.primaryText}>Add supplier</Text></Pressable>
      </View></View></Modal>
    <Modal visible={!!previewItem} transparent animationType="fade" onRequestClose={() => setPreviewItem(null)}>
      <View style={styles.scrim}><View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sectionTitle}>Product preview</Text>
          <Pressable onPress={() => setPreviewItem(null)}><AppSymbol name="close" size={24} color="#415850" /></Pressable></View>
        {previewItem?.image_url ? <Image source={{ uri: resolveAssetUrl(previewItem.image_url) || '' }}
          style={styles.previewImage} contentFit="contain" cachePolicy="disk" /> :
          <View style={[styles.previewImage, { alignItems: 'center', justifyContent: 'center' }]}>
            <AppSymbol name="products" size={54} color="#607770" /></View>}
        <Text style={styles.sectionTitle}>{previewItem?.name}</Text>
        <Text style={styles.meta}>{[previewItem?.variant_label, previewItem?.sku, previewItem?.barcode].filter(Boolean).join(' · ')}</Text>
        {previewItem && stage === 'picker' && <Pressable style={styles.primaryWide} onPress={() => { add(previewItem); setPreviewItem(null); }}>
          <Text style={styles.primaryText}>Add to purchase</Text></Pressable>}
      </View></View>
    </Modal>
    <Modal visible={supplierPickerOpen} animationType="slide" onRequestClose={() => setSupplierPickerOpen(false)}>
      <SafeAreaView style={styles.safe}><View style={[styles.sheetHeader, { padding: 16 }]}>
        <View><Text style={styles.sectionTitle}>Choose supplier</Text><Text style={styles.meta}>Search and select the supplier for this purchase</Text></View>
        <Pressable onPress={() => setSupplierPickerOpen(false)}><AppSymbol name="close" size={24} color="#415850" /></Pressable></View>
        <View style={styles.searchWrap}><AppSymbol name="parties" size={18} color="#678077" />
          <TextInput style={styles.search} value={supplierQuery} onChangeText={setSupplierQuery}
            placeholder="Name or phone" placeholderTextColor="#82938D" /></View>
        <Pressable style={[styles.outline, { marginHorizontal: 16, marginBottom: 8 }]} onPress={() => {
          setSupplierPickerOpen(false);
          supplierAddTimer.current = setTimeout(() => { supplierAddTimer.current = null; setSupplierAdd(true); }, 300);
        }}><Text style={styles.link}>+ Add a new supplier</Text></Pressable>
        <FlatList style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled"
          data={suppliers} keyExtractor={row => row.id}
          onEndReached={() => { if (supplierPage) void loadSuppliers(supplierQuery.trim(), supplierPage); }}
          renderItem={({ item: row }) => <Pressable style={[styles.option, draft.supplier === row.id && styles.selected]}
            onPress={() => { change({ supplier: row.id }); setSupplierPickerOpen(false); }}>
            {!!row.image_url && <Image source={{ uri: resolveAssetUrl(row.image_url) || '' }}
              style={{ width: 42, height: 42, borderRadius: 9, marginRight: 10 }} contentFit="cover" />}
            <View style={{ flex: 1 }}><Text style={styles.productName}>{row.name}</Text>
              {!!row.phone && <Text style={styles.meta}>{row.phone}</Text>}</View>
            {draft.supplier === row.id && <AppSymbol name="activate" size={20} color="#006D64" />}</Pressable>}
          ListEmptyComponent={<Text style={styles.empty}>No matching suppliers.</Text>} />
      </SafeAreaView>
    </Modal>
    <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
      <PurchaseScanner onClose={() => setScannerOpen(false)} onScan={barcode => void scan(barcode)} />
    </Modal>
  </SafeAreaView>;
}

function PurchaseScanner({ onClose, onScan }: { onClose: () => void; onScan: (barcode: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  return <SafeAreaView style={styles.scannerScreen}>
    <View style={styles.sheetHeader}><Text style={styles.sectionTitle}>Scan product barcode</Text>
      <Pressable onPress={onClose}><AppSymbol name="close" size={24} color="#415850" /></Pressable></View>
    {!permission?.granted ? <View style={styles.scannerMessage}><Text style={styles.meta}>Camera access is needed to scan product barcodes.</Text>
      <Pressable style={styles.primaryWide} onPress={() => void requestPermission()}><Text style={styles.primaryText}>Allow camera</Text></Pressable></View> :
      <CameraView style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }} facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => { if (locked.current) return; locked.current = true; onScan(data); }} />}
    <Text style={styles.hint}>Point the camera at a barcode. The exact variant will be added to your cart.</Text>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: '#fff' },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#E7F2EC', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#142A23', fontSize: 22, fontWeight: '700' }, subtitle: { color: '#62746B', fontSize: 12 },
  step: { color: '#006D64', fontWeight: '700', fontSize: 13 }, progress: { height: 3, backgroundColor: '#E1EAE4' },
  progressFill: { height: 3, backgroundColor: '#006D64' },
  error: { backgroundColor: '#FFF0ED', paddingHorizontal: 16, paddingVertical: 10 }, errorText: { color: '#A12D25', fontSize: 13 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginHorizontal: 16,
    marginVertical: 12, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: '#DAE5DD', backgroundColor: '#fff' },
  search: { flex: 1, color: '#142A23', fontSize: 15, paddingVertical: 8 },
  list: { flex: 1 }, listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { color: '#142A23', fontSize: 17, fontWeight: '700' }, link: { color: '#006D64', fontSize: 14, fontWeight: '700' },
  empty: { color: '#607770', textAlign: 'center', padding: 24 },
  productRow: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#E5ECE7' },
  thumbnail: { width: 54, height: 54, borderRadius: 10, backgroundColor: '#E5ECE7' },
  thumbnailEmpty: { width: 54, height: 54, borderRadius: 10, backgroundColor: '#E5ECE7', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#E5ECE7' },
  productInfo: { flex: 1, gap: 2 }, productName: { color: '#142A23', fontSize: 15, fontWeight: '600' },
  meta: { color: '#66786F', fontSize: 12 }, cost: { color: '#22594F', fontSize: 12, fontWeight: '700', marginTop: 3 },
  addButton: { minWidth: 56, minHeight: 44, borderRadius: 10, backgroundColor: '#006D64', alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 3, paddingHorizontal: 8 }, addText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  productActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reduceButton: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E6CBAF',
    backgroundColor: '#FFF4E7', alignItems: 'center', justifyContent: 'center' },
  cartRow: { flexDirection: 'row', gap: 10, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#E1E9E2' },
  lineTotal: { color: '#14352E', fontSize: 15, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16,
    paddingVertical: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E1E9E2' },
  footerTotal: { fontSize: 18, fontWeight: '700', color: '#142A23' },
  primary: { minWidth: 150, minHeight: 48, borderRadius: 12, paddingHorizontal: 16, backgroundColor: '#006D64',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reviewContent: { padding: 16, paddingBottom: 30, gap: 12 },
  option: { backgroundColor: '#fff', padding: 13, borderRadius: 10, borderWidth: 1, borderColor: '#E1E9E2', flexDirection: 'row', alignItems: 'center' },
  selected: { borderColor: '#006D64', backgroundColor: '#E9F5EE' }, optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDE6DF' },
  pillText: { color: '#1D3A32', fontSize: 13, fontWeight: '600' },
  summary: { borderTopWidth: 1, borderColor: '#E1E9E2', paddingTop: 18, gap: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  total: { color: '#0B4E42', fontSize: 21, fontWeight: '700' }, fieldLabel: { color: '#354D43', fontSize: 13, fontWeight: '700', marginBottom: 5 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#DCE6DF', backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, color: '#142A23', fontSize: 15 },
  hint: { color: '#66786F', fontSize: 12 }, saveDraft: { alignItems: 'center', paddingVertical: 9, backgroundColor: '#fff' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }, sheet: { maxHeight: '85%', backgroundColor: '#F7F9F7',
    borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, editRow: { flexDirection: 'row', gap: 12 },
  outline: { borderWidth: 1, borderColor: '#B9D7C8', padding: 12, borderRadius: 10, alignItems: 'center' },
  remove: { color: '#A12D25', fontSize: 14, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  primaryWide: { minHeight: 49, borderRadius: 12, backgroundColor: '#006D64', alignItems: 'center', justifyContent: 'center' },
  scannerScreen: { flex: 1, backgroundColor: '#F7F9F7', padding: 20, gap: 18 },
  scannerMessage: { flex: 1, justifyContent: 'center', gap: 16 },
});
