import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppSymbol } from '@/components/app-symbol';
import { AppText as Text } from '@/components/app-text';
import { useAuth } from '@/features/auth/auth-context';
import { api, type LabelPrintSettings } from '@/services/api';

const defaults: LabelPrintSettings = { paper: '4x6', width_mm: 101.6, height_mm: 152.4,
  horizontal_offset_mm: 0, vertical_offset_mm: 0, scale_percent: 100, inner_padding_mm: 3, rotation: 0, safe_margin_mm: 3 };
const paperOptions = [
  { value: '4x6', title: '4×6 inch — 101.6 × 152.4 mm (Standard thermal)', width: 101.6, height: 152.4 },
  { value: '4x6_metric', title: '4×6 metric — 100 × 150 mm', width: 100, height: 150 },
  { value: '2x4', title: '2×4 inch — 50.8 × 101.6 mm (Small)', width: 50.8, height: 101.6 },
  { value: 'custom', title: 'Custom dimensions', width: 0, height: 0 },
] as const;
type NumericKey = Exclude<keyof LabelPrintSettings, 'paper' | 'rotation'>;
type LabelDraft = { paper: LabelPrintSettings['paper']; rotation: LabelPrintSettings['rotation'] } & Record<NumericKey, string>;
const numericKeys: NumericKey[] = ['width_mm', 'height_mm', 'horizontal_offset_mm', 'vertical_offset_mm', 'scale_percent', 'inner_padding_mm', 'safe_margin_mm'];
const toDraft = (value: LabelPrintSettings): LabelDraft => ({ paper: value.paper, rotation: value.rotation,
  width_mm: String(value.width_mm), height_mm: String(value.height_mm), horizontal_offset_mm: String(value.horizontal_offset_mm),
  vertical_offset_mm: String(value.vertical_offset_mm), scale_percent: String(value.scale_percent),
  inner_padding_mm: String(value.inner_padding_mm), safe_margin_mm: String(value.safe_margin_mm) });

function parseSettings(draft: LabelDraft): LabelPrintSettings {
  const values = Object.fromEntries(numericKeys.map((key) => [key, Number(draft[key])])) as Record<NumericKey, number>;
  for (const key of numericKeys) if (!draft[key].trim() || !Number.isFinite(values[key])) throw new Error('Enter valid numbers for all label settings.');
  if (values.width_mm < 50 || values.width_mm > 210 || values.height_mm < 70 || values.height_mm > 300) throw new Error('Paper width must be 50–210 mm and height 70–300 mm.');
  if (Math.abs(values.horizontal_offset_mm) > 20 || Math.abs(values.vertical_offset_mm) > 20) throw new Error('Offsets must be between −20 and 20 mm.');
  if (values.scale_percent < 50 || values.scale_percent > 150) throw new Error('Scale must be between 50% and 150%.');
  if (values.inner_padding_mm < 0 || values.inner_padding_mm > 20 || values.safe_margin_mm < 0 || values.safe_margin_mm > 20) throw new Error('Padding and safe margin must be 0–20 mm.');
  if (values.inner_padding_mm + values.safe_margin_mm >= Math.min(values.width_mm, values.height_mm) / 2) throw new Error('Padding and safe margin leave no room for the label.');
  return { paper: draft.paper, rotation: draft.rotation, ...values };
}

