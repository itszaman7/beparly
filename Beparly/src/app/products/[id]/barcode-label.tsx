import { router, useLocalSearchParams } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api, type Product, type ProductUnit, type Variant } from '@/services/api';

export default function ProductBarcodeLabel() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const businessId = session?.account?.business.id;
  const [product, setProduct] = useState<Product | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantId, setVariantId] = useState('');
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [paper, setPaper] = useState<'50x30' | '70x40' | '2x4'>('50x30');
  const [count, setCount] = useState('1');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session || !businessId || !id) return;
    let active = true;
    void api.product(session.token, businessId, id).then(result => {
      if (!active) return;
      setProduct(result.product); setVariants(result.variants ?? []);
      setVariantId(result.product.product_type === 'simple' ? '' : result.variants?.[0]?.id ?? '');
      const firstCode = result.product.product_type === 'simple' ? result.product.barcode : result.variants?.[0]?.barcode;
      if ((firstCode?.length ?? 0) > 16) setPaper('70x40');
    }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Could not load product.'); });
    return () => { active = false; };
  }, [session, businessId, id]);

  useEffect(() => {
    if (!session || !businessId || !id || !product || product.product_type === 'variant' && !variantId) return;
    let active = true;
    void api.productUnits(session.token, businessId, id, variantId || undefined).then(result => {
      if (active) { setUnits(result.units.filter(unit => unit.is_active)); setUnitId(''); }
    }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Could not load packaging.'); });
    return () => { active = false; };
  }, [session, businessId, id, product, variantId]);

  useEffect(() => {
    return () => { if (source.startsWith('blob:')) URL.revokeObjectURL(source); };
  }, [source]);

  const selectedVariant = variants.find(row => row.id === variantId);
  const selectedUnit = units.find(row => row.id === unitId);
  const code = unitId ? selectedUnit?.barcode ?? '' :
    product?.product_type === 'variant' ? selectedVariant?.barcode ?? '' : product?.barcode ?? '';

  async function generateBarcode() {
    if (!session || !businessId || !id || !product || busy || code) return;
    setBusy(true); setError('');
    try {
      const result = await api.ensureProductBarcode(session.token, businessId, id, {
        variant_id: variantId || undefined, unit_id: unitId || undefined,
      });
      if (unitId) setUnits(current => current.map(unit => unit.id === unitId ? { ...unit, barcode: result.barcode } : unit));
      else if (variantId) setVariants(current => current.map(variant => variant.id === variantId ? { ...variant, barcode: result.barcode } : variant));
      else setProduct(current => current ? { ...current, barcode: result.barcode } : current);
      setSource('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not generate barcode.'); }
    finally { setBusy(false); }
  }

  async function preview() {
    if (!session || !businessId || !id || !product) return;
    const quantity = Number(count);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) { setError('Print 1 to 100 labels.'); return; }
    if (!code) { setError('Add a barcode to this variant or package first.'); return; }
    setBusy(true); setError(''); setSource('');
    const url = api.productBarcodeLabelUrl(businessId, id, { variantId: variantId || undefined,
      unitId: unitId || undefined, paper, count: quantity });
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
        if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? 'Could not generate labels.'); }
        setSource(URL.createObjectURL(await response.blob()));
      } else {
        const file = new File(Paths.cache, `product-${id}-labels-${Date.now()}.pdf`);
        const downloaded = await File.downloadFileAsync(url, file, { headers: { Authorization: `Bearer ${session.token}` } });
        setSource(downloaded.uri);
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not generate labels.'); }
    finally { setBusy(false); }
  }

  async function print() {
    if (!source) return;
    try {
      if (Platform.OS === 'web') {
        if (!window.open(source, '_blank')) throw new Error('Allow pop-ups to open the label PDF.');
      } else await Print.printAsync({ uri: source });
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not print labels.'); }
  }

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={() => router.back()}><Text style={styles.link}>‹ Back</Text></Pressable>
    <Text style={styles.title}>Product barcode labels</Text>
    <Text>{product?.name ?? 'Loading product…'}</Text>
    {product?.product_type === 'variant' ? <><Text style={styles.label}>Variant</Text>
      {variants.map(row => <Pressable key={row.id} onPress={() => { setVariantId(row.id); setUnitId(''); if (row.barcode.length > 16) setPaper('70x40'); setSource(''); }} style={[styles.choice, variantId === row.id && styles.selected]}><Text>{row.label || row.sku}</Text></Pressable>)}</> : null}
    <Text style={styles.label}>Barcode source</Text>
    <Pressable onPress={() => { setUnitId(''); setSource(''); }} style={[styles.choice, !unitId && styles.selected]}><Text>{selectedVariant?.base_unit ?? product?.base_unit ?? 'Base unit'}</Text></Pressable>
    {units.map(unit => <Pressable key={unit.id} onPress={() => { setUnitId(unit.id); if (unit.barcode.length > 16) setPaper('70x40'); setSource(''); }} style={[styles.choice, unitId === unit.id && styles.selected]}><Text>{unit.name} · {unit.factor} base units</Text></Pressable>)}
    <Text selectable>Code: {code || 'Missing'}</Text>
    {!code && product ? <Pressable accessibilityRole="button" disabled={busy || product.product_type === 'variant' && !variantId}
      onPress={() => void generateBarcode()} style={styles.button}>
      <Text style={styles.buttonText}>{busy ? 'Generating…' : 'Generate barcode for this item'}</Text>
    </Pressable> : null}
    <Text style={styles.label}>Label stock</Text>
    <View style={styles.row}>{(['50x30', '70x40', '2x4'] as const).map(value => <Pressable key={value} onPress={() => { setPaper(value); setSource(''); }} style={[styles.choice, paper === value && styles.selected]}><Text>{value} mm</Text></Pressable>)}</View>
    <Text style={styles.label}>Number of labels</Text>
    <TextInput value={count} onChangeText={value => { setCount(value); setSource(''); }} keyboardType="number-pad" style={styles.input} accessibilityLabel="Number of labels" />
    <Pressable disabled={busy || !code} onPress={() => void preview()} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Generating…' : 'Preview labels'}</Text></Pressable>
    {busy ? <ActivityIndicator /> : null}
    {source ? Platform.OS === 'web' ? <View style={styles.preview}>{createElement('iframe', { title: 'Product barcode label preview', src: source, style: { width: '100%', height: '100%', border: 0 } })}</View> : <Text>PDF ready. Print at actual size.</Text> : null}
    {source ? <Pressable accessibilityRole="button" onPress={() => void print()} style={styles.button}><Text style={styles.buttonText}>{Platform.OS === 'web' ? 'Open PDF to print' : 'Print labels'}</Text></Pressable> : null}
    {source && Platform.OS === 'web' ? <Text>In the PDF tab, choose Print and set scaling to Actual size.</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' }, content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, gap: 12 },
  title: { fontSize: 23, fontWeight: '800', color: '#15211F' }, label: { fontWeight: '700', color: '#15211F' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { padding: 11, borderRadius: 10, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: 'white' },
  selected: { backgroundColor: '#DDF3EF', borderColor: '#006D64' }, input: { borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 10, padding: 10, backgroundColor: 'white' },
  button: { minHeight: 48, backgroundColor: '#006D64', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: 'white', fontWeight: '800' }, preview: { height: 420, backgroundColor: 'white' },
  error: { color: '#B42318' }, link: { color: '#006D64', fontWeight: '700' },
});