export default function PrintSettings() {
  const { session, refreshBusinesses } = useAuth();
  const businessId = session?.account?.business.id;
  const owner = session?.account?.role === 'owner';
  const [footer, setFooter] = useState('');
  const [savedFooter, setSavedFooter] = useState('');
  const [label, setLabel] = useState<LabelDraft>(toDraft(defaults));
  const [savedLabel, setSavedLabel] = useState<LabelDraft>(toDraft(defaults));
  const [paperOpen, setPaperOpen] = useState(false);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = footer !== savedFooter || JSON.stringify(label) !== JSON.stringify(savedLabel);

  useEffect(() => {
    if (!session || !businessId) return;
    let active = true;
    void api.businessProfile(session.token, businessId)
      .then(({ business }) => { if (!active) return; const next = toDraft(business.label_print_settings ?? defaults);
        setFooter(business.invoice_footer_text ?? ''); setSavedFooter(business.invoice_footer_text ?? '');
        setLabel(next); setSavedLabel(next); })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load print settings.'))
      .finally(() => setLoading(false));
    return () => { active = false; };
  }, [session, businessId]);

  async function save() {
    if (!session || !businessId || !owner || saving) return;
    setMessage('');
    let settings: LabelPrintSettings;
    try { settings = parseSettings(label); } catch (error) { setMessage((error as Error).message); return; }
    setSaving(true);
    try {
      const { business } = await api.updateBusinessProfile(session.token, businessId, { invoice_footer_text: footer.trim(), label_print_settings: settings });
      setFooter(business.invoice_footer_text ?? '');
      setSavedFooter(business.invoice_footer_text ?? '');
      const next = toDraft(business.label_print_settings ?? defaults);
      setLabel(next); setSavedLabel(next);
      await refreshBusinesses();
      setMessage('Print settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save print settings.');
    } finally {
      setSaving(false);
    }
  }

  async function printTest() {
    if (!session || !businessId || printing) return;
    if (dirty) { setMessage('Save your changes before printing the calibration page.'); return; }
    const popup = Platform.OS === 'web' ? window.open('', '_blank') : null;
    setPrinting(true); setMessage('');
    try {
      const url = api.labelCalibrationUrl(businessId);
      if (Platform.OS === 'web') {
        if (!popup) throw new Error('Allow pop-ups to open the calibration PDF.');
        const response = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
        if (!response.ok) throw new Error('Could not load calibration page.');
        popup.location.href = URL.createObjectURL(await response.blob());
      } else {
        const file = new File(Paths.cache, `label-calibration-${Date.now()}.pdf`);
        const downloaded = await File.downloadFileAsync(url, file, { headers: { Authorization: `Bearer ${session.token}` } });
        await Print.printAsync({ uri: downloaded.uri });
      }
    } catch (error) { popup?.close(); setMessage(error instanceof Error ? error.message : 'Could not print calibration page.'); }
    finally { setPrinting(false); }
  }

  function numberField(key: NumericKey, title: string, hint?: string) {
    return <View key={key} style={styles.numberField}><Text style={styles.label}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput value={label[key]} onChangeText={(value) => { setLabel((current) => ({ ...current, [key]: value })); setMessage(''); }}
        editable={owner && !loading} keyboardType="decimal-pad" accessibilityLabel={title} style={styles.numberInput} />
    </View>;
  }

  if (!session?.account) return null;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Back</Text></Pressable>
    <Text style={styles.title}>Print settings</Text>
    <View style={styles.card}>
      <View style={styles.cardHeading}><AppSymbol name="receipt" color="#006D64" size={20} /><Text style={styles.cardTitle}>Invoice footer</Text></View>
      <Text style={styles.muted}>The message printed below invoice and receipt totals.</Text>
      <Text style={styles.label}>Invoice footer text</Text>
      <TextInput value={footer} onChangeText={(value) => { setFooter(value); setMessage(''); }} editable={owner && !loading} maxLength={500} multiline placeholder="Leave blank to hide the footer" placeholderTextColor="#82908A" style={styles.input} accessibilityLabel="Invoice footer text" />
      <Text style={styles.hint}>{footer.length}/500 characters · Blank hides the footer.</Text>
    </View>
    <View style={styles.card}>
      <View style={styles.cardHeading}><AppSymbol name="receipt" color="#006D64" size={20} /><Text style={styles.cardTitle}>Paper size</Text></View>
      <Text style={styles.muted}>Choose the label paper loaded in your printer.</Text>
      <Text style={styles.label}>Paper size</Text>
      <Pressable onPress={() => setPaperOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: paperOpen }} accessibilityLabel="Choose label paper size" style={styles.select}>
        <Text style={styles.selectText}>{paperOptions.find((item) => item.value === label.paper)?.title}</Text><AppSymbol name="down" color="#52635E" size={18} />
      </Pressable>
      {paperOpen && <View style={styles.options}>{paperOptions.map((item) => <Pressable key={item.value} onPress={() => {
        setLabel((current) => ({ ...current, paper: item.value, width_mm: item.value === 'custom' ? current.width_mm : String(item.width),
          height_mm: item.value === 'custom' ? current.height_mm : String(item.height) })); setPaperOpen(false); setMessage('');
      }} accessibilityRole="button" accessibilityState={{ selected: label.paper === item.value }} style={styles.option}>
        <Text style={styles.optionCheck}>{label.paper === item.value ? '✓' : ' '}</Text><Text style={styles.selectText}>{item.title}</Text>
      </Pressable>)}</View>}
      {label.paper === 'custom' && <View style={styles.grid}>{numberField('width_mm', 'Width (mm)')}{numberField('height_mm', 'Height (mm)')}</View>}
    </View>
    <View style={styles.card}>
      <View style={styles.cardHeading}><AppSymbol name="adjustment" color="#006D64" size={20} /><Text style={styles.cardTitle}>Printer calibration</Text></View>
      <Text style={styles.muted}>Print a test page, measure it with a ruler, then adjust offsets until it matches the expected dimensions.</Text>
      <View style={styles.grid}>
        {numberField('horizontal_offset_mm', 'Horizontal offset (mm)', 'Negative = left, positive = right')}
        {numberField('vertical_offset_mm', 'Vertical offset (mm)', 'Negative = up, positive = down')}
        {numberField('scale_percent', 'Scale (%)', '100 = exact size')}
        {numberField('inner_padding_mm', 'Inner padding (mm)')}
        <View style={styles.numberField}><Text style={styles.label}>Rotation</Text>
          <Pressable onPress={() => setRotationOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: rotationOpen }} style={styles.select}>
            <Text style={styles.selectText}>{label.rotation}° {label.rotation === 0 ? '(Normal)' : ''}</Text><AppSymbol name="down" color="#52635E" size={18} />
          </Pressable>
          {rotationOpen && <View style={styles.options}>{([0, 90, 180, 270] as const).map((rotation) => <Pressable key={rotation} onPress={() => { setLabel((current) => ({ ...current, rotation })); setRotationOpen(false); setMessage(''); }} accessibilityRole="button" style={styles.option}><Text style={styles.selectText}>{rotation}°</Text></Pressable>)}</View>}
        </View>
        {numberField('safe_margin_mm', 'Safe margin (mm)')}
      </View>
      <View style={styles.previewRule} />
      <Pressable onPress={() => void printTest()} disabled={loading || printing} accessibilityRole="button" style={styles.testButton}>
        {printing ? <ActivityIndicator color="#006D64" /> : <AppSymbol name="receipt" color="#006D64" size={18} />}
        <Text style={styles.testText}>Print calibration test page</Text>
      </Pressable>
      <Text style={styles.hint}>The test page has corner markers and a 50 mm reference line. Print at actual size and measure it.</Text>
    </View>
    <View style={styles.preview}>
      <Text style={styles.previewLabel}>PRINT PREVIEW</Text>
      <View style={styles.previewRule} />
      <Text style={styles.previewText}>{footer.trim() || 'No footer text'}</Text>
    </View>
    {owner ? <Pressable onPress={() => void save()} accessibilityRole="button" disabled={loading || saving || !dirty} style={[styles.save, (loading || saving || !dirty) && styles.disabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : 'Save print settings'}</Text></Pressable> : <Text style={styles.muted}>Only the business owner can change print settings.</Text>}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F7' },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, gap: 14, paddingBottom: 40 },
  back: { color: '#006D64', fontWeight: '700' },
  title: { color: '#15211F', fontSize: 25, fontWeight: '800' },
  muted: { color: '#52635E', fontSize: 13 },
  card: { padding: 16, borderRadius: 15, borderWidth: 1, borderColor: '#DCE6E2', backgroundColor: 'white', gap: 9 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cardTitle: { color: '#15211F', fontSize: 17, fontWeight: '700' },
  label: { color: '#15211F', fontSize: 14, fontWeight: '700' },
  input: { minHeight: 110, textAlignVertical: 'top', borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 11, padding: 12, color: '#15211F', backgroundColor: '#F6F8F7' },
  hint: { color: '#52635E', fontSize: 11 },
  select: { minHeight: 44, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectText: { color: '#15211F', fontSize: 13, flex: 1 },
  options: { borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 8, padding: 4, backgroundColor: 'white' },
  option: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9 },
  optionCheck: { color: '#006D64', width: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  numberField: { width: '47%', flexGrow: 1, gap: 5 },
  numberInput: { minHeight: 42, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 8, paddingHorizontal: 12, color: '#15211F', backgroundColor: 'white' },
  testButton: { alignSelf: 'flex-start', minHeight: 42, borderWidth: 1, borderColor: '#DCE6E2', borderRadius: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  testText: { color: '#15211F', fontWeight: '600', fontSize: 13 },
  preview: { padding: 18, borderRadius: 15, backgroundColor: 'white', gap: 12 },
  previewLabel: { color: '#52635E', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  previewRule: { height: 1, backgroundColor: '#DCE6E2' },
  previewText: { color: '#52635E', fontSize: 12, textAlign: 'center' },
  save: { minHeight: 50, borderRadius: 14, backgroundColor: '#006D64', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  saveText: { color: 'white', fontWeight: '800' },
  message: { color: '#006D64', fontWeight: '700' },
});
